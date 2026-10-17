"""Deterministic V1 extraction and evidence-based issue rules."""
from collections import defaultdict
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from .policy import internal_url, normalize_url

MAX_LINK_EDGES = 5000


def robots_tokens(*values):
    return set(re.findall(r"[a-z]+", ",".join(values).lower()))


def _safe_canonical(value, base):
    if not value:
        return "", False
    try:
        return normalize_url(value, base), False
    except (ValueError, UnicodeError):
        return "", True


def extract_page(url, response, chain, site, *, html=None, render_mode="http", elapsed_ms=0):
    final_url = normalize_url(str(response.url))
    content_type = response.headers.get("content-type", "").lower()
    html_page = "html" in content_type
    soup = BeautifulSoup(html if html is not None else response.text if html_page else "", "html.parser")
    base_tag = soup.find("base", href=True)
    base = urljoin(final_url, base_tag["href"]) if base_tag else final_url
    def meta(name):
        return ", ".join(str(tag.get("content", "")) for tag in soup.find_all("meta", attrs={"name": lambda v: v and v.lower() == name})).strip()
    canonical_tags = soup.find_all("link", rel=lambda v: v and "canonical" in ([x.lower() for x in v] if isinstance(v, list) else str(v).lower().split()))
    canonical_values, canonical_invalid = [], False
    for tag in canonical_tags:
        target, invalid = _safe_canonical(str(tag.get("href", "")), base)
        canonical_invalid |= invalid
        if target:
            canonical_values.append(target)
    canonical = canonical_values[0] if canonical_values else ""
    robots = ", ".join(filter(None, [meta("robots"), meta("googlebot")]))
    x_robots = response.headers.get("x-robots-tag", "")
    directive_tokens = robots_tokens(robots, x_robots)
    page_nofollow = bool(directive_tokens & {"nofollow", "none"})
    links = sorted({u for a in soup.find_all("a", href=True) if (u := internal_url(str(a["href"]), base, site))})
    edges, occurrences = [], defaultdict(int)
    edge_limit = MAX_LINK_EDGES - min(len(canonical_values), MAX_LINK_EDGES)
    hyperlink_count = 0
    truncated = False
    for anchor in soup.find_all("a", href=True):
        target = internal_url(str(anchor["href"]), base, site)
        if not target:
            continue
        if hyperlink_count >= edge_limit:
            truncated = True
            occurrences[("hyperlink", target)] += 1
            continue
        hyperlink_count += 1
        rel_value = anchor.get("rel", [])
        rel = sorted({str(x).lower() for x in (rel_value if isinstance(rel_value, list) else str(rel_value).split())})
        key = ("hyperlink", target)
        occurrence = occurrences[key]
        occurrences[key] += 1
        if len(edges) < MAX_LINK_EDGES:
            edges.append({"source_url": final_url, "target_url": target, "kind": "hyperlink",
                          "anchor": anchor.get_text(" ", strip=True)[:2000], "rel": rel,
                          "follow": "nofollow" not in rel and not page_nofollow, "occurrence": occurrence})
    for target in canonical_values[:MAX_LINK_EDGES]:
        occurrence = occurrences[("canonical", target)]
        occurrences[("canonical", target)] += 1
        edges.append({"source_url": final_url, "target_url": target, "kind": "canonical", "anchor": "",
                      "rel": ["canonical"], "follow": True, "occurrence": occurrence})
    truncated |= len(canonical_values) > MAX_LINK_EDGES
    self_canonical = not canonical or canonical == final_url
    indexable = 200 <= response.status_code < 300 and html_page and not directive_tokens & {"noindex", "none"} and self_canonical
    first_status = chain[0].get("status") if chain else response.status_code
    return {"url": url, "final_url": final_url, "status_code": response.status_code,
            "first_status_code": first_status, "final_status_code": response.status_code,
            "title": soup.title.get_text(" ", strip=True) if soup.title else "", "description": meta("description"),
            "h1": [x.get_text(" ", strip=True) for x in soup.find_all("h1")], "canonical": canonical,
            "canonical_invalid": canonical_invalid, "canonical_targets": list(dict.fromkeys(canonical_values[:MAX_LINK_EDGES])),
            "meta_robots": robots, "x_robots_tag": x_robots, "indexable": indexable,
            "content_type": content_type, "redirect_chain": chain, "internal_links": links,
            "link_edges": edges, "link_edges_truncated": truncated,
            "render_mode": render_mode, "error": "", "elapsed_ms": elapsed_ms}


def failed_page(url, error):
    response = getattr(error, "response", None)
    chain = getattr(error, "redirect_chain", [])
    final_url = normalize_url(str(response.url)) if response is not None and getattr(response, "url", None) else url
    final_status = response.status_code if response is not None else None
    first_status = chain[0].get("status") if chain else final_status
    return {"url": url, "final_url": final_url, "status_code": final_status,
            "first_status_code": first_status, "final_status_code": final_status,
            "title": "", "description": "", "h1": [], "canonical": "", "canonical_invalid": False,
            "meta_robots": "", "x_robots_tag": "", "indexable": False, "content_type": "",
            "redirect_chain": chain, "internal_links": [], "link_edges": [], "link_edges_truncated": False,
            "render_mode": "not-fetched", "error": str(error), "elapsed_ms": 0}


def audit_pages(pages):
    issues, titles, descriptions = [], defaultdict(list), defaultdict(list)
    by_url = {}
    ordered = sorted(pages, key=lambda p: (bool(p.get("redirect_chain")), p["url"]))
    for page in ordered:
        by_url[normalize_url(page["url"])] = page
    for page in ordered:
        final = normalize_url(page.get("final_url") or page["url"])
        # Final-body observations are not redirects merely because the requesting URL was an alias.
        by_url.setdefault(final, {**page, "url": final, "redirect_chain": [],
                                  "first_status_code": page.get("final_status_code", page.get("status_code"))})

    def add(page, code, priority, title, recommendation, **details):
        issues.append({"url": page["url"], "code": code, "priority": priority, "title": title,
                       "recommendation": recommendation, "details": details})

    canonical_map = defaultdict(set)
    for p in pages:
        targets = p.get("canonical_targets") or ([p["canonical"]] if p.get("canonical") else [])
        for target in targets:
            try:
                canonical_map[normalize_url(p.get("final_url", p["url"]))].add(normalize_url(target))
            except (ValueError, UnicodeError):
                pass

    reported_redirects, audited_documents = set(), set()
    for p in ordered:
        code = p.get("final_status_code", p.get("status_code"))
        first_status = p.get("first_status_code", code)
        chain = p.get("redirect_chain") or []
        if p.get("error"):
            blocked = p.get("render_mode") == "blocked-robots" or "robots.txt" in p["error"].lower()
            add(p, "robots_blocked" if blocked else "fetch_error", "low" if blocked else "high",
                "URL excluded by robots.txt" if blocked else "URL could not be fetched",
                "Confirm this exclusion is intentional; the page was not audited." if blocked else "Check server, TLS, DNS or crawl policy. Rerun after resolving the error.", error=p["error"])
        if chain:
            sources = [hop.get("url") for hop in chain if hop.get("url")]
            destinations = [hop.get("location") for hop in chain if hop.get("location")]
            loop = len(sources) != len(set(sources)) or bool(destinations and destinations[-1] in set(sources))
            if loop:
                add(p, "redirect_loop", "high", "Redirect loop detected", "Remove the cycle and point redirects directly to a valid final URL.", chain=chain)
            if code is not None and code >= 400:
                add(p, "redirect_broken", "high", "Redirect chain ends in an HTTP error", "Repair the redirect destination or restore the target; do not bypass access controls.", chain=chain, final_status_code=code)
            signature = tuple((hop.get("url"), hop.get("status"), hop.get("location")) for hop in chain)
            if signature not in reported_redirects:
                multi = len(chain) > 1
                add(p, "redirect_chain" if multi else "redirect", "medium" if multi else "low",
                    "Multiple redirect hops" if multi else "Internal URL redirects",
                    "Update internal links and sitemap to the final URL after confirming the destination is intended.",
                    chain=chain, first_status_code=first_status, final_status_code=code)
                reported_redirects.add(signature)
        if code is not None and code >= 400:
            add(p, "http_error", "high", f"HTTP {code} response", "Fix or remove broken URLs. Do not bypass authentication or bot protection.", status_code=code)
        if p.get("error") or not code or not 200 <= code < 300 or "html" not in p.get("content_type", ""):
            continue
        document = normalize_url(p.get("final_url") or p["url"])
        if document in audited_documents:
            continue
        audited_documents.add(document)
        for key, label, priority in [("title", "title", "high"), ("description", "meta description", "medium"), ("h1", "H1", "medium"), ("canonical", "canonical", "low")]:
            if not p.get(key) or (key == "h1" and not any(p[key])):
                add(p, f"missing_{key}", priority, f"Missing {label}", f"Add a descriptive, page-specific {label}." if key != "canonical" else "Declare the preferred absolute canonical URL; absence alone does not prove an indexing problem.")
        if len(p.get("h1", [])) > 1:
            add(p, "multiple_h1", "low", "Multiple H1 headings", "Review heading hierarchy; keep one clear primary heading when appropriate.", headings=p["h1"])
        tokens = robots_tokens(p.get("meta_robots", ""), p.get("x_robots_tag", ""))
        if "noindex" in tokens or "none" in tokens:
            add(p, "noindex", "high", "Potentially non-indexable: noindex", "Check intent before removing noindex from meta robots or X-Robots-Tag.", meta_robots=p.get("meta_robots", ""), x_robots_tag=p.get("x_robots_tag", ""))
        if p.get("canonical_invalid"):
            add(p, "canonical_invalid", "medium", "Canonical URL is invalid or unsafe", "Correct the canonical to a safe absolute HTTP(S) URL without credentials.")
        canonical = p.get("canonical", "")
        if canonical:
            final = normalize_url(p.get("final_url", p["url"]))
            target_url = normalize_url(canonical)
            if target_url != final:
                add(p, "canonical_other", "medium", "Canonical points to another URL", "Confirm consolidation is intentional; a canonical to another valid URL is a review finding, not proof of an indexing failure.", canonical=canonical)
                target = by_url.get(target_url)
                if target is None:
                    add(p, "canonical_target_unknown", "low", "Canonical target was not observed", "Verify the target separately; no extra request was made and its status is unknown.", target_url=target_url)
                else:
                    target_status = target.get("final_status_code", target.get("status_code"))
                    if target.get("error"):
                        blocked = target.get("render_mode") == "blocked-robots" or "robots.txt" in target["error"].lower()
                        add(p, "canonical_target_blocked" if blocked else "canonical_target_unknown", "medium", "Canonical target could not be verified", "Confirm robots access and target availability; do not bypass crawl restrictions.", target_url=target_url)
                    elif target_status is not None and target_status >= 400:
                        add(p, "canonical_target_error", "high", "Canonical target returns an HTTP error", "Point the canonical to a valid page or restore the intended target.", target_url=target_url, target_status=target_status)
                    elif target.get("redirect_chain"):
                        add(p, "canonical_target_redirect", "medium", "Canonical target redirects", "Point to the final URL only after confirming consolidation intent.", target_url=target_url, final_url=target.get("final_url"))
                    if not target.get("error") and 200 <= (target_status or 0) < 300 and robots_tokens(target.get("meta_robots", ""), target.get("x_robots_tag", "")) & {"noindex", "none"}:
                        add(p, "canonical_target_noindex", "medium", "Canonical target is noindex", "Review whether the noindex is intentional before changing either signal.", target_url=target_url)
        if p.get("title", "").strip():
            titles[" ".join(p["title"].split()).casefold()].append(p)
        if p.get("description", "").strip():
            descriptions[" ".join(p["description"].split()).casefold()].append(p)

    def duplicate_groups(groups, code, label, value_key, recommendation):
        for group in groups.values():
            documents = defaultdict(list)
            for p in group:
                documents[normalize_url(p.get("final_url", p["url"]))].append(p)
            if len(documents) > 1:
                urls = sorted(p["url"] for aliases in documents.values() for p in aliases)
                for aliases in documents.values():
                    page = aliases[0]
                    add(page, code, "medium", f"Duplicate {label}", recommendation,
                        **{value_key: page.get("description" if code == "duplicate_description" else "title", "")}, related_urls=urls)
    duplicate_groups(titles, "duplicate_title", "page title", "duplicate_title", "Write distinct titles reflecting each page's content and search intent.")
    duplicate_groups(descriptions, "duplicate_description", "meta description", "duplicate_description", "Write a distinct, accurate description for each different page; redirect aliases are one document.")

    for canonical_url, targets in canonical_map.items():
        if len(targets) > 1:
            page = by_url.get(canonical_url)
            if page:
                add(page, "canonical_conflict", "medium", "Conflicting canonicals for one final document", "Resolve canonical declarations across aliases so the final document has one consistent preferred URL.", canonical_targets=sorted(targets))
    for start in canonical_map:
        path, current = [], start
        while current in canonical_map and canonical_map[current]:
            target = sorted(canonical_map[current])[0]
            if target == current:
                break  # A self-canonical is a normal terminal declaration, never a cycle.
            if target in path or target == start:
                page = by_url.get(start)
                if page:
                    add(page, "canonical_loop", "high", "Canonical loop detected", "Break the canonical cycle and choose one valid preferred URL.", canonical_chain=path + [target])
                break
            path.append(current)
            current = target

    for p in pages:
        for target in p.get("internal_links", []):
            try:
                observed = by_url.get(normalize_url(target))
            except (ValueError, UnicodeError):
                observed = None
            target_status = observed.get("final_status_code", observed.get("status_code")) if observed else None
            if observed and target_status and target_status >= 400:
                add(p, "broken_internal_link", "high", "Broken internal link", "Replace or remove the link, or restore the destination. Only verified HTTP errors are flagged.", target_url=target, target_status=target_status)
    return issues
