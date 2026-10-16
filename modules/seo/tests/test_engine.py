import asyncio
import csv
import io
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from seo_engine.api import create_app
from seo_engine.crawler import SeoCrawler
from seo_engine.policy import PolicyError, PoliteClient, internal_url, normalize_url, validate_public
from seo_engine.repository import Repository
from seo_engine.rules import audit_pages, extract_page, failed_page


async def allow_test(url):
    pass


def page(path="/", html=None, status=200, headers=None):
    url = "https://example.com" + path
    response = httpx.Response(status, headers={"content-type": "text/html", **(headers or {})}, text=html or '<title>Page</title><meta name="description" content="About"><h1>Heading</h1><link rel="canonical" href="'+url+'">', request=httpx.Request("GET", url))
    return extract_page(url, response, [], "https://example.com/")


def test_url_policy():
    assert normalize_url("HTTPS://EXAMPLE.com:443/a#section") == "https://example.com/a"
    assert internal_url("/b#x", "https://example.com/a", "https://example.com/") == "https://example.com/b"
    assert internal_url("https://other.com/b", "https://example.com/", "https://example.com/") is None
    assert internal_url("/asset.jpg", "https://example.com/", "https://example.com/") is None
    for value in ["file:///etc/passwd", "https://user:pass@example.com/"]:
        with pytest.raises(PolicyError):
            normalize_url(value)
    with pytest.raises(PolicyError):
        asyncio.run(validate_public("http://127.0.0.1/"))
    with pytest.raises(PolicyError):
        asyncio.run(validate_public("https://example.com:8765/"))


def test_rules_and_duplicates_only_on_html_success():
    a = page("/a")
    b = page("/b")
    missing = page("/missing", '<html><body><h1></h1></body></html>')
    noindex = page("/noindex", headers={"x-robots-tag": "noindex"})
    broken = page("/dead", status=404)
    a["internal_links"] = [broken["url"], "https://example.com/not-crawled"]
    issues = audit_pages([a, b, missing, noindex, broken])
    codes = [i["code"] for i in issues]
    assert codes.count("duplicate_title") == 3
    assert {"missing_title", "missing_description", "missing_h1", "missing_canonical", "noindex", "http_error", "broken_internal_link"} <= set(codes)
    assert sum(i["code"] == "broken_internal_link" for i in issues) == 1
    assert not noindex["indexable"]
    redirect = page("/alias")
    redirect["final_url"] = a["final_url"]
    assert not any(i["code"] == "duplicate_title" for i in audit_pages([a, redirect]))


def test_robots_redirects_and_http_errors():
    hits = []
    def transport(req):
        hits.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private\nCrawl-delay: 0")
        if req.url.path == "/redirect":
            return httpx.Response(302, headers={"location": "/private"})
        if req.url.path == "/external":
            return httpx.Response(301, headers={"location": "http://127.0.0.1/"})
        return httpx.Response(404, text="not found")
    async def run():
        client = PoliteClient("https://example.com/", transport=httpx.MockTransport(transport), validate=allow_test, delay=0)
        await client.load_robots()
        assert not client.allowed("https://example.com/private")
        for path in ["redirect", "external"]:
            response, chain = await client.fetch("https://example.com/" + path)
            assert len(chain) == 1 and response.status_code in {301, 302}
        with pytest.raises(PolicyError):
            await client.fetch("https://example.com/private")
        response, _ = await client.fetch("https://example.com/dead")
        assert response.status_code == 404
        await client.close()
    asyncio.run(run())
    assert "/private" not in hits


def test_crawlee_fixture_persistence_limits_and_broken_link(tmp_path):
    hits = []
    def transport(req):
        path = req.url.path
        hits.append(path)
        if path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")
        if path == "/sitemap.xml":
            return httpx.Response(200, text='<urlset><url><loc>https://example.com/a</loc></url></urlset>', headers={"content-type": "application/xml"})
        if path == "/dead":
            return httpx.Response(404, text="Not found", headers={"content-type": "text/html"})
        html = '<title>Duplicate</title><h1>One</h1><a href="/dead">Dead</a><a href="/private">Private</a><a href="/unseen">More</a>'
        return httpx.Response(200, text=html, headers={"content-type": "text/html"})
    repo = Repository(tmp_path / "seo.sqlite")
    website = repo.add_website("w1", "Fixture", "https://example.com/")
    scan = repo.create_scan(website["id"], 4, "http")
    async def run():
        client = PoliteClient(website["base_url"], transport=httpx.MockTransport(transport), validate=allow_test, delay=0)
        await SeoCrawler(repo, scan, website, client=client).run()
    asyncio.run(run())
    result = repo.scan(scan["id"])
    assert result["status"] == "completed", result
    assert result["pages_count"] == 4
    assert result["summary"]["limit_reached"]
    assert result["summary"]["skipped_robots"] == 1
    assert "/private" not in hits
    assert any(i["code"] == "broken_internal_link" for i in repo.rows("issues", scan["id"]))
    assert repo.compare(scan["id"])["previous_scan_id"] is None


def test_api_scope_exports_and_compare(tmp_path):
    repo = Repository(tmp_path / "seo.sqlite")
    website = repo.add_website("w1", "Fixture", "https://example.com/")
    old = repo.create_scan(website["id"], 100, "http")
    p = page()
    p["title"] = "=HYPERLINK(1)"
    repo.save_page(old["id"], p)
    repo.save_issues(old["id"], [{"url": p["url"], "code": "missing_description", "priority": "medium", "title": "Missing description", "recommendation": "Add description", "details": {}}])
    repo.update_scan(old["id"], status="completed")
    new = repo.create_scan(website["id"], 100, "http")
    changed = {**p, "title": "Changed"}
    repo.save_page(new["id"], changed)
    repo.update_scan(new["id"], status="completed")
    with TestClient(create_app(repo, token="test-token", validate=allow_test)) as client:
        assert client.get("/api/health").status_code == 401
        headers = {"x-seo-token": "test-token", "x-workspace-id": "w1"}
        assert client.get("/api/health", headers=headers).status_code == 200
        assert client.get(f'/api/scans/{old["id"]}', headers={**headers, "x-workspace-id": "other"}).status_code == 404
        assert client.post(f'/api/websites/{website["id"]}/scans', json={"max_urls": 101}, headers=headers).status_code == 422
        response = client.get(f'/api/scans/{old["id"]}/export?kind=pages&format=csv', headers=headers)
        assert response.status_code == 200
        assert list(csv.DictReader(io.StringIO(response.text.lstrip("\ufeff"))))[0]["title"].startswith("'=")
        exported = client.get(f'/api/scans/{old["id"]}/export?kind=issues&format=json&priority=high', headers=headers).json()
        assert exported["results"] == []
        compare = client.get(f'/api/scans/{new["id"]}/compare', headers=headers).json()
        assert compare["changed_urls"][0]["fields"]["title"]["after"] == "Changed"
        assert len(compare["resolved_issues"]) == 1


def test_existing_website_brand_can_be_linked(tmp_path):
    repo = Repository(tmp_path / "seo.sqlite")
    site = repo.add_website("workspace", "Magrade", "https://magrade.co.id/", "")
    assert site["brand_key"] == ""
    linked = repo.set_brand(site["id"], "workspace", "Magrade")
    assert linked["id"] == site["id"] and linked["brand_key"] == "Magrade"
    assert repo.websites("workspace").__len__() == 1
    assert repo.set_brand(site["id"], "other", "Magrade") is None


def test_single_active_and_restart_recovery(tmp_path):
    repo = Repository(tmp_path / "seo.sqlite")
    website = repo.add_website("w", "Site", "https://example.com/")
    scan = repo.create_scan(website["id"], 10, "http")
    with pytest.raises(sqlite3.IntegrityError):
        repo.create_scan(website["id"], 10, "http")
    repo.save_page(scan["id"], failed_page("https://example.com/", "interrupted"))
    with TestClient(create_app(repo, token="token")):
        assert repo.scan(scan["id"])["status"] == "interrupted"
        assert repo.scan(scan["id"])["pages_count"] == 1
