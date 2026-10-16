import json
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[2]
with sqlite3.connect((root / "backend/prisma/dev.db").as_uri()+"?mode=ro", uri=True) as db:
    for table in ["ScheduledPost", "Campaign", "SocialAccount"]:
        try:
            print(table, db.execute(f'SELECT status,COUNT(*) FROM "{table}" GROUP BY status').fetchall())
        except sqlite3.Error as exc:
            print(table, str(exc))
