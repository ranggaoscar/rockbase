import { chromium } from 'playwright-extra';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';

chromium.use(stealthPlugin());

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  console.log('Navigating...');
  const response = await page.goto('https://comfyui.bresciastone.com/view?filename=reel_magma_gold.mp4&type=input', { waitUntil: 'networkidle' });
  
  if (response) {
    console.log(`Status: ${response.status()}`);
    const buffer = await response.body();
    fs.writeFileSync('test.mp4', buffer);
    console.log(`Saved test.mp4, size: ${buffer.length}`);
  } else {
    console.log('No response');
  }
  
  await browser.close();
}

main().catch(console.error);
