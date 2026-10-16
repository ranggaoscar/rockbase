"""Bounded real public-web transport verification, separate from the operator's scan DB."""
import asyncio
import json
import os
from pathlib import Path

from seo_engine.crawler import SeoCrawler
from seo_engine.repository import Repository


async def main():
    target = Path(os.environ["TMPDIR"]) / "rockbase-seo-real-transport"
    target.mkdir(parents=True, exist_ok=True)
    # Actual example.com responses; never shown as Magrade results or synthetic fixtures.
    repo = Repository(target / "smoke.sqlite")
    website = repo.add_website("transport-verification", "Example.com real public smoke", "https://example.com/")
    scan = repo.create_scan(website["id"], 1, "browser")
    await SeoCrawler(repo, scan, website).run()
    result = repo.scan(scan["id"])
    pages = repo.rows("pages", scan["id"])
    print(json.dumps({"scan": result, "pages": pages}, indent=2))
    (target / "result.json").write_text(json.dumps({"scan": result, "pages": pages}, indent=2), encoding="utf-8")
    assert result["status"] == "completed", result
    assert pages[0]["title"] == "Example Domain", pages
    assert pages[0]["render_mode"] == "browser", pages


if __name__ == "__main__":
    asyncio.run(main())
