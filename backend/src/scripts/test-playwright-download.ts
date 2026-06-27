import { chromium } from 'playwright-extra';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';

chromium.use(stealthPlugin());

async function main() {
  console.log('Launching browser in HEADED mode (headless: false)...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  console.log('Fetching media URL using page.goto...');
  
  try {
    const response = await page.goto('https://comfyui.bresciastone.com/view?filename=reel_Amber_Grey.mp4&type=input', { waitUntil: 'networkidle' });
    console.log('Page status:', response?.status());
    
    if (response && response.status() === 200) {
      const buffer = await response.body();
      fs.writeFileSync(path.join(process.cwd(), 'test_download_headed.mp4'), buffer);
      console.log('Downloaded successfully in headed mode! Size:', buffer.length);
    } else {
      const content = await page.content();
      console.log('Failed in headed mode. HTML head:', content.slice(0, 500));
    }
  } catch (err: any) {
    console.error('Error during download test:', err.message);
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
