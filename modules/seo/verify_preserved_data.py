"""Compare all logical SQLite rows against the local pre-SEO backup; no private values output."""
import hashlib
import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
evidence = root / "rockbase-data/seo/evidence"


def snapshot(path):
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        result = {}
        for name in names:
            safe = name.replace('"', '""')
            rows = db.execute(f'SELECT * FROM "{safe}"').fetchall()
            serialized = sorted(json.dumps(row, default=lambda v: v.hex() if isinstance(v, bytes) else str(v), sort_keys=True) for row in rows)
            result[name] = {"count": len(rows), "digest": hashlib.sha256(json.dumps(serialized).encode()).hexdigest()}
        return result


before = snapshot(evidence / "social-before-seo.sqlite")
after = snapshot(root / "backend/prisma/dev.db")
changes = [name for name in before.keys() | after.keys() if before.get(name) != after.get(name)]
result = {"all_logical_tables_unchanged": not changes, "table_count": len(before), "changed_tables": changes}
(evidence / "full-data-preservation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
assert not changes
