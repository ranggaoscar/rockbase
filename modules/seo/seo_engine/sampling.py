"""Deterministic, competitor-only ordering for bounded representative crawls."""
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_FAMILIES = (
    ("about", ("about", "company")),
    ("catalog", ("catalog", "material", "stone", "product")),
    ("projects", ("project", "case")),
    ("contact", ("contact",)),
    ("blog", ("blog", "article")),
)
_LANG_PARAMS = {"locale", "lang", "language", "hl"}
_LOCALES = {"en", "id", "fr", "de", "es", "it", "pt", "nl", "ja", "ko", "zh", "ru", "ar", "th", "vi", "ms"}


def language_family(url):
    """Scheduling heuristic only; never a storage or content-equivalence key."""
    parsed = urlsplit(url)
    parts = [part for part in parsed.path.split("/") if part]
    prefix = parts[0].lower() if parts else ""
    locale = prefix in _LOCALES or (len(prefix) == 5 and prefix[2] == "-" and prefix[:2] in _LOCALES and prefix[3:].isalpha())
    if locale:
        parts = parts[1:]
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key.lower() not in _LANG_PARAMS]
    return urlunsplit((parsed.scheme, parsed.netloc, "/" + "/".join(parts), urlencode(sorted(query)), ""))


def _family(url):
    parts = [part.lower() for part in urlsplit(language_family(url)).path.split("/") if part]
    if not parts:
        return "root"
    for family, terms in _FAMILIES:
        if any(part == term or part == term + "s" or part.startswith(term + "-") for term in terms for part in parts[:1]):
            return family
    return "other"


def _language_variant(url):
    parsed = urlsplit(url)
    if any(key.lower() in _LANG_PARAMS for key, _ in parse_qsl(parsed.query, keep_blank_values=True)):
        return True
    segments = [part.lower() for part in parsed.path.split("/") if part]
    return bool(segments and (segments[0] in _LOCALES or (len(segments[0]) == 5 and segments[0][2] == "-" and segments[0][:2] in _LOCALES and segments[0][3:].isalpha())))


def order_representative_urls(urls, limit=None):
    """Return unique URLs diversified by family, with language variants last."""
    candidates = sorted(set(urls), key=lambda u: (_language_variant(u), len(urlsplit(u).path.split("/")), bool(urlsplit(u).query), u))
    primary, deferred, families = [], [], set()
    for url in candidates:
        key = language_family(url)
        if key in families:
            deferred.append(url)
        else:
            primary.append(url)
            families.add(key)

    def round_robin(group):
        buckets = {}
        for url in group:
            buckets.setdefault(_family(url), []).append(url)
        ordered = []
        # Root, then one URL from every known family, then further URLs per family.
        priority = ["root"] + [name for name, _ in _FAMILIES] + ["other"]
        while any(buckets.values()):
            for family in priority:
                if buckets.get(family):
                    ordered.append(buckets[family].pop(0))
        return ordered

    ordered = round_robin(primary) + round_robin(deferred)
    if limit is not None:
        ordered = ordered[:max(0, limit)]
    return ordered, len(deferred)
