"""Original deterministic issue classification; evidence does not imply Google ranking impact."""
from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    category: str
    issue_type: str
    confidence: str
    population: str
    reason: str
    steps: tuple[str, ...]
    priority: str | None = None


LINK_FIX = ("Open the source URL and locate the exact target in its links.",
            "Restore the intended destination or update/remove that link; preserve useful anchor text.",
            "Rerun the same scoped scan and confirm the destination responds successfully.")
CANONICAL_FIX = ("Confirm which document should be the preferred URL; cross-URL consolidation can be intentional.",
                 "Compare the declared target, observed status, robots directives and redirect hops.",
                 "If the intent is wrong, update the canonical and referring links, then rerun the scan.")
REDIRECT_FIX = ("Inspect each recorded hop and identify the intended final destination.",
                "Point internal links and sitemap entries directly at that destination where appropriate.",
                "Correct loops/broken destinations at the server and rerun; do not bypass access controls.")
META_FIX = ("Review the affected successful HTML documents and their search intent.",
            "Write page-specific metadata; share wording only when consolidation is intentional.",
            "Rerun and compare the same observed URLs; duplication is not proof of a ranking penalty.")
ACCESS_FIX = ("Check whether access restrictions are intentional with the site owner.",
              "Resolve permitted server/robots/network errors without bypassing authentication or bot protection.",
              "Rerun only when access is allowed; unfetched pages have unknown metadata and indexability.")

RULES = {
    "broken_internal_link": Rule("links", "issue", "observed", "linked_html", "The linked destination returned a verified HTTP error in this scan.", LINK_FIX),
    "http_error": Rule("access", "issue", "observed", "fetched", "The requested resource returned a verified HTTP error, not a predicted indexing outcome.", ACCESS_FIX),
    "fetch_error": Rule("access", "warning", "review", "all", "Transport/policy failure prevents an audit; it does not prove the public page is broken.", ACCESS_FIX),
    "robots_blocked": Rule("access", "insight", "review", "all", "The crawl respected robots.txt. Confirm intent instead of automatically removing restrictions.", ACCESS_FIX, "low"),
    "crawl_blocked": Rule("access", "warning", "observed", "all", "Crawl permissions could not be established; page metadata was not audited.", ACCESS_FIX),
    "noindex": Rule("indexability", "insight", "review", "html", "A noindex directive was observed, but removal depends on the owner's indexing intent.",
                    ("Confirm whether this document should appear in search.", "Remove noindex only if its exclusion is unintended; otherwise retain it.", "Verify directives in a new scan; Google indexing itself is not verified."), "low"),
    "canonical_other": Rule("indexability", "insight", "review", "canonical", "A cross-URL canonical may be correct consolidation; no failure is established by the declaration alone.", CANONICAL_FIX, "low"),
    "canonical_target_error": Rule("indexability", "issue", "observed", "canonical", "The declared preferred URL returned a verified HTTP error; resolve this before cosmetic metadata work.", CANONICAL_FIX, "high"),
    "canonical_target_noindex": Rule("indexability", "issue", "observed", "canonical", "The preferred target explicitly declares noindex, conflicting with selection as an indexable preferred document.", CANONICAL_FIX, "high"),
    "canonical_target_blocked": Rule("indexability", "warning", "review", "canonical", "Robots exclusion prevented target verification; this does not prove that Google has not indexed it.", CANONICAL_FIX, "low"),
    "canonical_target_redirect": Rule("indexability", "opportunity", "observed", "canonical", "The canonical target redirects. Prefer a direct target after confirming consolidation intent.", CANONICAL_FIX, "medium"),
    "canonical_target_unknown": Rule("indexability", "warning", "unknown", "canonical", "The canonical target was not verified within this bounded scan; do not assume it is broken.", CANONICAL_FIX, "low"),
    "canonical_loop": Rule("indexability", "issue", "observed", "canonical", "Observed canonical declarations form a cycle instead of agreeing on one preferred URL.", CANONICAL_FIX, "high"),
    "canonical_conflict": Rule("indexability", "warning", "observed", "html", "Multiple observed canonical declarations disagree; choose one intended preferred document.", CANONICAL_FIX, "medium"),
    "canonical_invalid": Rule("indexability", "warning", "observed", "html", "The canonical could not be accepted under URL safety rules; unsafe values are not retained.", CANONICAL_FIX, "medium"),
    "redirect": Rule("redirects", "opportunity", "observed", "redirected", "An internal redirect is not inherently a defect; direct links can avoid an unnecessary hop.", REDIRECT_FIX, "low"),
    "redirect_chain": Rule("redirects", "opportunity", "observed", "redirected", "Multiple observed redirect hops add request work. Confirm the intended final URL before simplifying.", REDIRECT_FIX, "medium"),
    "redirect_loop": Rule("redirects", "issue", "observed", "redirected", "A repeated URL was observed in redirect traversal, so no terminal destination was reached.", REDIRECT_FIX, "high"),
    "redirect_broken": Rule("redirects", "issue", "observed", "redirected", "The redirect ended at a verified HTTP error rather than a usable final destination.", REDIRECT_FIX, "high"),
    "duplicate_title": Rule("metadata", "opportunity", "observed", "titles", "Distinct observed final documents share a normalized title; intent and scale determine whether to change it.", META_FIX, "medium"),
    "duplicate_description": Rule("metadata", "opportunity", "observed", "descriptions", "Distinct observed final documents share a description. Improve snippets after verified access/indexability failures.", META_FIX, "low"),
    "missing_title": Rule("metadata", "issue", "observed", "html", "A successful HTML snapshot has no descriptive title; the finding is observed, not an impact forecast.", META_FIX),
    "missing_description": Rule("metadata", "opportunity", "observed", "html", "A successful HTML snapshot has no description; a search engine may still generate its own snippet.", META_FIX),
    "missing_h1": Rule("metadata", "opportunity", "observed", "html", "No primary heading was observed; check page semantics and rendered content before editing.", META_FIX),
    "multiple_h1": Rule("metadata", "opportunity", "review", "html", "Multiple H1 elements warrant a hierarchy review, not an automatic indexing failure.", META_FIX, "low"),
    "missing_canonical": Rule("indexability", "opportunity", "review", "html", "An explicit canonical was absent. Absence alone does not demonstrate an indexing problem.", CANONICAL_FIX, "low"),
}
DEFAULT = Rule("access", "warning", "unknown", "unknown", "Unclassified historical rule; review its retained evidence before prioritizing.", ACCESS_FIX)


def enrich_issue(issue):
    spec = RULES.get(issue["code"], DEFAULT)
    return {**issue, "priority": spec.priority or issue.get("priority", "low"), "category": spec.category,
            "issue_type": spec.issue_type, "confidence": spec.confidence,
            "priority_reason": spec.reason, "fix_steps": list(spec.steps)}


def eligible_urls(pages, population):
    if not pages or population == "unknown":
        return None
    html = [p for p in pages if not p.get("error") and 200 <= (p.get("status_code") or 0) < 300
            and "html" in p.get("content_type", "")]
    # A redirect alias is not another successful document for metadata/indexability coverage.
    unique_html = {}
    for page in sorted(html, key=lambda p: (bool(p.get("redirect_chain")), p["url"])):
        unique_html.setdefault(page.get("final_url") or page["url"], page)
    html = list(unique_html.values())
    candidates = {
        "all": pages,
        "fetched": [p for p in pages if p.get("status_code") is not None],
        "html": html,
        "canonical": [p for p in html if p.get("canonical")],
        "titles": [p for p in html if p.get("title")],
        "descriptions": [p for p in html if p.get("description")],
        "linked_html": [p for p in html if p.get("internal_links")],
        "redirected": [p for p in pages if p.get("redirect_chain")],
    }.get(population, [])
    return {p["url"] for p in candidates}


def group_issues(pages, issues, *, summary=None):
    buckets = defaultdict(list)
    for issue in issues:
        buckets[issue["code"]].append(enrich_issue(issue))
    groups = []
    for code, occurrences in buckets.items():
        first = occurrences[0]
        eligible = eligible_urls(pages, RULES.get(code, DEFAULT).population)
        affected = sorted({i["url"] for i in occurrences})
        # Historical issues outside the retained page population cannot support a valid denominator.
        eligible_count = len(eligible) if eligible and set(affected) <= eligible else None
        groups.append({key: first[key] for key in ("code", "category", "issue_type", "priority", "confidence",
                                                   "title", "recommendation", "fix_steps", "priority_reason")}
                      | {"affected_count": len(affected), "eligible_count": eligible_count,
                         "coverage_pct": round(len(affected) / eligible_count * 100, 4) if eligible_count else None,
                         "affected_urls": affected, "occurrences": len(occurrences),
                         "issues": sorted(occurrences, key=lambda i: (i["url"], str(i.get("details", {}).get("target_url", ""))))})
    groups.sort(key=lambda g: ({"high": 0, "medium": 1, "low": 2}.get(g["priority"], 3),
                               {"observed": 0, "review": 1, "unknown": 2}[g["confidence"]], -g["affected_count"], g["code"]))
    summary = summary or {}
    return {"groups": groups,
            "coverage": {"scope": "observed_scan", "complete": False, "pages_count": len(pages),
                         "limited": bool(summary.get("limit_reached") or summary.get("skipped_robots")),
                         "denominator": "Per-rule eligible observed URLs; redirect aliases excluded from HTML metadata populations."},
            "note": "Observed scan evidence only. Sorted by severity, evidence confidence, affected URL count, then rule code. No ranking/revenue forecast; intentional exclusions require owner review."}


def filter_groups(result, *, q="", priority="", category="", confidence="", issue_type=""):
    import json
    groups = [g for g in result["groups"] if (not priority or g["priority"] == priority)
              and (not category or g["category"] == category)
              and (not confidence or g["confidence"] == confidence)
              and (not issue_type or g["issue_type"] == issue_type)
              and (not q or q.casefold() in json.dumps(g, ensure_ascii=False).casefold())]
    return {**result, "groups": groups}


def action_rows(result, pages):
    lookup = {p["url"]: p for p in pages}
    for page in sorted(pages, key=lambda p: (bool(p.get("redirect_chain")), p["url"])):
        lookup.setdefault(page.get("final_url") or page["url"],
                          {**page, "first_status_code": page.get("final_status_code", page.get("status_code"))})
    actions = []
    for group in result["groups"]:
        for issue in group["issues"]:
            page, details = lookup.get(issue["url"], {}), issue.get("details", {})
            chain = details.get("chain") or page.get("redirect_chain", [])
            target = details.get("target_url") or details.get("canonical") or (
                chain[-1].get("location", "") if chain else "")
            target_page = lookup.get(target, {})
            actions.append({"source_url": issue["url"], "target_url": target,
                            "first_status_code": page.get("first_status_code", chain[0].get("status") if chain else page.get("status_code")),
                            "final_status_code": page.get("final_status_code", page.get("status_code")),
                            "target_status_code": target_page.get("first_status_code", target_page.get("status_code", details.get("target_status"))),
                            "target_final_status_code": target_page.get("final_status_code", target_page.get("status_code", details.get("target_status"))),
                            **{key: group[key] for key in ("code", "category", "issue_type", "priority", "confidence",
                                                          "priority_reason", "fix_steps", "affected_count", "eligible_count", "coverage_pct")},
                            "recommendation": issue["recommendation"], "evidence": details})
    return actions
