from seo_engine.sampling import order_representative_urls


def test_language_variants_deferred_but_content_queries_preserved():
    urls = [
        "https://x.test/about?lang=fr", "https://x.test/about?lang=en",
        "https://x.test/about?color=red", "https://x.test/about?color=blue",
        "https://x.test/fr/products", "https://x.test/products",
        "https://x.test/projects/1", "https://x.test/contact",
    ]
    ordered, deferred = order_representative_urls(urls)
    assert deferred == 2
    assert len(ordered) == len(set(urls))
    assert ordered.index("https://x.test/about?color=blue") < ordered.index("https://x.test/about?lang=en")
    assert ordered.index("https://x.test/products") < ordered.index("https://x.test/fr/products")


def test_root_priority_families_and_deterministic_truncation():
    urls = [f"https://x.test/blog/{i}" for i in range(12)] + [
        "https://x.test/", "https://x.test/about", "https://x.test/products",
        "https://x.test/projects", "https://x.test/contact",
    ]
    first, deferred = order_representative_urls(urls)
    assert first == order_representative_urls(list(reversed(urls)))[0]
    assert first[:6] == ["https://x.test/", "https://x.test/about", "https://x.test/products", "https://x.test/projects", "https://x.test/contact", "https://x.test/blog/0"]
    assert deferred == 0


def test_unknown_pages_are_retained_and_missing_families_do_not_error():
    urls = ["https://x.test/misc/a", "https://x.test/misc/b", "https://x.test/de/blog"]
    # A sole language-prefixed version is kept as that family's representative.
    ordered, deferred = order_representative_urls(urls)
    assert set(ordered) == set(urls)
    assert deferred == 0  # Only one version of this page family exists; do not penalize it.
    assert len(order_representative_urls(urls, limit=1)[0]) == 1
    assert len(order_representative_urls(urls, limit=8)[0]) == 3


def test_language_only_site_selects_representative_per_family():
    urls = [f"https://x.test/{path}?locale={lang}" for path in ["", "about", "stone", "projects", "contact", "blog/topic"] for lang in ["en", "id", "fr"]]
    ordered, deferred = order_representative_urls(urls)
    assert len(ordered) == 18 and deferred == 12
    assert len({u.split("?", 1)[0] for u in ordered[:6]}) == 6
    assert ordered == order_representative_urls(reversed(urls))[0]
    assert set(ordered) == set(urls)


def test_content_parameters_never_become_language_equivalence():
    from seo_engine.sampling import language_family
    assert language_family("https://x.test/stone?color=red&locale=id") != language_family("https://x.test/stone?color=blue&locale=en")
    assert language_family("https://x.test/id/stone?color=red") == language_family("https://x.test/en/stone?color=red")
    assert language_family("https://x.test/custom-code/stone") != language_family("https://x.test/stone")


def test_real_crawler_representative_limits_robots_and_version_retention(tmp_path):
    import asyncio
    import httpx
    from seo_engine.crawler import SeoCrawler
    from seo_engine.policy import PoliteClient
    from seo_engine.repository import Repository
    urls = ["https://x.test/", "https://x.test/?locale=en", "https://x.test/about", "https://x.test/about?locale=en", "https://x.test/stone", "https://x.test/projects", "https://x.test/contact", "https://x.test/blog/topic", "https://x.test/private"]
    hits = []
    def handler(request):
        hits.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")
        if request.url.path == "/sitemap.xml":
            return httpx.Response(200, text="<urlset>" + "".join(f"<url><loc>{url}</loc></url>" for url in urls) + "</urlset>")
        return httpx.Response(200, headers={"content-type": "text/html"}, text='<title>Fixture</title><h1>Fixture</h1><a href="/other">Observed unvisited target</a>')
    async def validate(url):
        pass
    repo = Repository(tmp_path / "seo.sqlite")
    website = repo.add_website("w", "Fixture", "https://x.test/")
    async def run(limit, representative):
        scan = repo.create_scan(website["id"], limit, "http")
        client = PoliteClient(website["base_url"], transport=httpx.MockTransport(handler), validate=validate, delay=0)
        await SeoCrawler(repo, scan, website, client=client, representative=representative).run()
        return repo.scan(scan["id"]), repo.rows("pages", scan["id"], analysis=False)
    scan, pages = asyncio.run(run(8, True))
    assert scan["pages_count"] == 8 and scan["summary"]["limit_reached"]
    assert {"https://x.test/", "https://x.test/about", "https://x.test/stone", "https://x.test/projects", "https://x.test/contact", "https://x.test/blog/topic"} <= {p["url"] for p in pages}
    assert "https://x.test/private" not in hits
    assert any(p["url"] == "https://x.test/private" and p["status_code"] is None for p in pages)
    sample = scan["summary"]["sampling"]
    assert sample["accepted_sample_count"] == 8 and sample["omitted_sample_count"] >= 1
    assert sample["language_variants_deferred"] == 2
    assert sample["content_equivalence_claimed"] is False
    assert sample["fetched_page_count"] == 7 and sample["robots_denied_count"] == 1
    assert all(p["render_mode"] != "browser" for p in pages)
    single, single_pages = asyncio.run(run(1, True))
    assert [p["url"] for p in single_pages] == ["https://x.test/"]
    full, full_pages = asyncio.run(run(12, True))
    assert set(urls) <= {p["url"] for p in full_pages}  # Deferred versions still stored independently when budget permits.
    owned, owned_pages = asyncio.run(run(2, False))
    assert "sampling" not in owned["summary"]
    assert {p["url"] for p in owned_pages} == {"https://x.test/", "https://x.test/?locale=en"}
