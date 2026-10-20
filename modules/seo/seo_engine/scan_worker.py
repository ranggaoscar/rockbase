import asyncio
import os
import sys

from .crawler import SeoCrawler
from .repository import Repository


def main():
    repo = Repository(os.environ["ROCKBASE_SEO_DB"])
    scan = repo.scan(int(sys.argv[1]))
    with repo.connect() as db:
        website = dict(db.execute("SELECT * FROM websites WHERE id=?", (scan["website_id"],)).fetchone())
    competitor = any(c["website_id"] == website["id"] for c in repo.competitors(website["workspace_id"]))
    if os.environ.get("ROCKBASE_SEO_COMPETITOR") == "1" or competitor:
        scan["mode"] = "http"
    asyncio.run(SeoCrawler(repo, scan, website).run())
    if competitor:
        repo.prune_competitor_scans(website["id"], keep=5)


if __name__ == "__main__":
    main()
