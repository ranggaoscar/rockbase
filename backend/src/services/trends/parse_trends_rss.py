#!/usr/bin/env python
"""Strict, bounded Google Trends RSS parser. Reads XML on stdin and emits JSON."""
import json
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from defusedxml import ElementTree as ET

HT = "https://trends.google.com/trending/rss"
MAX_BYTES = 2_000_000
MAX_ITEMS = 100
MAX_NEWS = 20


def child_text(element, tag, namespace=None):
    node = element.find(f"{{{namespace}}}{tag}" if namespace else tag)
    return (node.text or "").strip() if node is not None else ""


def parse_date(value):
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return None


def parse(xml):
    root = ET.fromstring(xml)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("RSS channel is missing")
    items = []
    for node in channel.findall("item")[:MAX_ITEMS]:
        topic = child_text(node, "title")
        if not topic:
            continue
        traffic = child_text(node, "approx_traffic", HT)
        match = re.fullmatch(r"\s*([\d,.]+)([KMBkmb])?\+?\s*", traffic)
        lower = None
        if match:
            number = match.group(1)
            number = number.replace(',', '') if re.fullmatch(r'\d{1,3}(?:,\d{3})+', number) else number.replace(',', '.')
            try:
                lower = float(number) * {'K': 1000, 'M': 1000000, 'B': 1000000000}.get((match.group(2) or '').upper(), 1)
            except ValueError:
                pass
        if lower is not None and lower.is_integer():
            lower = int(lower)
        news = []
        for n in node.findall(f"{{{HT}}}news_item")[:MAX_NEWS]:
            news.append({
                "title": child_text(n, "news_item_title", HT),
                "url": child_text(n, "news_item_url", HT),
                "source": child_text(n, "news_item_source", HT),
            })
        items.append({
            "topic": topic[:500],
            "publishedAt": parse_date(child_text(node, "pubDate")),
            "trafficText": traffic[:100],
            "trafficLowerBound": lower,
            "sourceUrl": "https://trends.google.com/trending/rss?geo=ID",
            "news": news,
        })
    return {"items": items}


def main():
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("RSS XML exceeds parser limit")
    sys.stdout.write(json.dumps(parse(raw), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.write(f"Invalid RSS: {type(exc).__name__}\n")
        sys.exit(2)
