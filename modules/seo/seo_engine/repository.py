"""Isolated SQLite snapshots. Never opens the RockBase social database."""
import json
import sqlite3
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .graph import build_graph
from .triage import enrich_issue, filter_groups, group_issues


def now():
    return datetime.now(timezone.utc).isoformat()


class Repository:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS websites (
                    id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL,
                    brand_key TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, base_url TEXT NOT NULL,
                    UNIQUE(workspace_id, base_url));
                CREATE TABLE IF NOT EXISTS website_brands (
                    workspace_id TEXT NOT NULL, key TEXT NOT NULL COLLATE NOCASE,
                    name TEXT NOT NULL COLLATE NOCASE,
                    PRIMARY KEY(workspace_id, key), UNIQUE(workspace_id, name));
                CREATE TABLE IF NOT EXISTS scans (
                    id INTEGER PRIMARY KEY, website_id INTEGER NOT NULL REFERENCES websites(id),
                    status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
                    max_urls INTEGER NOT NULL, mode TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}',
                    error TEXT NOT NULL DEFAULT '');
                CREATE TABLE IF NOT EXISTS pages (
                    id INTEGER PRIMARY KEY, scan_id INTEGER NOT NULL REFERENCES scans(id),
                    url TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(scan_id, url));
                CREATE TABLE IF NOT EXISTS issues (
                    id INTEGER PRIMARY KEY, scan_id INTEGER NOT NULL REFERENCES scans(id), data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS scan_graphs (
                    scan_id INTEGER PRIMARY KEY REFERENCES scans(id), data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS scan_website ON scans(website_id, id);
                CREATE INDEX IF NOT EXISTS page_scan ON pages(scan_id);
                CREATE INDEX IF NOT EXISTS issue_scan ON issues(scan_id);
                CREATE UNIQUE INDEX IF NOT EXISTS single_active_scan ON scans((1))
                    WHERE status IN ('queued','running');
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def websites(self, workspace):
        with self.connect() as db:
            return [dict(x) for x in db.execute("SELECT * FROM websites WHERE workspace_id=? ORDER BY id", (workspace,))]

    def brands(self, workspace):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT key,name,workspace_id FROM website_brands WHERE workspace_id=? ORDER BY name", (workspace,))]

    def register_brand(self, workspace, key, name):
        with self.connect() as db:
            existing = db.execute("SELECT key,name,workspace_id FROM website_brands WHERE workspace_id=? AND (key=? OR name=?)", (workspace, key, name)).fetchone()
            if existing:
                return dict(existing)
            db.execute("INSERT INTO website_brands(workspace_id,key,name) VALUES(?,?,?)", (workspace, key, name))
        return next(row for row in self.brands(workspace) if row["key"] == key)

    def website(self, website_id, workspace):
        with self.connect() as db:
            row = db.execute("SELECT * FROM websites WHERE id=? AND workspace_id=?", (website_id, workspace)).fetchone()
            return dict(row) if row else None

    def add_website(self, workspace, name, base_url, brand_key=""):
        with self.connect() as db:
            db.execute("INSERT INTO websites(workspace_id,name,base_url,brand_key) VALUES(?,?,?,?) ON CONFLICT(workspace_id,base_url) DO NOTHING", (workspace, name, base_url, brand_key))
            return dict(db.execute("SELECT * FROM websites WHERE workspace_id=? AND base_url=?", (workspace, base_url)).fetchone())

    def set_brand(self, website_id, workspace, brand_key):
        with self.connect() as db:
            changed = db.execute("UPDATE websites SET brand_key=? WHERE id=? AND workspace_id=?", (brand_key, website_id, workspace)).rowcount
        if not changed:
            return None
        return self.website(website_id, workspace)

    def scan(self, scan_id, workspace=None):
        with self.connect() as db:
            sql = """SELECT s.*, (SELECT COUNT(*) FROM pages p WHERE p.scan_id=s.id) pages_count,
                (SELECT COUNT(*) FROM issues i WHERE i.scan_id=s.id) issues_count
                FROM scans s JOIN websites w ON w.id=s.website_id WHERE s.id=?"""
            params = [scan_id]
            if workspace is not None:
                sql += " AND w.workspace_id=?"
                params.append(workspace)
            row = db.execute(sql, params).fetchone()
            if not row:
                return None
            result = dict(row)
            result["summary"] = json.loads(result["summary"])
            # Read-time taxonomy also applies to the summary; keep raw historical JSON unchanged.
            if result["issues_count"]:
                result["summary"]["priority_counts"] = dict(Counter(issue["priority"] for issue in self.rows("issues", scan_id)))
            return result

    def scans(self, website_id):
        with self.connect() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM scans WHERE website_id=? ORDER BY id DESC", (website_id,))]
        return [self.scan(i) for i in ids]

    def create_scan(self, website_id, max_urls, mode):
        with self.connect() as db:
            cursor = db.execute("INSERT INTO scans(website_id,status,started_at,max_urls,mode) VALUES(?,'queued',?,?,?)", (website_id, now(), max_urls, mode))
            scan_id = cursor.lastrowid
        return self.scan(scan_id)

    def update_scan(self, scan_id, *, status=None, summary=None, error=None):
        values = {k: v for k, v in {"status": status, "summary": json.dumps(summary) if summary is not None else None, "error": error}.items() if v is not None}
        if status in {"completed", "failed", "interrupted"}:
            values["finished_at"] = now()
        with self.connect() as db:
            db.execute(f"UPDATE scans SET {','.join(k+'=?' for k in values)} WHERE id=?", [*values.values(), scan_id])

    def save_page(self, scan_id, page):
        with self.connect() as db:
            db.execute("INSERT INTO pages(scan_id,url,data) VALUES(?,?,?) ON CONFLICT(scan_id,url) DO UPDATE SET data=excluded.data", (scan_id, page["url"], json.dumps(page)))
            db.execute("DELETE FROM scan_graphs WHERE scan_id=?", (scan_id,))

    def save_graph(self, scan_id, graph):
        with self.connect() as db:
            db.execute("INSERT INTO scan_graphs(scan_id,data) VALUES(?,?) ON CONFLICT(scan_id) DO UPDATE SET data=excluded.data", (scan_id, json.dumps(graph)))

    def graph(self, scan_id):
        with self.connect() as db:
            stored = db.execute("SELECT data FROM scan_graphs WHERE scan_id=?", (scan_id,)).fetchone()
            base = db.execute("SELECT w.base_url FROM scans s JOIN websites w ON w.id=s.website_id WHERE s.id=?", (scan_id,)).fetchone()
        if not base:
            raise ValueError("Scan not found")
        if stored:
            return json.loads(stored[0])
        summary = self.scan(scan_id)["summary"]
        return build_graph(self.rows("pages", scan_id, analysis=False), base[0],
                           sitemap_edges=summary.get("sitemap_edges", []),
                           limited=summary.get("limit_reached") or summary.get("skipped_robots"))

    def issue_groups(self, scan_id, *, q="", priority="", category="", confidence="", issue_type=""):
        result = group_issues(self.rows("pages", scan_id, analysis=False), self.rows("issues", scan_id),
                              summary=self.scan(scan_id)["summary"])
        return filter_groups(result, q=q, priority=priority, category=category, confidence=confidence, issue_type=issue_type)

    def save_issues(self, scan_id, issues):
        with self.connect() as db:
            db.executemany("INSERT INTO issues(scan_id,data) VALUES(?,?)", [(scan_id, json.dumps(i)) for i in issues])

    def rows(self, kind, scan_id, *, q="", priority="", status="", analysis=True):
        if kind not in {"pages", "issues"}:
            raise ValueError("Unknown result kind")
        with self.connect() as db:
            rows = [{"id": r["id"], "scan_id": scan_id, **json.loads(r["data"])} for r in db.execute(f"SELECT id,data FROM {kind} WHERE scan_id=? ORDER BY id", (scan_id,))]
        if kind == "issues":
            rows = [enrich_issue(row) for row in rows]
        elif analysis and rows:
            graph = self.graph(scan_id)
            nodes = {node["url"]: node for node in graph["nodes"]}
            metrics = ("depth", "redirect_hops", "path", "inlinks", "unique_inlinks", "followed_inlinks", "unique_followed_inlinks", "outlinks", "unique_outlinks", "discovery_sources")
            for row in rows:
                node = nodes.get(row["url"], {})
                row.update({key: node.get(key) if graph["available"] else None for key in metrics})
                row["graph_available"] = graph["available"]
        if q:
            rows = [r for r in rows if q.casefold() in json.dumps(r, ensure_ascii=False).casefold()]
        if priority and kind == "issues":
            rows = [r for r in rows if r["priority"] == priority]
        if status and kind == "pages":
            rows = [r for r in rows if str(r.get("first_status_code", r["status_code"])) == status or (status == "error" and (r["error"] or (r["status_code"] or 0) >= 400)) or (len(status) == 3 and status.endswith("xx") and r.get("first_status_code", r["status_code"]) and str(r.get("first_status_code", r["status_code"]))[0] == status[0])]
        if kind == "issues":
            rows.sort(key=lambda r: ({"high": 0, "medium": 1, "low": 2}[r["priority"]], r["code"], r["url"]))
        return rows

    def compare(self, scan_id):
        current = self.scan(scan_id)
        with self.connect() as db:
            previous = db.execute("SELECT id FROM scans WHERE website_id=? AND id<? AND status='completed' ORDER BY id DESC LIMIT 1", (current["website_id"], scan_id)).fetchone()
        result = {"previous_scan_id": previous[0] if previous else None, "added_urls": [], "removed_urls": [], "changed_urls": [], "new_issues": [], "resolved_issues": [], "note": "No completed previous scan to compare."}
        if not previous:
            return result
        old = {r["url"]: r for r in self.rows("pages", previous[0])}
        new = {r["url"]: r for r in self.rows("pages", scan_id)}
        shared = old.keys() & new.keys()
        fields = ["status_code", "final_url", "title", "description", "h1", "canonical", "meta_robots", "x_robots_tag", "indexable"]
        result.update(added_urls=sorted(new.keys()-old.keys()), removed_urls=sorted(old.keys()-new.keys()), changed_urls=[{"url": url, "fields": {f: {"before": old[url][f], "after": new[url][f]} for f in fields if old[url][f] != new[url][f]}} for url in sorted(shared) if any(old[url][f] != new[url][f] for f in fields)])
        comparable = {u for u in shared if old[u]["status_code"] is not None and new[u]["status_code"] is not None}
        def issue_key(i):
            return (i["url"], i["code"], i["details"].get("target_url", ""))
        old_issues = {issue_key(i): i for i in self.rows("issues", previous[0]) if i["url"] in comparable}
        new_issues = {issue_key(i): i for i in self.rows("issues", scan_id) if i["url"] in comparable}
        result["new_issues"] = [new_issues[k] for k in new_issues.keys()-old_issues.keys()]
        # A missing destination in current coverage cannot prove a broken link was resolved.
        result["resolved_issues"] = [old_issues[k] for k in old_issues.keys()-new_issues.keys() if not old_issues[k]["details"].get("target_url") or (old_issues[k]["details"]["target_url"] in new and new[old_issues[k]["details"]["target_url"]]["status_code"] is not None)]
        result["note"] = "Coverage comparison only: URLs not observed are not confirmed deleted. Issue changes only compare URLs fetched in both scans."
        return result
