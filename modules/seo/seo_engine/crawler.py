"""Crawlee scheduling + deterministic HTTP extraction; isolated browser fallback."""
import asyncio
import time
from collections import Counter
from datetime import timedelta
from uuid import uuid4


from bs4 import BeautifulSoup
from crawlee import ConcurrencySettings
from crawlee.crawlers import BasicCrawler
from crawlee.storage_clients import MemoryStorageClient
from crawlee.storages import RequestQueue
from defusedxml import ElementTree

from .policy import PoliteClient, internal_url, normalize_url, origin
from .rules import audit_pages, extract_page, failed_page
from .graph import build_graph
from .triage import enrich_issue


class SeoCrawler:
    def __init__(self, repo, scan, website, *, client=None):
        self.repo, self.scan, self.website = repo, scan, website
        self.client = client or PoliteClient(website["base_url"])
        self.admitted, self.discovered, self.pages = set(), set(), []
        self.summary = {"status_counts": {}, "priority_counts": {}, "indexable_count": 0,
                        "robots_url": origin(website["base_url"]) + "/robots.txt", "robots_status": None,
                        "sitemap_urls": [], "sitemap_edges": [], "sitemap_discovered": 0, "discovered_count": 0,
                        "skipped_robots": 0, "warnings": [], "limit_reached": False}
        self.pw = self.browser = None
        self.browser_lock = asyncio.Lock()

    def persist(self, page):
        self.pages.append(page)
        self.repo.save_page(self.scan["id"], page)
        self.summary["status_counts"] = dict(Counter(str(p["status_code"]) if p["status_code"] is not None else "not_fetched" for p in self.pages))
        self.summary["indexable_count"] = sum(p["indexable"] for p in self.pages)
        self.summary["discovered_count"] = len(self.discovered)
        self.repo.update_scan(self.scan["id"], summary=self.summary)

    async def admit(self, urls):
        accepted = []
        for value in urls:
            url = internal_url(value, self.website["base_url"], self.website["base_url"])
            if not url:
                continue
            self.discovered.add(url)
            if url in self.admitted:
                continue
            if len(self.admitted) >= self.scan["max_urls"]:
                self.summary["limit_reached"] = True
                continue
            self.admitted.add(url)
            if not self.client.allowed(url):
                page = failed_page(url, "Blocked by robots.txt; not fetched")
                page["render_mode"] = "blocked-robots"
                self.summary["skipped_robots"] += 1
                self.persist(page)
            else:
                accepted.append(url)
        return accepted

    async def sitemaps(self, text):
        sitemap_urls = [line.split(":", 1)[1].strip() for line in text.splitlines() if line.lower().startswith("sitemap:")]
        if not sitemap_urls:
            sitemap_urls = [origin(self.website["base_url"]) + "/sitemap.xml"]
        seen, pages = set(), set()
        while sitemap_urls and len(seen) < 5 and not self.client.halted:
            value = sitemap_urls.pop(0)
            try:
                url = normalize_url(value)
                if url in seen or origin(url) != origin(self.website["base_url"]):
                    continue
                seen.add(url)
                response, _ = await self.client.fetch(url)
                self.summary["sitemap_urls"].append({"url": url, "status": response.status_code})
                if response.status_code != 200:
                    self.summary["warnings"].append(f"Sitemap {url}: HTTP {response.status_code}")
                    continue
                tree = ElementTree.fromstring(response.content)
                locations = [n.text.strip() for n in tree.iter() if n.tag.split("}")[-1] == "loc" and n.text]
                if tree.tag.split("}")[-1] == "sitemapindex":
                    sitemap_urls.extend(locations)
                elif tree.tag.split("}")[-1] == "urlset":
                    for location in locations:
                        if u := internal_url(location, url, self.website["base_url"]):
                            pages.add(u)
                            if len(self.summary["sitemap_edges"]) < 5000:
                                self.summary["sitemap_edges"].append({"source_url": url, "target_url": u})
                            elif "Sitemap relation budget reached; discovery provenance is partial." not in self.summary["warnings"]:
                                self.summary["warnings"].append("Sitemap relation budget reached; discovery provenance is partial.")
                else:
                    self.summary["warnings"].append(f"Unrecognized sitemap document: {url}")
            except Exception as exc:
                self.summary["warnings"].append(f"Sitemap not read: {value}: {str(exc)[:200]}")
        if sitemap_urls:
            self.summary["warnings"].append("Sitemap-document limit (5) reached; discovery may be incomplete.")
        self.summary["sitemap_discovered"] = len(pages)
        return sorted(pages)

    async def render(self, url):
        from playwright.async_api import async_playwright
        async with self.browser_lock:
            if not self.browser:
                self.pw = await async_playwright().start()
                self.browser = await self.pw.chromium.launch(headless=True)
        context = await self.browser.new_context(user_agent="RockBaseSEO/0.1", service_workers="block")
        page = await context.new_page()
        async def route_handler(route):
            request = route.request
            try:
                if request.method != "GET" or origin(request.url) != origin(self.website["base_url"]):
                    return await route.abort()
                if request.resource_type not in {"document", "script", "xhr", "fetch"}:
                    return await route.abort()
                if self.client.halted or not self.client.allowed(request.url):
                    return await route.abort()
                # All browser network reads use the same DNS-pinned, robots-aware transport.
                response, chain = await self.client.fetch(request.url)
                if chain:
                    return await route.abort()
                await route.fulfill(status=response.status_code, headers=dict(response.headers), body=response.content)
            except Exception:
                await route.abort()
        await context.route("**/*", route_handler)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            # Bounded settle for client-rendered DOM, no network-idle wait loops.
            await page.wait_for_timeout(1200)
            return await page.content()
        finally:
            await context.close()

    async def run(self):
        self.repo.update_scan(self.scan["id"], status="running", summary=self.summary)
        try:
            robots, self.summary["robots_status"] = await self.client.load_robots()
            seeds = [self.website["base_url"], *(await self.sitemaps(robots))]
            storage = MemoryStorageClient()
            # Never reuse Crawlee's cached default queue across independent scans/tests.
            queue = await RequestQueue.open(name=f'seo-{uuid4().hex}', storage_client=storage)
            crawler = BasicCrawler(storage_client=storage, request_manager=queue, use_session_pool=False, retry_on_blocked=False,
                                   max_request_retries=0, max_requests_per_crawl=self.scan["max_urls"],
                                   concurrency_settings=ConcurrencySettings(min_concurrency=1, max_concurrency=2, desired_concurrency=2),
                                   request_handler_timeout=timedelta(minutes=4), configure_logging=False)
            @crawler.router.default_handler
            async def handler(context):
                url = context.request.url
                started = time.monotonic()
                try:
                    response, chain = await self.client.fetch(url)
                    p = extract_page(url, response, chain, self.website["base_url"])
                    if 200 <= response.status_code < 300 and "html" in p["content_type"] and self.scan["mode"] != "http":
                        soup = BeautifulSoup(response.text, "html.parser")
                        body = soup.body
                        has_scripts = bool(soup.find('script'))
                        if body:
                            for node in body.find_all(["script", "style", "noscript"]):
                                node.decompose()
                        shell = has_scripts and len(body.get_text(" ", strip=True) if body else "") < 120
                        if self.scan["mode"] == "browser" or shell:
                            try:
                                html = await self.render(p["final_url"])
                                p = extract_page(url, response, chain, self.website["base_url"], html=html, render_mode="browser")
                            except Exception as exc:
                                p["render_mode"] = "http-fallback-failed"
                                self.summary["warnings"].append(f"Browser rendering unavailable for {url}: {str(exc)[:200]}; HTTP snapshot retained")
                    p["elapsed_ms"] = round((time.monotonic()-started)*1000)
                    self.persist(p)
                    if self.client.halted:
                        crawler.stop("HTTP 429; no bypass or retries")
                    else:
                        # Canonical targets share the existing origin/robots/URL admission budget;
                        # discovering them never bypasses safety or invents target status.
                        candidates = [*p["internal_links"], *[e["target_url"] for e in p.get("link_edges", []) if e["kind"] == "canonical"]]
                        more = await self.admit(candidates)
                        if more:
                            await context.add_requests(more)
                except Exception as exc:
                    self.persist(failed_page(url, exc))
            initial = await self.admit(seeds)
            if initial:
                await crawler.run(initial)
            graph = build_graph(self.pages, self.website["base_url"], sitemap_edges=self.summary["sitemap_edges"],
                                limited=self.summary["limit_reached"] or self.summary["skipped_robots"] or self.client.halted)
            self.repo.save_graph(self.scan["id"], graph)
            self.summary["graph_version"] = graph["version"]
            self.summary["graph_coverage"] = graph["coverage"]
            self.summary["depth_histogram"] = graph["histogram"]
            issues = [enrich_issue(issue) for issue in audit_pages(self.pages)]
            self.repo.save_issues(self.scan["id"], issues)
            self.summary["priority_counts"] = dict(Counter(i["priority"] for i in issues))
            self.summary["discovered_count"] = len(self.discovered)
            fetched = [p for p in self.pages if p["status_code"] is not None]
            if self.client.halted:
                self.summary["warnings"].append("HTTP 429 encountered; scan stopped early. Coverage incomplete.")
            self.summary["warnings"].append("Bounded same-origin crawl; unvisited destinations, third-party URLs and Google indexing are not verified.")
            self.repo.update_scan(self.scan["id"], status="completed" if fetched else "failed", summary=self.summary,
                                  error="" if fetched else "No URL could be fetched; review robots, policy or network errors.")
        except Exception as exc:
            if self.summary['robots_status'] is None and getattr(exc, 'status_code', None):
                self.summary['robots_status'] = exc.status_code
                self.summary['warnings'].append('Crawl permission could not be established; no page metadata was audited and no protection was bypassed.')
                self.repo.save_issues(self.scan['id'], [{
                    'url': self.summary['robots_url'], 'code': 'crawl_blocked', 'priority': 'high',
                    'title': 'Crawl blocked: robots.txt unavailable',
                    'recommendation': 'Confirm the owner allows technical crawling and resolve the robots.txt HTTP error. Rerun only when access is permitted; do not bypass the protection.',
                    'details': {'status_code': exc.status_code, 'metadata_audited': False},
                }])
                self.summary['priority_counts'] = {'high': 1}
            self.repo.update_scan(self.scan["id"], status="failed", summary=self.summary, error=str(exc)[:1000])
        finally:
            if self.browser:
                await self.browser.close()
            if self.pw:
                await self.pw.stop()
            await self.client.close()
