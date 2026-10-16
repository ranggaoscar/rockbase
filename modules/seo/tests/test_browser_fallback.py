"""Focused JS-shell selection test: fake renderer is isolated in a temporary fixture DB."""
import asyncio

import httpx

from seo_engine.crawler import SeoCrawler
from seo_engine.policy import PoliteClient
from seo_engine.repository import Repository


async def allow_test(url):
    pass


def test_js_shell_uses_renderer_without_second_engine(tmp_path):
    def transport(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /")
        if request.url.path == "/sitemap.xml":
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": "text/html"}, text='<html><head><title>Shell</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
    repo = Repository(tmp_path / "fixture.sqlite")
    site = repo.add_website("fixture-only", "JS fixture", "https://example.com/")
    scan = repo.create_scan(site["id"], 1, "auto")
    async def run():
        client = PoliteClient(site["base_url"], transport=httpx.MockTransport(transport), validate=allow_test, delay=0)
        crawler = SeoCrawler(repo, scan, site, client=client)
        async def render(url):
            return '<html><title>Rendered fixture</title><body><h1>Rendered heading</h1></body></html>'
        crawler.render = render
        await crawler.run()
    asyncio.run(run())
    result = repo.rows("pages", scan["id"])[0]
    assert result["render_mode"] == "browser"
    assert result["title"] == "Rendered fixture" and result["h1"] == ["Rendered heading"]
