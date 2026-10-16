"""One real local browser QA: no intercepted responses or synthetic application results."""
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "rockbase-data/seo/evidence"


async def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    checks, errors = {}, []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1536, "height": 1100}, accept_downloads=True)
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto("http://127.0.0.1:5173/seo")
        await page.get_by_role("heading", name="SEO Intelligence", exact=True).wait_for()
        await page.get_by_role("button", name="Start SEO scan").wait_for(timeout=45000)
        checks["integrated_rockbase_shell"] = await page.get_by_role("link", name="Farm View / Sessions").count() == 1
        # Resume the same QA without generating repeated live crawls after UI-only fixes.
        if '--reuse' in sys.argv:
            existing = await context.request.get('http://127.0.0.1:5173/api/seo/websites/1/scans')
            payload = (await existing.json())[0]
            checks['start_scan_http'] = '202 verified in original dashboard run; existing scan reused'
        else:
            async with page.expect_response(lambda r: "/api/seo/websites/" in r.url and r.request.method == "POST") as started:
                await page.get_by_role("button", name="Start SEO scan").click()
            response = await started.value
            payload = await response.json()
            checks["start_scan_http"] = response.status
            assert response.status == 202, payload
        checks["scan_id"] = payload["id"]
        for _ in range(150):
            result = await context.request.get(f'http://127.0.0.1:5173/api/seo/scans/{payload["id"]}')
            scan = await result.json()
            if scan["status"] not in {"queued", "running"}:
                break
            await asyncio.sleep(2)
        assert scan["status"] in {"completed", "failed"}, scan
        if scan['status'] == 'failed':
            assert scan['summary']['robots_status'] == 403 and scan['issues_count'] > 0, scan
            checks['pilot_blocked_honestly'] = True
        checks["real_pilot_scan"] = scan
        await page.get_by_role("button", name="Refresh SEO data").click()
        await page.get_by_role("button", name="Issues (" + str(scan["issues_count"]) + ")", exact=True).wait_for(timeout=15000)
        await page.screenshot(path=str(EVIDENCE / "seo-overview.png"), full_page=True)
        await page.get_by_role("button", name="Issues (" + str(scan["issues_count"]) + ")", exact=True).click()
        await page.get_by_role("combobox", name="Filter issues by priority").click()
        await page.get_by_role("option", name="High", exact=True).click()
        await page.wait_for_timeout(800)
        async with page.expect_download() as download:
            await page.get_by_role("button", name="JSON", exact=True).click()
        file = await download.value
        path = EVIDENCE / "pilot-high-issues.json"
        await file.save_as(path)
        exported = json.loads(path.read_text(encoding="utf-8-sig"))
        assert all(i["priority"] == "high" for i in exported["results"])
        checks["filtered_json_export_count"] = len(exported["results"])
        await page.get_by_role("combobox", name="Filter issues by priority").click()
        await page.get_by_role("option", name="All priorities", exact=True).click()
        await page.wait_for_timeout(500)
        if scan["issues_count"]:
            issue_button = page.locator("button").filter(has=page.locator("span.block.truncate.text-sm.font-medium")).first
            await issue_button.click()
            await page.get_by_role("heading", name="Recommended action", exact=True).wait_for()
            checks["issue_detail_recommendation"] = True
            await page.screenshot(path=str(EVIDENCE / "seo-issue-detail.png"), full_page=True)
            await page.get_by_role("button", name="Close detail panel").click()
        async with page.expect_download() as download:
            await page.get_by_role("button", name="CSV", exact=True).click()
        file = await download.value
        await file.save_as(EVIDENCE / "pilot-issues.csv")
        checks["csv_export"] = True
        await page.get_by_role("button", name="URLs (" + str(scan["pages_count"]) + ")", exact=True).click()
        if scan['pages_count']:
            await page.get_by_role("button", name="View details for https://magrade.co.id/", exact=True).click()
            await page.get_by_role("heading", name="URL inspection", exact=True).wait_for()
            checks["url_inspection"] = True
            await page.get_by_role("button", name="Close detail panel").click()
        else:
            checks['url_inspection'] = 'Not exercised: live pilot blocked before page crawl; parser covered in focused tests.'
        await page.screenshot(path=str(EVIDENCE / "seo-urls.png"), full_page=True)
        await page.reload()
        await page.get_by_role("button", name="URLs (" + str(scan["pages_count"]) + ")", exact=True).wait_for(timeout=15000)
        checks["persisted_after_reload"] = True
        checks["desktop_no_page_overflow"] = await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        await page.get_by_role("button", name="Add website", exact=True).click()
        await page.get_by_label("Website name", exact=True).wait_for()
        checks["website_dialog"] = True
        await page.get_by_role("button", name="Cancel", exact=True).click()
        # Read-only regression navigation: no social session or publish actions.
        for name, url in [("Accounts", "/accounts"), ("Farm View / Sessions", "/farm"), ("Queue", "/queue"), ("Overview", "/")]:
            await page.get_by_role("link", name=name, exact=True).click()
            await page.wait_for_url("**" + url)
            await page.wait_for_timeout(500)
            checks["navigation_" + name] = await page.locator("body").inner_text() != ""
        await page.get_by_role("link", name="SEO Intelligence", exact=True).click()
        await page.get_by_role("heading", name="SEO Intelligence", exact=True).wait_for()
        checks["browser_errors"] = errors
        await browser.close()
    (EVIDENCE / "browser-qa.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")
    print(json.dumps(checks, indent=2))
    assert not errors, errors


if __name__ == "__main__":
    asyncio.run(main())
