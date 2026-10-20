import asyncio

from fastapi.testclient import TestClient

from seo_engine.api import create_app
from seo_engine.repository import Repository


def setup_competitor(tmp_path):
    repo = Repository(tmp_path / "inspector.sqlite")
    repo.register_brand("workspace-a", "brand", "Brand")
    repo.add_competitor("workspace-a", "brand", "Rival", "https://rival.example")
    competitor = repo.competitors("workspace-a")[0]
    return repo, competitor


def add_scan(repo, competitor, status, pages, summary=None):
    scan = repo.create_scan(competitor["website_id"], 10, "http")
    for page in pages:
        repo.save_page(scan["id"], page)
    repo.update_scan(scan["id"], status=status, summary=summary or {}, error="partial crawl" if status != "completed" else None)
    return repo.scan(scan["id"])


def client_for(repo):
    return TestClient(create_app(repo, token="secret", validate=lambda url: asyncio.sleep(0)))


def test_inspector_projects_stored_pages_and_separates_baseline_observations(tmp_path):
    repo, competitor = setup_competitor(tmp_path)
    owned = repo.add_website("workspace-a", "Owned", "https://owned.example", "brand")
    own_scan = repo.create_scan(owned["id"], 10, "http")
    repo.save_page(own_scan["id"], {"url": "https://owned.example/", "status_code": 200, "content_type": "text/html", "title": "Mine", "h1": ["Our product"]})
    repo.update_scan(own_scan["id"], status="completed", summary={})
    pages = [
        {"url": "https://rival.example/", "final_url": "https://rival.example/", "status_code": 200, "content_type": "text/html; charset=utf-8", "title": "Rival", "description": "A", "h1": ["One", "Two"], "headings": ["One", "Two"], "canonical": "https://rival.example/", "indexable": True, "meta_robots": "", "x_robots_tag": "", "internal_links": ["https://rival.example/about"], "render_mode": "http", "observed_at": "2026-10-19T00:00:00+00:00", "body": "not for projection"},
        {"url": "https://rival.example/bad", "status_code": 503, "content_type": "text/html", "error": "HTTP 503", "observed_at": "2026-10-19T00:00:00+00:00"},
    ]
    scan = add_scan(repo, competitor, "completed", pages, {"discovered": 4, "limit_reached": True})
    response = client_for(repo).get(f"/api/competitors/{competitor['id']}/findings?scan_id={scan['id']}", headers={"x-seo-token": "secret", "x-workspace-id": "workspace-a"})
    assert response.status_code == 200
    report = response.json()
    assert [p["url"] for p in report["pages"]] == ["https://rival.example/", "https://rival.example/bad"]
    assert "body" not in report["pages"][0]
    obs = report["observations"]
    assert obs["successful_html"] == 1 and obs["unavailable"] == 1
    assert obs["missing_title"] == 0 and obs["multiple_h1"] == 1
    assert obs["headings_count"] == 2 and obs["unique_internal_targets"] == 1 and obs["link_references"] == 1
    assert obs["discovered"] == 4 and obs["limit"] == 10 and obs["omitted"] == 2
    assert obs["baseline"] is True and obs["own_baseline"]["available"] is True
    assert any(f["category"] == "baseline" for f in report["findings"])
    assert not any(f["category"] == "verified_change" for f in report["findings"])
    assert report["pages"][0]["successful_html"] is True
    assert report["pages"][1]["successful_html"] is False
    assert obs["complete"] is False
    assert report["coverage"]["deleted_confirmed"] == 0


def test_legacy_heading_schema_is_unknown_and_missing_scan_is_null(tmp_path):
    repo, competitor = setup_competitor(tmp_path)
    client = client_for(repo)
    headers = {"x-seo-token": "secret", "x-workspace-id": "workspace-a"}
    empty = client.get(f"/api/competitors/{competitor['id']}/findings", headers=headers).json()
    assert empty["pages"] == [] and empty["observations"] is None
    scan = add_scan(repo, competitor, "completed", [{"url": "https://rival.example/", "status_code": 200, "content_type": "text/html", "title": "", "description": "", "h1": []}], {})
    report = client.get(f"/api/competitors/{competitor['id']}/findings?scan_id={scan['id']}", headers=headers).json()
    assert report["observations"]["headings_count"] is None
    assert report["observations"]["headings_available"] is False
    assert report["observations"]["missing_title"] == 1
    assert report["observations"]["missing_description"] == 1
    assert any(f["category"] == "baseline" for f in report["findings"])
    assert report["pages"][0]["observed_at"] == scan["finished_at"]


def test_incomplete_snapshot_retains_inspector_pages_and_rejects_foreign_access(tmp_path):
    repo, competitor = setup_competitor(tmp_path)
    scan = add_scan(repo, competitor, "failed", [{"url": "https://rival.example/", "status_code": 200, "content_type": "text/html", "title": "Observed"}, {"url": "https://rival.example/no", "status_code": None, "error": "timeout"}], {"discovered": 3})
    client = client_for(repo)
    headers = {"x-seo-token": "secret", "x-workspace-id": "workspace-a"}
    report = client.get(f"/api/competitors/{competitor['id']}/findings?scan_id={scan['id']}", headers=headers).json()
    assert len(report["pages"]) == 2 and report["observations"]["unavailable"] == 1
    assert report["observations"]["complete"] is False
    assert any("incomplete" in item.lower() for item in report["observations"]["banner"])
    assert client.get(f"/api/competitors/{competitor['id']}/findings?scan_id={scan['id']}", headers={**headers, "x-workspace-id": "other"}).status_code == 404
    assert client.get(f"/api/competitors/{competitor['id']}/findings?scan_id=99999", headers=headers).status_code == 404
    assert not any(f["category"] == "baseline" for f in report["findings"])


def test_unknown_legacy_fields_are_not_zero_and_reading_preserves_timestamp():
    from seo_engine.competitors import snapshot_inspector
    pages = [{"url": "https://rival.example/", "status_code": 200, "content_type": "text/html"}, {"url": "https://rival.example/known", "status_code": 200, "content_type": "text/html", "title": "Known", "internal_links": []}]
    scan = {"status": "completed", "max_urls": 8, "finished_at": "2020-01-01T00:00:00+00:00", "summary": {"discovered_count": 10}}
    projected, observed = snapshot_inspector(pages, scan)
    assert observed["missing_title"] is None
    assert observed["missing_description"] is None
    assert observed["unique_internal_targets"] is None
    assert observed["duplicate_title_pages"] is None
    assert observed["complete"] is False
    assert observed["omitted"] == 8
    assert all(p["observed_at"] == scan["finished_at"] for p in projected)
    assert snapshot_inspector(pages, scan) == (projected, observed)
