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
    asyncio.run(SeoCrawler(repo, scan, website).run())


if __name__ == "__main__":
    main()
