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


def create_app(repo=None, *, token=None, validate=validate_public):
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
            scan = repo.create_scan(website_id, body.max_urls, body.mode)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "An SEO scan is already active. Wait for completion.") from exc
        try:
            worker_env = {key: value for key, value in os.environ.items() if key != 'ROCKBASE_SEO_TOKEN'}
            worker_env['ROCKBASE_SEO_DB'] = str(repo.path)
            process = await asyncio.create_subprocess_exec(sys.executable, "-m", "seo_engine.scan_worker", str(scan["id"]), cwd=str(Path(__file__).resolve().parents[1]), env=worker_env, creationflags=0x08000000 if os.name == "nt" else 0)
            workers[scan["id"]] = process
            task = asyncio.create_task(monitor(scan["id"], process))
            monitors.add(task)
            task.add_done_callback(monitors.discard)
        except Exception as exc:
            repo.update_scan(scan["id"], status="failed", error=f"Could not start worker: {exc}")
            raise HTTPException(503, "SEO worker could not start") from exc
        return repo.scan(scan["id"])

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

    @app.get("/api/scans/{scan_id}/export")
    def export(scan_id: int, x_workspace_id: str = Header(), kind: Literal["issues", "pages"] = "issues", format: Literal["csv", "json"] = "csv", q: str = "", priority: str = "", status: str = ""):
        scan = require_scan(scan_id, x_workspace_id)
        rows = repo.rows(kind, scan_id, q=q, priority=priority, status=status)
        if format == "json":
            content = json.dumps({"scan": scan, "kind": kind, "filters": {"q": q, "priority": priority, "status": status}, "results": rows}, ensure_ascii=False, indent=2)
            media_type = "application/json"
        else:
            output = io.StringIO(newline="")
            fields = list(rows[0]) if rows else (["id", "scan_id", "url", "code", "priority", "title", "recommendation", "details"] if kind == "issues" else ["id", "scan_id", "url", "status_code", "title"])
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
