import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    root = Path(__file__).resolve().parents[2] / "rockbase-data/seo/evidence"
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1536, "height": 1100})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto("http://127.0.0.1:5173/seo")
        await page.get_by_role("button", name="Issues (1)", exact=True).wait_for()
        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert "Unassigned" in await page.locator("body").inner_text()
        await page.screenshot(path=str(root / "seo-overview.png"), full_page=True)
        history = await page.locator("#seo-history").inner_text()
        print({"history": history, "errors": errors, "screenshot": str(root / "seo-overview.png")})
        assert not errors
        await browser.close()


asyncio.run(main())
