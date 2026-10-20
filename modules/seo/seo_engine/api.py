"""Private loopback RPC behind RockBase's existing authentication boundary."""
import asyncio
import csv
import hmac
import io
import json
import os
import sqlite3
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from typing import Literal

from .policy import normalize_url, validate_public
from .repository import Repository, now
from .triage import action_rows


def create_app(repo=None, *, token=None, validate=validate_public, scan_runner=None):
    repo = repo or Repository(os.environ["ROCKBASE_SEO_DB"])
    secret = token or os.environ["ROCKBASE_SEO_TOKEN"]
    workers = {}
    monitors = set()

    async def monitor(scan_id, process):
        await process.wait()
        current = repo.scan(scan_id)
        if current and current["status"] in {"running", "queued"}:
            repo.update_scan(scan_id, status="interrupted", error=f"SEO worker exited ({process.returncode}); partial results retained. Start a new scan.")
        workers.pop(scan_id, None)

    @asynccontextmanager
    async def lifespan(app):
        with repo.connect() as db:
            db.execute("UPDATE scans SET status='interrupted',finished_at=?,error='SEO service restarted; partial results retained' WHERE status IN ('queued','running')", (now(),))
        yield
        for process in list(workers.values()):
            if process.returncode is None:
                process.terminate()
        await asyncio.gather(*monitors, return_exceptions=True)

    app = FastAPI(title="RockBase SEO private worker", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if request.client.host not in {"127.0.0.1", "::1", "testclient"} or not hmac.compare_digest(request.headers.get("x-seo-token", ""), secret):
            return Response(status_code=401)
        return await call_next(request)

    def require_scan(scan_id, workspace):
        if not (scan := repo.scan(scan_id, workspace)):
            raise HTTPException(404, "Scan not found in this workspace")
        return scan

    async def launch_scan(scan, *, competitor=False):
        if scan_runner:
            await scan_runner(scan["id"])
            return
        try:
            worker_env = {key: value for key, value in os.environ.items() if key != 'ROCKBASE_SEO_TOKEN'}
            worker_env['ROCKBASE_SEO_DB'] = str(repo.path)
            worker_env['ROCKBASE_SEO_COMPETITOR'] = '1' if competitor else '0'
            process = await asyncio.create_subprocess_exec(sys.executable, "-m", "seo_engine.scan_worker", str(scan["id"]), cwd=str(Path(__file__).resolve().parents[1]), env=worker_env, creationflags=0x08000000 if os.name == "nt" else 0)
            workers[scan["id"]] = process
            task = asyncio.create_task(monitor(scan["id"], process))
            monitors.add(task)
            task.add_done_callback(monitors.discard)
        except Exception as exc:
            repo.update_scan(scan["id"], status="failed", error=f"Could not start worker: {exc}")
            raise HTTPException(503, "SEO worker could not start") from exc

    class WebsiteInput(BaseModel):
        name: str = Field(min_length=1, max_length=160)
        base_url: str = Field(max_length=2048)
        brand_key: str = Field(default="", max_length=160)

    class ScanInput(BaseModel):
        max_urls: int = Field(default=100, ge=1, le=100)
        mode: Literal["http", "auto", "browser"] = "auto"

    @app.get("/api/health")
    def health():
        with repo.connect() as db:
            db.execute("SELECT 1")
        return {"status": "ok", "database": "connected", "service": "rockbase-seo"}

    @app.get("/api/websites")
    def websites(x_workspace_id: str = Header()):
        return repo.websites(x_workspace_id)

    class WorkspaceBrandInput(BaseModel):
        key: str = Field(min_length=1, max_length=160)
        name: str = Field(min_length=1, max_length=160)

    @app.get("/api/brands")
    def brands(x_workspace_id: str = Header()):
        return repo.brands(x_workspace_id)

    @app.post("/api/brands")
    def register_brand(body: WorkspaceBrandInput, x_workspace_id: str = Header()):
        key, name = body.key.strip(), body.name.strip()
        if not key or not name:
            raise HTTPException(422, "Brand key and name are required")
        return repo.register_brand(x_workspace_id, key, name)

    @app.post("/api/websites", status_code=201)
    async def add_website(body: WebsiteInput, x_workspace_id: str = Header()):
        try:
            url = normalize_url(body.base_url)
            await validate(url)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return repo.add_website(x_workspace_id, body.name.strip(), url, body.brand_key)

    class BrandInput(BaseModel):
        brand_key: str = Field(min_length=1, max_length=160)

    @app.patch("/api/websites/{website_id}/brand")
    def set_brand(website_id: int, body: BrandInput, x_workspace_id: str = Header()):
        if not (updated := repo.set_brand(website_id, x_workspace_id, body.brand_key.strip())):
            raise HTTPException(404, "Website not found")
        return updated

    @app.get("/api/websites/{website_id}/scans")
    def scans(website_id: int, x_workspace_id: str = Header()):
        if not repo.website(website_id, x_workspace_id):
            raise HTTPException(404, "Website not found")
        return repo.scans(website_id)

    @app.post("/api/websites/{website_id}/scans", status_code=202)
    async def start_scan(website_id: int, body: ScanInput, x_workspace_id: str = Header()):
        if not repo.website(website_id, x_workspace_id):
            raise HTTPException(404, "Website not found")
        try:
            is_competitor = any(c["website_id"] == website_id for c in repo.competitors(x_workspace_id))
            if is_competitor:
                raise HTTPException(409, "Use the bounded competitor scan endpoint.")
            scan = repo.create_scan(website_id, body.max_urls, "http" if is_competitor else body.mode)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "An SEO scan is already active. Wait for completion.") from exc
        await launch_scan(scan)
        return repo.scan(scan["id"])

    class CompetitorInput(BaseModel):
        brand_key: str = Field(min_length=1, max_length=160)
        name: str = Field(min_length=1, max_length=160)
        base_url: str = Field(max_length=2048)

    class CompetitorScanInput(BaseModel):
        max_urls: int = Field(default=10, ge=1, le=25)

    @app.get("/api/competitors")
    def competitors(x_workspace_id: str = Header(), brand_key: str = ""):
        return repo.competitors(x_workspace_id, brand_key.strip() or None)

    @app.post("/api/competitors", status_code=201)
    async def add_competitor(body: CompetitorInput, x_workspace_id: str = Header()):
        brand_key, name = body.brand_key.strip(), body.name.strip()
        if not brand_key or not name:
            raise HTTPException(422, "Brand key and name are required")
        try:
            url = normalize_url(body.base_url)
            await validate(url)
            website = repo.add_competitor(x_workspace_id, brand_key, name, url)
        except FileExistsError as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return next(row for row in repo.competitors(x_workspace_id, brand_key) if row["website_id"] == website["id"])

    def require_competitor(competitor_id, workspace):
        if not (competitor := repo.competitor(competitor_id, workspace)):
            raise HTTPException(404, "Competitor not found in this workspace")
        return competitor

    @app.get("/api/competitors/{competitor_id}")
    def competitor_detail(competitor_id: int, x_workspace_id: str = Header()):
        from .competitors import analyze
        competitor = require_competitor(competitor_id, x_workspace_id)
        scans = repo.scans(competitor["website_id"], x_workspace_id)
        recent = next((s for s in scans if s["status"] in {"completed", "failed"}), None)
        if not recent:
            return {"competitor": competitor, "relationship": {"brand_key": competitor["brand_key"]}, "scan": None, "previous_scan": None, "findings": [], "coverage": {}, "limits": ["HTTP-only public-page snapshots."]}
        result = analyze(repo, competitor, recent["id"])
        result["relationship"] = {"brand_key": competitor["brand_key"]}
        result["scans"] = scans
        return result

    @app.get("/api/competitors/{competitor_id}/findings")
    def competitor_findings(competitor_id: int, x_workspace_id: str = Header(), scan_id: int | None = None):
        from .competitors import analyze
        competitor = require_competitor(competitor_id, x_workspace_id)
        try:
            return analyze(repo, competitor, scan_id)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.get("/api/competitors/{competitor_id}/scans")
    def competitor_scans(competitor_id: int, x_workspace_id: str = Header()):
        competitor = require_competitor(competitor_id, x_workspace_id)
        return repo.scans(competitor["website_id"], x_workspace_id)

    @app.post("/api/competitors/{competitor_id}/scans", status_code=202)
    async def start_competitor_scan(competitor_id: int, body: CompetitorScanInput, x_workspace_id: str = Header()):
        competitor = require_competitor(competitor_id, x_workspace_id)
        try:
            scan = repo.create_scan(competitor["website_id"], body.max_urls, "http")
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "An SEO scan is already active. Wait for completion.") from exc
        await launch_scan(scan, competitor=True)
        return repo.scan(scan["id"], x_workspace_id)

    @app.get("/api/scans/{scan_id}")
    def scan(scan_id: int, x_workspace_id: str = Header()):
        return require_scan(scan_id, x_workspace_id)

    @app.get("/api/scans/{scan_id}/pages")
    def pages(scan_id: int, x_workspace_id: str = Header(), q: str = "", status: str = ""):
        require_scan(scan_id, x_workspace_id)
        return repo.rows("pages", scan_id, q=q, status=status)

    @app.get("/api/scans/{scan_id}/issues")
    def issues(scan_id: int, x_workspace_id: str = Header(), q: str = "", priority: str = ""):
        require_scan(scan_id, x_workspace_id)
        return repo.rows("issues", scan_id, q=q, priority=priority)

    @app.get("/api/scans/{scan_id}/compare")
    def compare(scan_id: int, x_workspace_id: str = Header()):
        require_scan(scan_id, x_workspace_id)
        return repo.compare(scan_id)

    @app.get("/api/scans/{scan_id}/graph")
    def graph(scan_id: int, x_workspace_id: str = Header()):
        require_scan(scan_id, x_workspace_id)
        return repo.graph(scan_id)

    @app.get("/api/scans/{scan_id}/issue-groups")
    def issue_groups(scan_id: int, x_workspace_id: str = Header(), q: str = "", priority: str = "", category: str = "", confidence: str = "", issue_type: str = ""):
        require_scan(scan_id, x_workspace_id)
        return repo.issue_groups(scan_id, q=q, priority=priority, category=category, confidence=confidence, issue_type=issue_type)

    @app.get("/api/scans/{scan_id}/export")
    def export(scan_id: int, x_workspace_id: str = Header(), kind: Literal["issues", "pages", "links", "issue-groups", "actions"] = "issues", format: Literal["csv", "json"] = "csv", q: str = "", priority: str = "", status: str = "", category: str = "", confidence: str = "", issue_type: str = ""):
        scan = require_scan(scan_id, x_workspace_id)
        coverage = {"scope": "observed_scan", "complete": False}
        if kind in {"pages", "issues"}:
            rows = repo.rows(kind, scan_id, q=q, priority=priority, status=status)
        elif kind == "links":
            captured = repo.graph(scan_id)
            coverage = captured["coverage"]
            rows = [edge for edge in captured["edges"] if not q or q.casefold() in json.dumps(edge, ensure_ascii=False).casefold()]
        else:
            groups = repo.issue_groups(scan_id, q=q, priority=priority, category=category, confidence=confidence, issue_type=issue_type)
            coverage = groups["coverage"]
            rows = action_rows(groups, repo.rows("pages", scan_id, analysis=False)) if kind == "actions" else [
                {key: value for key, value in group.items() if key != "issues"} for group in groups["groups"]]
        if format == "json":
            content = json.dumps({"scan": scan, "kind": kind, "coverage": coverage, "filters": {"q": q, "priority": priority, "status": status, "category": category, "confidence": confidence, "issue_type": issue_type}, "results": rows}, ensure_ascii=False, indent=2)
            media_type = "application/json"
        else:
            output = io.StringIO(newline="")
            empty_fields = {
                "issues": ["id", "scan_id", "url", "code", "priority", "title", "recommendation", "details"],
                "pages": ["id", "scan_id", "url", "first_status_code", "final_status_code", "title", "depth"],
                "links": ["source_url", "target_url", "kind", "anchor", "rel", "follow", "occurrence"],
                "issue-groups": ["code", "category", "priority", "issue_type", "confidence", "affected_count", "eligible_count", "priority_reason", "fix_steps"],
                "actions": ["source_url", "target_url", "first_status_code", "final_status_code", "target_status_code", "code", "priority", "confidence", "priority_reason", "fix_steps"],
            }
            # Additive snapshots may have different keys, including historical rows in one scan.
            fields = list(dict.fromkeys(key for row in rows for key in row)) if rows else empty_fields[kind]
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            def safe(value):
                value = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else "" if value is None else str(value)
                # Prevent spreadsheet formula injection from crawled content.
                return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value
            writer.writerows({k: safe(v) for k, v in row.items()} for row in rows)
            content = "\ufeff" + output.getvalue()
            media_type = "text/csv"
        return Response(content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="rockbase-seo-scan-{scan_id}-{kind}.{format}"'})

    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="127.0.0.1", port=8765, log_level="info")
