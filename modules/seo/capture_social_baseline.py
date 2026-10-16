"""Read-only preservation evidence. No cookie/key values enter output or evidence."""
import hashlib
import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = root / "backend/prisma/dev.db"
target = root / "rockbase-data/seo/evidence"
target.mkdir(parents=True, exist_ok=True)
connection = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
result = {"database_integrity": connection.execute("PRAGMA integrity_check").fetchone()[0]}
for table in ["User", "Workspace", "SocialAccount", "Post", "Campaign", "_prisma_migrations"]:
    result[table] = connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
# Ordered encrypted-cookie digest is proof of unchanged saved sessions, never secret content.
rows = connection.execute('SELECT id,cookies,accountPassword FROM SocialAccount ORDER BY id').fetchall()
result["saved_session_digest"] = hashlib.sha256(json.dumps(rows).encode()).hexdigest()
result["schema_digest"] = hashlib.sha256(json.dumps(connection.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").fetchall()).encode()).hexdigest()
env = root / "backend/.env"
result["configuration_digest"] = hashlib.sha256(env.read_bytes()).hexdigest() if env.exists() else None
backup = target / "social-before-seo.sqlite"
if not backup.exists():
    with sqlite3.connect(backup) as dest:
        connection.backup(dest)
connection.close()
label = "baseline" if not (target / "baseline.json").exists() else "after"
(target / f"{label}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
if label == "after":
    baseline = json.loads((target / "baseline.json").read_text())
    diff = {k: [baseline.get(k), v] for k, v in result.items() if baseline.get(k) != v}
    print(json.dumps({"unchanged": not diff, "changes": diff, "integrity": result["database_integrity"]}))
else:
    print(json.dumps({"baseline_saved": True, "integrity": result["database_integrity"], "workspaces": result["Workspace"], "social_accounts": result["SocialAccount"], "backup": str(backup)}))
