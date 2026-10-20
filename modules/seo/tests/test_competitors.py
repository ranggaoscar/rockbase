import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from seo_engine.api import create_app
from seo_engine.policy import PoliteClient
from seo_engine.repository import Repository
from seo_engine.crawler import SeoCrawler


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "seo.sqlite")


def test_competitor_relationships_are_workspace_scoped_and_excluded_from_owned(repo):
    app = create_app(repo, token="secret", validate=lambda url: asyncio.sleep(0))
    client = TestClient(app)
    headers = {"x-seo-token": "secret", "x-workspace-id": "one"}
    assert client.post("/api/brands", headers=headers, json={"key": "brand", "name": "Brand"}).status_code == 200
    response = client.post("/api/competitors", headers=headers,
                           json={"brand_key": "brand", "name": "Rival", "base_url": "https://rival.example"})
    assert response.status_code == 201, response.text
    comp = response.json()
    assert comp["brand_key"] == "brand"
    assert client.get("/api/websites", headers=headers).json() == []
    assert client.get("/api/competitors", headers={**headers, "x-workspace-id": "other"}).json() == []
    assert client.post("/api/websites", headers=headers, json={"name": "Owned", "base_url": "https://owned.example"}).status_code == 201
    assert client.post("/api/competitors", headers=headers, json={"brand_key": "brand", "name": "Owned", "base_url": "https://owned.example"}).status_code == 409


def test_competitor_scan_findings_are_http_only_and_relationship_aware(repo, monkeypatch):
    client = TestClient(create_app(repo, token="secret", validate=lambda url: asyncio.sleep(0)))
    headers = {"x-seo-token": "secret", "x-workspace-id": "w"}
    client.post("/api/brands", headers=headers, json={"key": "alpha", "name": "Alpha"})
    competitor = client.post("/api/competitors", headers=headers,
        json={"brand_key": "alpha", "name": "Rival", "base_url": "https://rival.example"}).json()
    # Test the real crawler against an in-memory HTTP fixture; no external requests.
    import seo_engine.scan_worker as worker
    original = worker.SeoCrawler
    class FixtureCrawler(original):
        def __init__(self, repo, scan, website):
            transport = httpx.MockTransport(lambda request: httpx.Response(200, headers={"content-type":"text/html"},
                text='<html><head><title>Rival</title><meta name="description" content="A rival"><link rel="canonical" href="https://rival.example/"></head><body><h1>Products</h1><a href="/about">About</a></body></html>')
                if request.url.path != "/robots.txt" else httpx.Response(200, text="User-agent: *\\nAllow: /"))
            self._client = PoliteClient(website["base_url"], transport=transport, validate=lambda url: asyncio.sleep(0), delay=0)
            super().__init__(repo, scan, website, client=self._client)
    # Inject runner to avoid child process while retaining actual SQLite and crawler behavior.
    async def runner(scan_id):
        scan = repo.scan(scan_id)
        website = repo.website(scan["website_id"], "w")
        await FixtureCrawler(repo, scan, website).run()
    assert client.app
    # API supports injected scan runner so tests exercise the actual background path.
    client.close()
    client = TestClient(create_app(repo, token="secret", validate=lambda url: asyncio.sleep(0), scan_runner=runner))
    response = client.post(f"/api/competitors/{competitor['id']}/scans", headers=headers, json={"max_urls": 2})
    assert response.status_code == 202, response.text
    scan = response.json()
    assert scan["mode"] == "http"
    detail = client.get(f"/api/competitors/{competitor['id']}", headers=headers).json()
    assert detail["relationship"]["brand_key"] == "alpha"
    findings = detail["findings"]
    assert isinstance(findings, list)
    assert client.get(f"/api/competitors/{competitor['id']}/findings?scan_id={scan['id']}", headers=headers).status_code == 200


def test_comparison_does_not_call_unobserved_or_failed_urls_deleted(repo):
    from seo_engine.competitors import compare_pages
    old = [{"url":"https://rival.example/a", "status_code":200, "title":"A", "description":"", "h1":"A", "canonical":"", "indexable":True, "meta_robots":"", "x_robots_tag":"", "internal_links":[]}]
    new = [{"url":"https://rival.example/b", "status_code":403, "title":"", "description":"", "h1":"", "canonical":"", "indexable":False, "meta_robots":"", "x_robots_tag":"", "internal_links":[]}]
    findings, coverage = compare_pages(old, new, current_scan_id=2, previous_scan_id=1, brand_key="b", competitor_id=3)
    assert not any(item["category"] == "verified_change" for item in findings)
    assert any(item["category"] in {"coverage_gap", "unavailable"} for item in findings)
    assert coverage["deleted_confirmed"] == 0
