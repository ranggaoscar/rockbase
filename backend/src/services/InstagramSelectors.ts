/**
 * Instagram DOM selectors — robust multi-selector approach.
 * Instagram frequently changes aria-labels / DOM structure.
 * These selector arrays survive partial breakage by trying alternatives in order.
 */
import { Page } from 'playwright';

/** Try multiple selectors in order, return first match element. */
export async function trySelectors(page: Page, selectors: string | string[]) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const sel of list) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch { /* selector parse error, try next */ }
  }
  return null;
}

/** Click a clickable ancestor of an SVG element. */
export async function clickSvgParent(page: Page, el: any) {
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
    'svg[aria-label*="Like" i]',
    'div[role="button"] svg[aria-label="Like"]',
    'span svg[aria-label="Like"]',
    'span:has(svg[aria-label*="Like" i])',
  ],
  unlike: [
    'svg[aria-label="Unlike"]',
    'svg[aria-label*="Unlike" i]',
    'div[role="button"] svg[aria-label="Unlike"]',
    'span svg[aria-label="Unlike"]',
  ],
  commentInput: [
    'textarea[aria-label*="comment" i]',
    'textarea[placeholder*="comment" i]',
    'textarea[placeholder*="Add a comment" i]',
    'form[method="POST"] textarea',
    'div[contenteditable="true"][role="textbox"]',
  ],
  commentIcon: [
    'svg[aria-label="Comment"]',
    'svg[aria-label*="Comment" i]',
    'button:has(svg[aria-label="Comment"])',
  ],
  postBtn: [
    'div[role="button"]:has-text("Post")',
    'button:has-text("Post")',
    'button[type="submit"]',
    'div[role="button"] >> text=/^Post$/',
  ],
  follow: [
    'button:has-text("Follow"):not(:has-text("Following"))',
    'div[role="button"]:has-text("Follow"):not(:has-text("Following"))',
    'button >> text="Follow"',
    'button >> text=/^Follow$/',
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
