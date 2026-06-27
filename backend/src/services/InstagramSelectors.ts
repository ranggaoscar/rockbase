/**
 * Instagram DOM selectors — robust multi-selector approach.
 * Instagram frequently changes aria-labels / DOM structure.
 * These selector arrays survive partial breakage by trying alternatives in order.
 */
import { Page } from 'playwright';

/** Try multiple selectors in order, return first match element. Supports optional timeout polling. */
export async function trySelectors(
  page: Page,
  selectors: string | string[],
  options?: { timeout?: number }
) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const timeout = options?.timeout || 0;
  const startTime = Date.now();

  do {
    for (const sel of list) {
      try {
        const el = await page.$(sel);
        if (el) {
          const isVisible = await el.isVisible().catch(() => false);
          if (isVisible) return el;
        }
      } catch { /* selector parse error, try next */ }
    }
    if (timeout > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } while (Date.now() - startTime < timeout);

  // Fallback check one last time without strict visibility check
  for (const sel of list) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch {}
  }

  return null;
}

/** Click a clickable ancestor of an SVG element. */
export async function clickSvgParent(page: Page, el: any) {
  try {
    let current = el;
    for (let i = 0; i < 4; i++) {
      const parent = await current.$('xpath=..');
      if (!parent) break;
      const tagName = await parent.evaluate((node: HTMLElement) => node.tagName.toLowerCase()).catch(() => '');
      const role = await parent.evaluate((node: HTMLElement) => node.getAttribute('role')).catch(() => '');
      if (tagName === 'button' || role === 'button') {
        await parent.click();
        return true;
      }
      current = parent;
    }
  } catch {}

  try {
    const parent = await el.$('xpath=..');
    if (parent) { await parent.click(); return true; }
  } catch {}
  try { await el.click(); return true; } catch {}
  return false;
}

export const IG_SELECTORS = {
  like: [
    'svg[aria-label="Like"]',
    'svg[aria-label="Suka"]',
    'svg[aria-label*="Like" i]',
    'svg[aria-label*="Suka" i]',
    'div[role="button"] svg[aria-label="Like"]',
    'div[role="button"] svg[aria-label="Suka"]',
    'span svg[aria-label="Like"]',
    'span svg[aria-label="Suka"]',
    'span:has(svg[aria-label*="Like" i])',
    'span:has(svg[aria-label*="Suka" i])',
  ],
  unlike: [
    'svg[aria-label="Unlike"]',
    'svg[aria-label="Batal Suka"]',
    'svg[aria-label*="Unlike" i]',
    'svg[aria-label*="Batal Suka" i]',
    'div[role="button"] svg[aria-label="Unlike"]',
    'div[role="button"] svg[aria-label="Batal Suka"]',
    'span svg[aria-label="Unlike"]',
    'span svg[aria-label="Batal Suka"]',
  ],
  commentInput: [
    'textarea[aria-label*="comment" i]',
    'textarea[aria-label*="komentar" i]',
    'textarea[placeholder*="comment" i]',
    'textarea[placeholder*="komentar" i]',
    'textarea[placeholder*="Add a comment" i]',
    'textarea[placeholder*="Tambahkan komentar" i]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="comment" i]',
    'div[contenteditable="true"][aria-label*="komentar" i]',
    'div[contenteditable="true"]',
    'form[method="POST"] textarea',
    'form textarea',
    'textarea',
  ],
  commentIcon: [
    'svg[aria-label="Comment"]',
    'svg[aria-label="Komentar"]',
    'svg[aria-label*="Comment" i]',
    'svg[aria-label*="Komentar" i]',
    'button:has(svg[aria-label="Comment"])',
    'button:has(svg[aria-label="Komentar"])',
    'span:has(svg[aria-label*="Comment" i])',
    'span:has(svg[aria-label*="Komentar" i])',
    'div[role="button"]:has(svg[aria-label*="Comment" i])',
    'div[role="button"]:has(svg[aria-label*="Komentar" i])',
  ],
  postBtn: [
    'div[role="button"]:has-text("Post")',
    'div[role="button"]:has-text("Kirim")',
    'div[role="button"]:has-text("Bagikan")',
    'button:has-text("Post")',
    'button:has-text("Kirim")',
    'button:has-text("Bagikan")',
    'button[type="submit"]',
    'div[role="button"] >> text=/^Post$/',
    'div[role="button"] >> text=/^Kirim$/',
  ],
  follow: [
    'button:has-text("Follow"):not(:has-text("Following"))',
    'button:has-text("Ikuti"):not(:has-text("Mengikuti"))',
    'div[role="button"]:has-text("Follow"):not(:has-text("Following"))',
    'div[role="button"]:has-text("Ikuti"):not(:has-text("Mengikuti"))',
    'button >> text="Follow"',
    'button >> text="Ikuti"',
    'button >> text=/^Follow$/',
    'button >> text=/^Ikuti$/',
  ],
  save: [
    'svg[aria-label="Save"]',
    'svg[aria-label*="Save" i]',
    'div[role="button"]:has(svg[aria-label="Save"])',
    'span:has(svg[aria-label*="Save" i])',
  ],
  storyCircle: [
    'div[role="button"] canvas',
    'ul li button:has(canvas)',
    'button:has(div[role="button"])',
  ],
  reelsNext: [
    'svg[aria-label="Next"]',
    'button[aria-label="Next"]',
    'div[role="button"] svg[aria-label="Next"]',
  ],
};
