"""Conservative, deterministic comparison of public competitor snapshots."""
import hashlib
import re
from datetime import datetime, timezone

FIELDS = ("title", "description", "h1", "headings", "canonical", "indexable", "meta_robots", "x_robots_tag", "internal_links")

def fresh(at):
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds()
        return -300 <= age <= 30 * 86400
    except (TypeError, ValueError, AttributeError):
        return False

def add_coverage_gaps(repo, competitor, scan, pages, findings, coverage):
    owned = []
    for site in repo.websites(competitor["workspace_id"]):
        if site["brand_key"] != competitor["brand_key"]:
            continue
        baseline = next((s for s in repo.scans(site["id"], competitor["workspace_id"]) if s["status"] == "completed"), None)
        if baseline and fresh(baseline.get("finished_at")):
            owned.extend((p, baseline) for p in repo.rows("pages", baseline["id"], analysis=False) if _valid(p))
    coverage["owned_baseline_pages"] = len(owned)
    at = scan.get("finished_at") or scan.get("started_at")
    if not owned or not fresh(at) or scan["status"] != "completed":
        return
    stop = set("the and for with from this that your our their guide page home about content stone products services is a an of to in on by at".split())
    def tokens(page):
        h1 = page.get("h1") or []
        text = " ".join(h1) if isinstance(h1, list) else str(h1)
        return set(re.findall(r"[^\W\d_]{4,}", text.casefold())) - stop
    observed = set().union(*(tokens(p) for p, _ in owned))
    for page in sorted((p for p in pages if _valid(p)), key=lambda p: p["url"]):
        missing = sorted(tokens(page) - observed)
        if len(missing) < 2:
            continue
        owned_ids = sorted({s["id"] for _, s in owned})
        fid = hashlib.sha256(f"gap|{competitor['id']}|{competitor['brand_key']}|{scan['id']}|{page['url']}|{owned_ids}".encode()).hexdigest()[:20]
        findings.append({"id": fid, "category": "coverage_gap", "title": "Review a possible heading-topic coverage gap", "reason": f"{len(missing)} heading terms were not observed in {len(owned)} successfully fetched pages from fresh owned-site snapshots. Lexical coverage only; not proven demand or absence across your whole site.", "next_action": "Review the source and your own page inventory, validate relevance, then write original expertise. Do not copy competitor wording.", "source_urls": [page["url"], *sorted({p["url"] for p, _ in owned})[:3]], "observed_at": at, "previous_observed_at": None, "changes": {"heading_terms_not_observed": {"before": None, "after": missing}}, "confidence": "low", "scan_id": scan["id"], "previous_scan_id": None, "brand_key": competitor["brand_key"], "competitor_id": competitor["id"], "owned_scan_ids": sorted({s["id"] for _, s in owned}), "owned_observed_at": sorted({s["finished_at"] for _, s in owned})})

def _valid(page):
    status = page.get("final_status_code", page.get("status_code"))
    challenge = re.search(r"captcha|just a moment|access denied|verify you are human|checking your browser", str(page.get("title", "")), re.I)
    return isinstance(status, int) and 200 <= status < 300 and not page.get("error") and not challenge and "html" in str(page.get("content_type", "")).lower()

def compare_pages(old_pages, new_pages, *, current_scan_id, previous_scan_id, brand_key, competitor_id, observed_at=None, previous_observed_at=None):
    old = {p["url"]: p for p in old_pages if _valid(p)}
    new = {p["url"]: p for p in new_pages if _valid(p)}

    findings = []
    def add(category, url, title, reason, action, changes=None, before=None):
        stable = f"{competitor_id}|{brand_key}|{current_scan_id}|{previous_scan_id}|{category}|{url}|{','.join(sorted((changes or {}).keys()))}"
        findings.append({"id": hashlib.sha256(stable.encode()).hexdigest()[:20], "category": category,
            "title": title, "reason": reason, "next_action": action, "source_urls": [url] if url else [],
            "observed_at": observed_at, "previous_observed_at": previous_observed_at, "changes": changes or {},
            "confidence": "high" if category == "verified_change" else "low", "scan_id": current_scan_id,
            "previous_scan_id": previous_scan_id, "brand_key": brand_key, "competitor_id": competitor_id})
    for url in sorted(old.keys() & new.keys()):
        changes = {}
        for field in FIELDS:
            if field not in old[url] or field not in new[url]:
                continue
            a, b = old[url].get(field), new[url].get(field)
            if field == "internal_links":
                a, b = sorted(set(a or [])), sorted(set(b or []))
            if a != b:
                changes[field] = {"before": a, "after": b}
        if changes:
            add("verified_change", url, "Competitor page metadata changed", "Successfully fetched HTML snapshots differ in tracked fields.", "Review whether this changes your positioning or target-page coverage.", changes, old[url].get("observed_at"))
    for url in sorted(new.keys() - old.keys()) if previous_scan_id else []:
        add("newly_observed", url, "Newly observed competitor URL", "This URL was fetched in the latest scan but was not present in the previous successful HTML snapshot; it is not confirmed newly published.", "Review the observed page and its topic; do not infer a publication date.")
    failed = [p for p in new_pages if not _valid(p)]
    for p in failed:
        add("unavailable", p.get("url", ""), "Competitor URL unavailable", f"Latest observation was not successful HTML (status={p.get('status_code')!r}; error={p.get('error','')}).", "Retry in a later scan if permitted; do not infer removal.")
    unseen = sorted(old.keys() - new.keys())
    if unseen:
        add("unverified", "", "Prior URLs not observed", f"{len(unseen)} previously successful URLs were not observed; incomplete crawl coverage does not establish deletion or a content gap.", "Check scan coverage, robots rules, and sitemap discovery before drawing conclusions.", {"unobserved_urls": {"before": unseen, "after": None}})
    if not previous_scan_id:
        add("baseline", "", "Competitor baseline recorded", "No earlier completed competitor snapshot exists for comparison.", "Run another scan later to compare successfully fetched HTML pages.")
    coverage = {"previous_successful_html_pages": len(old), "current_successful_html_pages": len(new), "unobserved_prior_urls": unseen, "deleted_confirmed": 0, "failed_or_non_html_count": len(failed), "scope": "successfully fetched HTML pages only"}
    return findings, coverage

def analyze(repo, competitor, scan_id=None):
    scans = repo.scans(competitor["website_id"], competitor["workspace_id"])
    scan = next((s for s in scans if s["id"] == scan_id), None) if scan_id else scans[0] if scans else None
    if not scan:
        if scan_id:
            raise LookupError("Competitor scan not found")
        return {"competitor": competitor, "scan": None, "previous_scan": None, "findings": [], "coverage": {}, "limits": ["Registration did not crawl; no snapshot yet."]}
    if scan["status"] in {"queued", "running"}:
        return {"competitor": competitor, "scan": scan, "previous_scan": None, "findings": [], "coverage": {}, "limits": ["Scan pending; no change inferred."]}
    previous = next((s for s in scans if s["id"] < scan["id"] and s["status"] == "completed"), None)
    current_pages = repo.rows("pages", scan["id"], analysis=False)
    old_pages = repo.rows("pages", previous["id"], analysis=False) if previous else []
    at = scan.get("finished_at") or scan.get("started_at")
    prior_at = (previous.get("finished_at") or previous.get("started_at")) if previous else None
    findings, coverage = compare_pages(old_pages, current_pages, current_scan_id=scan["id"], previous_scan_id=previous["id"] if previous else None, brand_key=competitor["brand_key"], competitor_id=competitor["id"], observed_at=at, previous_observed_at=prior_at)
    if scan["status"] != "completed":
        findings = [f for f in findings if f["category"] in {"unavailable", "unverified"}]
        findings.append({"id": f"failure-{competitor['id']}-{scan['id']}", "category": "unavailable", "title": "Competitor scan did not complete", "reason": scan.get("error") or scan["status"], "next_action": "Inspect the failure; retry explicitly only if permitted. No deletion or growth claim.", "source_urls": [competitor["base_url"]], "observed_at": at, "previous_observed_at": prior_at, "changes": {}, "confidence": "low", "scan_id": scan["id"], "previous_scan_id": previous["id"] if previous else None, "brand_key": competitor["brand_key"], "competitor_id": competitor["id"]})
    coverage["evidence_fresh"] = fresh(at)
    add_coverage_gaps(repo, competitor, scan, current_pages, findings, coverage)
    return {"competitor": competitor, "scan": scan, "previous_scan": previous, "findings": findings, "coverage": coverage,
            "limits": ["HTTP-only public-page snapshots; no browser, login, or JavaScript rendering.", "Unobserved URLs are not confirmed deleted.", "No competitor body copy is included."]}
