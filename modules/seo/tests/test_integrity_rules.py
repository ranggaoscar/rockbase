import asyncio

import httpx
import pytest

from seo_engine.policy import PolicyError, PoliteClient
from seo_engine.rules import audit_pages, extract_page, failed_page


async def allow_test(url):
    pass


def response(path="/", html="", status=200, headers=None):
    url = "https://example.test" + path
    return httpx.Response(
        status,
        headers={"content-type": "text/html", **(headers or {})},
        text=html,
        request=httpx.Request("GET", url),
    )


def page(path, *, description=None, final_url=None, status=200, directives="", canonical=""):
    url = "https://example.test" + path
    final_url = final_url or url
    description = description if description is not None else f"Description for {path}"
    html = (
        f'<title>{path}</title><meta name="description" content="{description}">'
        f'<meta name="robots" content="{directives}"><h1>Page</h1>'
        f'<link rel="canonical" href="{canonical or final_url}">'
    )
    res = httpx.Response(status, headers={"content-type": "text/html"}, text=html, request=httpx.Request("GET", final_url))
    return extract_page(url, res, [], "https://example.test/")


def test_extraction_records_each_safe_hyperlink_and_canonical_occurrence():
    html = '''<title>Page</title>
      <a href="/next">First</a><a href="/next" rel="NOFOLLOW sponsored">Again</a>
      <a href="https://example.test/?token=private">unsafe</a>
      <link rel="canonical" href="/preferred">
    '''
    p = extract_page("https://example.test/start", response("/start", html), [], "https://example.test/")
    assert p["internal_links"] == ["https://example.test/next"]
    assert p["first_status_code"] == p["final_status_code"] == p["status_code"] == 200
    assert p["link_edges"] == [
        {"source_url": "https://example.test/start", "target_url": "https://example.test/next", "kind": "hyperlink", "anchor": "First", "rel": [], "follow": True, "occurrence": 0},
        {"source_url": "https://example.test/start", "target_url": "https://example.test/next", "kind": "hyperlink", "anchor": "Again", "rel": ["nofollow", "sponsored"], "follow": False, "occurrence": 1},
        {"source_url": "https://example.test/start", "target_url": "https://example.test/preferred", "kind": "canonical", "anchor": "", "rel": ["canonical"], "follow": True, "occurrence": 0},
    ]
    assert p["link_edges_truncated"] is False
    assert "private" not in repr(p)


def test_edge_storage_is_bounded_and_reports_truncation():
    links = "".join(f'<a href="/p{i}">p</a>' for i in range(5002))
    p = extract_page("https://example.test/", response("/", links), [], "https://example.test/")
    assert len(p["link_edges"]) == 5000
    assert p["link_edges_truncated"] is True


def test_page_nofollow_directive_marks_all_hyperlinks_unfollowed():
    html = '<meta name="ROBOTS" content="noindex, nofollow"><a href="/target">Target</a>'
    p = extract_page("https://example.test/", response("/", html), [], "https://example.test/")
    assert p["link_edges"][0]["follow"] is False


def test_canonical_edge_included_within_5000_edge_limit():
    links = "".join(f'<a href="/p{i}">p</a>' for i in range(5000))
    html = links + '<link rel="canonical" href="/preferred">'
    p = extract_page("https://example.test/", response("/", html), [], "https://example.test/")
    assert len(p["link_edges"]) == 5000
    assert p["link_edges"][-1]["kind"] == "canonical"
    assert p["link_edges_truncated"] is True


def test_x_robots_nofollow_marks_hyperlink_unfollowed():
    p = extract_page("https://example.test/", response("/", '<a href="/target">Target</a>', headers={"x-robots-tag": "NoFollow"}), [], "https://example.test/")
    assert p["link_edges"][0]["follow"] is False


def test_unsafe_redirect_destination_preserves_hop_without_leaking_value():
    async def run():
        client = PoliteClient("https://example.test/", transport=httpx.MockTransport(lambda request: httpx.Response(302, headers={"location": "https://example.test/?token=hidden"})), validate=allow_test, delay=0)
        try:
            with pytest.raises(PolicyError) as exc:
                await client.fetch("https://example.test/start")
            assert exc.value.response.status_code == 302
            return exc.value
        finally:
            await client.close()

    error = asyncio.run(run())
    failed = failed_page("https://example.test/start", error)
    assert failed["redirect_chain"] == [{"url": "https://example.test/start", "status": 302, "location": ""}]
    assert "hidden" not in repr(failed)


def test_failed_page_uses_last_observed_response_url():
    error = PolicyError("redirect blocked")
    error.response = httpx.Response(302, request=httpx.Request("GET", "https://example.test/hop"))
    error.redirect_chain = [{"url": "https://example.test/start", "status": 302, "location": "https://example.test/hop"}]
    p = failed_page("https://example.test/start", error)
    assert p["final_url"] == "https://example.test/hop"
    assert p["first_status_code"] == 302
    assert p["final_status_code"] == 302
    assert p["redirect_chain"] == error.redirect_chain


def test_redirect_loop_fails_without_fetching_repeated_destination():
    seen = []
    def transport(request):
        seen.append(str(request.url))
        return httpx.Response(301, headers={"location": "/start"})

    async def run():
        client = PoliteClient("https://example.test/", transport=httpx.MockTransport(transport), validate=allow_test, delay=0)
        try:
            with pytest.raises(PolicyError) as exc:
                await client.fetch("https://example.test/start")
            return exc.value
        finally:
            await client.close()

    error = asyncio.run(run())
    assert seen == ["https://example.test/start"]
    assert error.response.status_code == 301
    assert error.redirect_chain == [{"url": "https://example.test/start", "status": 301, "location": "https://example.test/start"}]


def test_integrity_rules_classify_canonical_outcomes_and_duplicates():
    source = page("/source", canonical="/missing")
    missing = page("/missing", status=404)
    noindex_target = page("/noindex", directives="NOINDEX")
    source_noindex = page("/source-noindex", canonical="/noindex")
    blocked_target = failed_page("https://example.test/blocked", "Blocked by robots.txt; not fetched")
    source_blocked = page("/source-blocked", canonical="/blocked")
    redirected = page("/redirect-target", final_url="https://example.test/final")
    redirected["redirect_chain"] = [{"url": redirected["url"], "status": 301, "location": redirected["final_url"]}]
    source_redirected = page("/source-redirected", canonical="/redirect-target")
    final = page("/final", description="different")
    unknown = page("/unknown-source", canonical="/not-observed")
    source_unknown = page("/unknown-canonical", canonical="/also-not-observed")
    conflict_a = page("/conflict", canonical="/preferred-a")
    conflict_alias = page("/conflict-alias", canonical="/preferred-b", final_url="https://example.test/conflict")
    loop_a = page("/loop-a", canonical="/loop-b")
    loop_b = page("/loop-b", canonical="/loop-a")
    conflicting = page("/conflict-a", canonical="/conflict-x")
    conflicting2 = page("/conflict-a-copy", canonical="/conflict-y")
    dup_a = page("/dup-a", description="Repeated")
    dup_b = page("/dup-b", description="Repeated")
    dup_alias = page("/dup-alias", description="Repeated", final_url=dup_a["final_url"])
    pages = [source, missing, noindex_target, source_noindex, blocked_target, source_blocked, redirected, source_redirected, final, unknown, source_unknown, conflict_a, conflict_alias, loop_a, loop_b, conflicting, conflicting2, dup_a, dup_b, dup_alias]
    issues = audit_pages(pages)
    codes = [issue["code"] for issue in issues]
    assert "canonical_target_error" in codes
    assert "canonical_target_noindex" in codes
    assert "canonical_target_blocked" in codes
    assert "canonical_target_redirect" in codes
    assert "canonical_target_unknown" in codes
    assert "canonical_loop" in codes
    assert "canonical_conflict" in codes
    assert "canonical_invalid" not in codes
    duplicate_descriptions = [issue for issue in issues if issue["code"] == "duplicate_description"]
    assert {issue["url"] for issue in duplicate_descriptions} == {dup_a["url"], dup_b["url"]}
    assert not any(issue["code"] == "canonical_target_error" and issue["url"] == missing["url"] for issue in issues)


def test_redirect_issues_keep_first_final_status_and_no_duplicate_alias_content():
    alias = page("/alias", description="Same", final_url="https://example.test/destination")
    alias["first_status_code"] = 301
    alias["final_status_code"] = alias["status_code"] = 200
    alias["redirect_chain"] = [{"url": alias["url"], "status": 301, "location": alias["final_url"]}]
    destination = page("/destination", description="Same")
    destination["redirect_chain"] = alias["redirect_chain"]
    issues = audit_pages([alias, destination])
    redirect_issues = [issue for issue in issues if issue["code"] == "redirect"]
    assert len(redirect_issues) == 1
    assert redirect_issues[0]["details"]["first_status_code"] == 301
    assert redirect_issues[0]["details"]["final_status_code"] == 200
    assert not any(issue["code"] == "duplicate_description" for issue in issues)


def test_canonical_credential_url_is_not_retained():
    html = '<link rel="canonical" href="https://example.test/?token=do-not-store">'
    p = extract_page("https://example.test/", response("/", html), [], "https://example.test/")
    assert p["canonical"] == ""
    assert all("do-not-store" not in repr(value) for value in p.values())


def test_redirect_limit_error_preserves_last_observed_response_and_chain():
    def transport(request):
        path = request.url.path
        index = int(path.removeprefix("/hop")) if path.startswith("/hop") else 0
        return httpx.Response(302, headers={"location": f"/hop{index + 1}"})

    async def run():
        client = PoliteClient("https://example.test/", transport=httpx.MockTransport(transport), validate=allow_test, delay=0)
        try:
            with pytest.raises(PolicyError) as exc:
                await client.fetch("https://example.test/")
            assert exc.value.response.status_code == 302
            assert len(exc.value.redirect_chain) == 9
            return exc.value
        finally:
            await client.close()

    error = asyncio.run(run())
    failed = failed_page("https://example.test/", error)
    assert failed["status_code"] == 302
    assert failed["first_status_code"] == 302
    assert len(failed["redirect_chain"]) == 9
