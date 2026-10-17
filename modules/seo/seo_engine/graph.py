"""Observed scan graph: occurrence counts and followed-link shortest paths, not a whole-site map."""
import heapq
from collections import Counter, defaultdict

from .policy import normalize_url, origin

GRAPH_VERSION = 1
MAX_SCAN_EDGES = 50_000


def build_graph(pages, start_url, *, sitemap_edges=(), limited=False, max_edges=MAX_SCAN_EDGES):
    start_url = normalize_url(start_url)
    nodes, edges, warnings = {}, [], []
    legacy = any("link_edges" not in page for page in pages)
    available = bool(pages) and any("link_edges" in page for page in pages)
    truncated = any(page.get("link_edges_truncated", False) for page in pages)

    def safe(value):
        try:
            return normalize_url(value)
        except (ValueError, UnicodeError, TypeError):
            return None

    def node(url):
        if url not in nodes:
            nodes[url] = {"url": url, "observed": False, "status_code": None, "indexable": None,
                          "depth": None, "redirect_hops": None, "path": [], "inlinks": 0,
                          "unique_inlinks": 0, "followed_inlinks": 0, "unique_followed_inlinks": 0,
                          "outlinks": 0, "unique_outlinks": 0, "discovery_sources": []}
        return nodes[url]

    def discover(url, source):
        entry = node(url)
        if source not in entry["discovery_sources"]:
            entry["discovery_sources"].append(source)

    def append(raw):
        nonlocal truncated
        source, target = safe(raw.get("source_url")), safe(raw.get("target_url"))
        kind = raw.get("kind")
        if not source or not target or kind not in {"hyperlink", "canonical", "redirect", "sitemap"}:
            return
        # New analysis cannot expand crawl scope, even if fed externally assembled records.
        if kind == "hyperlink" and (origin(source) != origin(start_url) or origin(target) != origin(start_url)):
            return
        if len(edges) >= max_edges:
            truncated = True
            return
        edges.append({"source_url": source, "target_url": target, "kind": kind,
                      "anchor": str(raw.get("anchor", ""))[:2000], "rel": raw.get("rel", []),
                      "follow": bool(raw.get("follow", False)), "occurrence": raw.get("occurrence", 0),
                      **({"status_code": raw["status_code"]} if "status_code" in raw else {})})
        node(source)
        discover(target, kind)

    discover(start_url, "start")
    documents = {}
    for page in sorted(pages, key=lambda p: (bool(p.get("redirect_chain")), p["url"])):
        requested, final = safe(page["url"]), safe(page.get("final_url") or page["url"])
        if not requested or not final:
            continue
        first_status = page.get("first_status_code")
        if first_status is None:
            first_status = page.get("redirect_chain", [{}])[0].get("status") if page.get("redirect_chain") else page.get("status_code")
        entry = node(requested)
        entry.update(observed=first_status is not None, status_code=first_status,
                     indexable=page.get("indexable") if not page.get("redirect_chain") else False)
        for hop in page.get("redirect_chain", []):
            source, target = safe(hop.get("url")), safe(hop.get("location"))
            if source and target:
                node(source).update(observed=True, status_code=hop.get("status"), indexable=False)
                append({"source_url": source, "target_url": target, "kind": "redirect", "follow": True,
                        "status_code": hop.get("status"), "occurrence": 0})
        if page.get("status_code") is not None:
            node(final).update(observed=True, status_code=page["status_code"], indexable=page.get("indexable"))
        if "link_edges" in page and final not in documents:
            documents[final] = page
    # A followed redirect fetched the same body as a direct request: count the document only once.
    for final, page in documents.items():
        for raw in page.get("link_edges", []):
            append({**raw, "source_url": final})
    for raw in sitemap_edges:
        append({**raw, "kind": "sitemap", "follow": False})
    # Identical redirect hops may be observed via several requested aliases. Keep one typed relation.
    seen_redirects, distinct = set(), []
    for edge in edges:
        if edge["kind"] == "redirect":
            key = (edge["source_url"], edge["target_url"], edge.get("status_code"))
            if key in seen_redirects:
                continue
            seen_redirects.add(key)
        distinct.append(edge)
    edges = distinct

    inbound, followed, outbound, adjacency = defaultdict(set), defaultdict(set), defaultdict(set), defaultdict(list)
    for edge in edges:
        source, target = edge["source_url"], edge["target_url"]
        if edge["kind"] == "hyperlink":
            node(source)["outlinks"] += 1
            node(target)["inlinks"] += 1
            inbound[target].add(source)
            outbound[source].add(target)
            if edge["follow"]:
                node(target)["followed_inlinks"] += 1
                followed[target].add(source)
                adjacency[source].append((target, 1, 0))
        elif edge["kind"] == "redirect" and origin(target) == origin(start_url):
            adjacency[source].append((target, 0, 1))
    for url, entry in nodes.items():
        entry.update(unique_inlinks=len(inbound[url]), unique_followed_inlinks=len(followed[url]),
                     unique_outlinks=len(outbound[url]), discovery_sources=sorted(entry["discovery_sources"]))
    # Dijkstra on (HTML click count, redirect hops) gives a stable shortest path even when
    # sitemap/crawl scheduling visited a deep document first. Redirects are not HTML clicks.
    best = {start_url: (0, 0)}
    queue = [(0, 0, start_url, [start_url])]
    while queue:
        depth, hops, url, path = heapq.heappop(queue)
        if best[url] != (depth, hops):
            continue
        node(url).update(depth=depth, redirect_hops=hops, path=path)
        for target, clicks, redirects in sorted(adjacency[url]):
            candidate = (depth + clicks, hops + redirects)
            if candidate < best.get(target, (float("inf"), float("inf"))):
                best[target] = candidate
                heapq.heappush(queue, (*candidate, target, [*path, target]))
    if not available:
        warnings.append("This scan predates occurrence capture (or has no pages). Run a new scan for link counts and depth.")
    elif legacy:
        warnings.append("Some pages have no occurrence data; graph metrics cover only captured edges.")
    if truncated:
        warnings.append("Link occurrence budget reached; counts and paths may be incomplete.")
    if limited:
        warnings.append("URL or crawl-access limit reached; unvisited URLs have unknown status.")
    warnings.append("Observed scan only, not a whole-site orphan audit. Null depth means no followed HTML path was observed; sitemap/canonical relations do not establish depth.")
    histogram = Counter(n["depth"] for n in nodes.values() if n["depth"] is not None)
    redirect_targets = {edge["source_url"]: edge["target_url"] for edge in edges if edge["kind"] == "redirect"}
    for edge in edges:
        target, visited = edge["target_url"], set()
        while target in redirect_targets and target not in visited:
            visited.add(target)
            target = redirect_targets[target]
        edge["source_status_code"] = nodes[edge["source_url"]]["status_code"]
        edge["target_status_code"] = nodes[edge["target_url"]]["status_code"]
        edge["target_final_status_code"] = nodes[target]["status_code"] if target not in visited else None
    return {"available": available, "version": GRAPH_VERSION, "start_url": start_url,
            "nodes": [nodes[url] for url in sorted(nodes)], "edges": edges,
            "histogram": [{"depth": depth, "count": count} for depth, count in sorted(histogram.items())],
            "coverage": {"scope": "observed_scan", "complete": False, "truncated": truncated,
                         "legacy": legacy, "limited": bool(limited), "edge_count": len(edges)}, "warnings": warnings}
