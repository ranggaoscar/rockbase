"""Public synthetic evidence, real repository/API, no external requests."""
import asyncio
from copy import deepcopy
from fastapi.testclient import TestClient
from seo_engine.api import create_app
from seo_engine.repository import Repository, now
from seo_engine.competitors import compare_pages, analyze


def page(url="https://rival.example/", **changes):
    return {"url": url, "status_code": 200, "content_type": "text/html", "error": "", "title": "Before", "description": "Original", "h1": ["Travertine maintenance techniques"], "canonical": url, "indexable": True, "meta_robots": "", "x_robots_tag": "", "internal_links": [url + "a", url + "b"], **changes}


def compare(old, new):
    return compare_pages(old, new, current_scan_id=2, previous_scan_id=1, brand_key="alpha", competitor_id=1, observed_at="2026-01-01T00:00:00+00:00", previous_observed_at="2025-12-01T00:00:00+00:00")


def test_unchanged_order_independent_and_real_metadata_changes():
    old = page()
    reordered = page(internal_links=list(reversed(old["internal_links"])))
    assert compare([old], [reordered])[0] == []
    changed = page(title="After", description="Updated", h1=["Updated heading"], canonical="https://rival.example/new", indexable=False, meta_robots="noindex", x_robots_tag="nofollow", internal_links=[])
    findings, _ = compare([old], [changed])
    assert len(findings) == 1
    assert set(findings[0]["changes"]) == {"title", "description", "h1", "canonical", "indexable", "meta_robots", "x_robots_tag", "internal_links"}
    assert findings[0]["observed_at"] == "2026-01-01T00:00:00+00:00"
    assert findings == compare([old], [changed])[0]


def test_403_404_nonhtml_unknown_and_missing_are_not_changes_or_deleted():
    for bad in [page(status_code=403), page(status_code=404), page(error="timeout"), page(content_type="application/pdf"), page(status_code=None), page(title="Verify you are human")]:
        findings, coverage = compare([page()], [bad])
        assert not any(f["category"] in {"verified_change", "newly_observed", "coverage_gap"} for f in findings)
        assert any(f["category"] == "unavailable" for f in findings)
        assert coverage["deleted_confirmed"] == 0
    findings, _ = compare([page()], [])
    assert [f["category"] for f in findings] == ["unverified"]
    assert not compare([], [page()])[0][0]["category"] == "verified_change"


def test_relationship_identity_history_retention_and_no_owned_mutation(tmp_path):
    repo = Repository(tmp_path / "seo.sqlite")
    repo.register_brand("w", "alpha", "Alpha")
    repo.register_brand("w", "beta", "Beta")
    repo.add_competitor("w", "alpha", "Rival", "https://rival.example/")
    repo.add_competitor("w", "beta", "Rival", "https://rival.example/")
    alpha, beta = repo.competitors("w")
    assert alpha["id"] != beta["id"] and alpha["website_id"] == beta["website_id"]
    assert alpha["brand_key"] == "alpha" and beta["brand_key"] == "beta"
    assert repo.competitor(alpha["id"], "other") is None
    assert repo.websites("w") == []
    owned = repo.add_website("w", "Owned", "https://owned.example/", "alpha")
    for index in range(8):
        for site in [owned, {"id": alpha["website_id"]}]:
            scan = repo.create_scan(site["id"], 1, "http")
            repo.save_page(scan["id"], page())
            repo.update_scan(scan["id"], status="completed")
    repo.prune_competitor_scans(alpha["website_id"])
    repo.prune_competitor_scans(owned["id"])
    assert len(repo.scans(alpha["website_id"])) == 5
    assert len(repo.scans(owned["id"])) == 8
    assert repo.set_brand(alpha["website_id"], "w", "alpha") is None
    client = TestClient(create_app(repo, token="fixture", validate=lambda url: asyncio.sleep(0)))
    headers = {"x-seo-token": "fixture", "x-workspace-id": "w"}
    assert client.post(f"/api/websites/{alpha['website_id']}/scans", headers=headers, json={"max_urls":100,"mode":"browser"}).status_code == 409
    assert client.post(f"/api/competitors/{alpha['id']}/scans", headers=headers, json={"max_urls":26}).status_code == 422
    assert client.get(f"/api/competitors/{alpha['id']}/findings?scan_id=999999", headers=headers).status_code == 404


def test_fresh_owned_coverage_hypothesis_stale_evidence_and_failed_scan(tmp_path):
    repo = Repository(tmp_path / "seo.sqlite")
    repo.register_brand("w", "alpha", "Alpha")
    owned = repo.add_website("w", "Owned", "https://owned.example/", "alpha")
    baseline = repo.create_scan(owned["id"], 1, "http")
    repo.save_page(baseline["id"], page("https://owned.example/", h1=["Marble catalogue"]))
    repo.update_scan(baseline["id"], status="completed")
    repo.add_competitor("w", "alpha", "Rival", "https://rival.example/")
    competitor = repo.competitors("w")[0]
    scan = repo.create_scan(competitor["website_id"], 1, "http")
    repo.save_page(scan["id"], page())
    repo.update_scan(scan["id"], status="completed")
    report = analyze(repo, competitor)
    assert any(f["category"] == "coverage_gap" for f in report["findings"])
    assert report["coverage"]["owned_baseline_pages"] == 1
    before = deepcopy(report)
    assert analyze(repo, competitor) == before  # Reading cannot refresh observation timestamps.
    with repo.connect() as db:
        db.execute("UPDATE scans SET finished_at='2020-01-01T00:00:00+00:00' WHERE id=?", (scan["id"],))
    stale = analyze(repo, competitor)
    assert not stale["coverage"]["evidence_fresh"]
    assert not any(f["category"] == "coverage_gap" for f in stale["findings"])
    fail = repo.create_scan(competitor["website_id"], 1, "http")
    repo.save_page(fail["id"], page(title="Partial changed"))
    repo.update_scan(fail["id"], status="failed", error="fixture failure")
    assert all(f["category"] in {"unavailable", "unverified"} for f in analyze(repo, competitor)["findings"])


def test_all_heading_levels_are_bounded_and_compared():
    import httpx
    from seo_engine.rules import extract_page
    url = "https://rival.example/"
    def extract(html):
        response = httpx.Response(200, headers={"content-type": "text/html"}, text=html, request=httpx.Request("GET", url))
        return extract_page(url, response, [], url)
    before = extract("<title>Same</title><h1>Same</h1><h2>Before</h2>")
    after = extract("<title>Same</title><h1>Same</h1><h2>After</h2>")
    findings, _ = compare([before], [after])
    assert set(findings[0]["changes"]) == {"headings"}
    assert len(extract("<h3>" + "long" * 200 + "</h3>" + "<h4>x</h4>" * 150)["headings"]) == 100
