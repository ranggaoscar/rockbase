"""Deterministic V1 extraction and evidence-based issue rules."""
from collections import defaultdict
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from .policy import internal_url, normalize_url


def extract_page(url, response, chain, site, *, html=None, render_mode="http", elapsed_ms=0):
    final_url = str(response.url)
    content_type = response.headers.get("content-type", "").lower()
    html_page = "html" in content_type
    soup = BeautifulSoup(html if html is not None else response.text if html_page else "", "html.parser")
    base_tag = soup.find("base", href=True)
    base = urljoin(final_url, base_tag["href"]) if base_tag else final_url
    def meta(name):
        return ", ".join(str(tag.get("content", "")) for tag in soup.find_all("meta", attrs={"name": lambda v: v and v.lower() == name})).strip()
    canonical_tag = soup.find("link", rel=lambda v: v and "canonical" in v)
    canonical = urljoin(base, str(canonical_tag.get("href", ""))) if canonical_tag and canonical_tag.get("href") else ""
    links = sorted({u for a in soup.find_all("a", href=True) if (u := internal_url(str(a["href"]), base, site))})
    robots = ", ".join(filter(None, [meta("robots"), meta("googlebot")]))
    x_robots = response.headers.get("x-robots-tag", "")
    directives = (robots + "," + x_robots).lower().replace("none", "noindex,nofollow")
    self_canonical = not canonical or canonical.rstrip("/") == final_url.rstrip("/")
    indexable = 200 <= response.status_code < 300 and html_page and "noindex" not in directives and self_canonical
    return {"url": url, "final_url": final_url, "status_code": response.status_code,
            "title": soup.title.get_text(" ", strip=True) if soup.title else "", "description": meta("description"),
            "h1": [x.get_text(" ", strip=True) for x in soup.find_all("h1")], "canonical": canonical,
            "meta_robots": robots, "x_robots_tag": x_robots, "indexable": indexable,
            "content_type": content_type, "redirect_chain": chain, "internal_links": links,
            "render_mode": render_mode, "error": "", "elapsed_ms": elapsed_ms}


def failed_page(url, error):
    return {"url": url, "final_url": url, "status_code": None, "title": "", "description": "", "h1": [],
            "canonical": "", "meta_robots": "", "x_robots_tag": "", "indexable": False, "content_type": "",
            "redirect_chain": [], "internal_links": [], "render_mode": "not-fetched", "error": str(error), "elapsed_ms": 0}


def audit_pages(pages):
    issues, titles = [], defaultdict(list)
    by_url = {p["url"]: p for p in pages}
    def add(page, code, priority, title, recommendation, **details):
        issues.append({"url": page["url"], "code": code, "priority": priority, "title": title,
                       "recommendation": recommendation, "details": details})
    for p in pages:
        code = p["status_code"]
        if p["error"]:
            blocked = p["render_mode"] == "blocked-robots"
            add(p, "robots_blocked" if blocked else "fetch_error", "low" if blocked else "high",
                "URL excluded by robots.txt" if blocked else "URL could not be fetched",
                "Confirm this exclusion is intentional; the page was not audited." if blocked else "Check server, TLS, DNS or crawl policy. Rerun after resolving the error.", error=p["error"])
            continue
        if p["redirect_chain"]:
            add(p, "redirect", "low", "Internal URL redirects", "Update internal links and sitemap to the final canonical URL.", chain=p["redirect_chain"])
        if code is not None and code >= 400:
            add(p, "http_error", "high", f"HTTP {code} response", "Fix or remove broken URLs. Do not bypass authentication or bot protection.", status_code=code)
        if not code or not 200 <= code < 300 or "html" not in p["content_type"]:
            continue
        for key, label, priority in [("title", "title", "high"), ("description", "meta description", "medium"), ("h1", "H1", "medium"), ("canonical", "canonical", "low")]:
            if not p[key] or (key == "h1" and not any(p[key])):
                add(p, f"missing_{key}", priority, f"Missing {label}", f"Add a descriptive, page-specific {label}." if key != "canonical" else "Declare the preferred absolute canonical URL; absence alone does not prove an indexing problem.")
        if len(p["h1"]) > 1:
            add(p, "multiple_h1", "low", "Multiple H1 headings", "Review heading hierarchy; keep one clear primary heading when appropriate.", headings=p["h1"])
        directives = (p["meta_robots"] + "," + p["x_robots_tag"]).lower()
        if "noindex" in directives or "none" in directives:
            add(p, "noindex", "high", "Potentially non-indexable: noindex", "Check intent before removing noindex from meta robots or X-Robots-Tag.", meta_robots=p["meta_robots"], x_robots_tag=p["x_robots_tag"])
        if p["canonical"]:
            try:
                nonself = normalize_url(p["canonical"]).rstrip("/") != normalize_url(p["final_url"]).rstrip("/")
            except ValueError:
                nonself = True
            if nonself:
                add(p, "canonical_other", "medium", "Canonical points to another URL", "Confirm consolidation is intentional; use a self-canonical if this page should index separately.", canonical=p["canonical"])
        if p["title"]:
            titles[p["title"].casefold()].append(p)
    for group in titles.values():
        # Redirect aliases of the same fetched destination are not duplicate content pages.
        destinations = {p["final_url"] for p in group}
        if len(destinations) > 1:
            for p in group:
                add(p, "duplicate_title", "medium", "Duplicate page title", "Write distinct titles reflecting each page's content and search intent.", duplicate_title=p["title"], related_urls=sorted(destinations))
    for p in pages:
        for target in p["internal_links"]:
            observed = by_url.get(target)
            if observed and observed["status_code"] and observed["status_code"] >= 400:
                add(p, "broken_internal_link", "high", "Broken internal link", "Replace or remove the link, or restore the destination. Only verified HTTP errors are flagged.", target_url=target, target_status=observed["status_code"])
    return issues
