/**
 * HumanBehavior — Centralized human-like behavior simulation module.
 *
 * ALL engagement actions MUST use this module to appear human.
 * Rules:
 *   - NEVER navigate directly to target URL without browsing first
 *   - Always randomize scroll duration and click timing
 *   - Character-by-character typing with random pauses
 *   - Random "thinking" pauses between actions
 *   - Simulate reading before engaging
 *   - Active hours 08:00–22:00 WIB only
 *   - Random off-actions: skip 20% of targets randomly
 */
import { Page } from 'playwright';

// ── Timing helpers ──────────────────────────────────────────────────────────

/** Random delay between min and max milliseconds */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Short pause — 0.5 to 2s — between micro-interactions */
function shortPause(): Promise<void> {
  return randomDelay(500, 2000);
}

/** Medium pause — 3 to 8s — between separate actions */
function mediumPause(): Promise<void> {
  return randomDelay(3000, 8000);
}

/** Long pause — 8 to 15s — between major tasks */
function longPause(): Promise<void> {
  return randomDelay(8000, 15000);
}

/** Thinking pause — 15 to 45s — between accounts/campaigns */
function thinkingPause(): Promise<void> {
  return randomDelay(15000, 45000);
}

/** Wait 5-15 seconds before engaging (like/follow/comment) */
function preEngagePause(): Promise<void> {
  return randomDelay(5000, 15000);
}

// ── Human-like typing ───────────────────────────────────────────────────────

/** Type text character by character with human-speed variance */
async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char, {
      delay: Math.floor(Math.random() * 120) + 30, // 30-150ms per char
    });
    // Occasional micro-pause (simulates thinking) — 8% chance
    if (Math.random() < 0.08) {
      await randomDelay(300, 1200);
    }
    // Rare longer pause (looks away briefly) — 3% chance
    if (Math.random() < 0.03) {
      await randomDelay(1000, 3000);
    }
  }
}

// ── Scrolling ───────────────────────────────────────────────────────────────

/** Scroll down by a random amount to simulate real browsing */
async function humanScroll(page: Page, times: number = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    const scrollAmount = Math.floor(Math.random() * 600) + 200;
    await page.mouse.wheel(0, scrollAmount);
    await randomDelay(800, 2500);
  }
}

/** Simulate reading content — scrolls and pauses for a random duration */
async function simulateReading(page: Page, minSec: number = 5, maxSec: number = 15): Promise<void> {
  const readTimeMs = Math.floor(Math.random() * (maxSec - minSec) * 1000) + minSec * 1000;
  const scrollSteps = Math.floor(readTimeMs / 3000); // Scroll roughly every 3s

  for (let i = 0; i < scrollSteps; i++) {
    await humanScroll(page);
    await randomDelay(1500, 4000);
  }

  // Final pause — the "reading" moment
  await randomDelay(2000, 5000);
}

// ── Warmup Browse ───────────────────────────────────────────────────────────

/**
 * WARMUP BROWSE — mandatory before any targeted action.
 * 1. Open Instagram feed
 * 2. Scroll feed for 10-30 seconds randomly
 * 3. Visit 1-2 random profiles along the way
 * 4. Return to feed
 *
 * After this, the caller navigates to the actual target.
 */
async function warmupBrowse(page: Page): Promise<void> {
  console.log('[HumanBehavior] Starting warmup browse...');

  // 1. Go to feed
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await mediumPause();

  // 2. Scroll the feed for 10-30 seconds
  const scrollDuration = Math.floor(Math.random() * 20000) + 10000; // 10-30s
  const scrollEnd = Date.now() + scrollDuration;
  console.log(`[HumanBehavior] Scrolling feed for ${Math.round(scrollDuration / 1000)}s`);

  while (Date.now() < scrollEnd) {
    await humanScroll(page);
    await randomDelay(1000, 3000);

    // Randomly like a post (5% chance) — natural behavior
    if (Math.random() < 0.05) {
      try {
        const likeBtn = await page.$('svg[aria-label="Like"]');
        if (likeBtn) {
          const parent = await likeBtn.$('xpath=..');
          if (parent) {
            await parent.click();
            await shortPause();
            console.log('[HumanBehavior] Liked a feed post (natural)');
          }
        }
      } catch { /* ignore */ }
    }
  }

  // 3. Visit 1-2 random profiles
  const profileVisits = Math.random() < 0.6 ? 2 : 1;
  for (let i = 0; i < profileVisits; i++) {
    try {
      // Click on a username link in the feed
      const profileLinks = await page.$$('a[href*="/"][role="link"] span');
      if (profileLinks.length > 3) {
        const randomIdx = Math.floor(Math.random() * Math.min(profileLinks.length, 8));
        await profileLinks[randomIdx].click();
        await mediumPause();

        // Scroll the profile a bit
        await humanScroll(page, 2);
        await randomDelay(3000, 8000);

        // Go back to feed
        await page.goBack().catch(() => {});
        await shortPause();
        console.log(`[HumanBehavior] Visited random profile ${i + 1}/${profileVisits}`);
      }
    } catch {
      // Profile visit failed — that's fine, continue
    }
  }

  console.log('[HumanBehavior] Warmup browse complete');
}

// ── Natural Exit ────────────────────────────────────────────────────────────

/** After engaging, scroll back to feed to look natural */
async function naturalExit(page: Page): Promise<void> {
  console.log('[HumanBehavior] Natural exit...');
  await randomDelay(2000, 5000);

  // Scroll the current page a bit before leaving
  await humanScroll(page);
  await shortPause();

  // Navigate back to feed
  try {
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    // Brief scroll to make it look like we're checking feed
    await humanScroll(page, 2);
    await randomDelay(3000, 8000);
  } catch {
    // If navigation fails, just continue
  }

  console.log('[HumanBehavior] Natural exit complete');
}

// ── Random Skip ─────────────────────────────────────────────────────────────

/** 20% chance to skip an action — simulates realistic off-actions */
function shouldSkip(): boolean {
  return Math.random() < 0.20;
}

// ── Active Hours Check ──────────────────────────────────────────────────────

/**
 * Check if current time is within active hours (08:00-22:00 WIB / UTC+7).
 */
function isActiveHours(): boolean {
  const now = new Date();
  // Get WIB time (UTC+7)
  const wibOffset = 7 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const wibMinutes = (utcMinutes + wibOffset) % (24 * 60);
  const wibHour = Math.floor(wibMinutes / 60);
  return wibHour >= 8 && wibHour < 22;
}

/**
 * Get next active window start time (08:00 WIB next day if currently past 22:00).
 */
function getNextActiveWindow(): Date {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000; // 7 hours in ms

  // Calculate 08:00 WIB today
  const todayStart = new Date(now);
  todayStart.setUTCHours(1, 0, 0, 0); // 08:00 WIB = 01:00 UTC

  if (now < todayStart) {
    return todayStart;
  }

  // If past today's window, return tomorrow 08:00 WIB
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  return tomorrowStart;
}

/**
 * Wait until active hours if currently outside the window.
 * Returns immediately if within active hours.
 */
async function waitForActiveHours(): Promise<void> {
  if (isActiveHours()) return;

  const nextWindow = getNextActiveWindow();
  const waitMs = nextWindow.getTime() - Date.now();
  console.log(`[HumanBehavior] Outside active hours. Waiting ${Math.round(waitMs / 60000)} minutes until 08:00 WIB`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

// ── Stagger Delay Calculator ────────────────────────────────────────────────

/**
 * Calculate staggered delays for multiple accounts.
 * Returns array of delay-in-ms values, one per account.
 * Ensures no two accounts act in the same minute.
 */
function calculateStaggerDelays(
  accountCount: number,
  minDelayMin: number = 15,
  maxDelayMin: number = 45,
): number[] {
  const delays: number[] = [0]; // First account starts immediately
  let cumulative = 0;

  for (let i = 1; i < accountCount; i++) {
    const gapMin = Math.floor(Math.random() * (maxDelayMin - minDelayMin + 1)) + minDelayMin;
    cumulative += gapMin * 60 * 1000;
    delays.push(cumulative);
  }

  return delays;
}

// ── Export all as a single namespace ─────────────────────────────────────────

export const HumanBehavior = {
  // Timing
  randomDelay,
  shortPause,
  mediumPause,
  longPause,
  thinkingPause,
  preEngagePause,

  // Actions
  humanType,
  humanScroll,
  simulateReading,
  warmupBrowse,
  naturalExit,

  // Decision helpers
  shouldSkip,
  isActiveHours,
  getNextActiveWindow,
  waitForActiveHours,
  calculateStaggerDelays,
};
