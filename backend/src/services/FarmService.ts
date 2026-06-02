import { Socket } from 'socket.io';
import { browserManager } from './BrowserManager';
import { PrismaClient } from '@prisma/client';
import { sessionPool } from './SessionPool';

const prisma = new PrismaClient();
const DEFAULT_SCREENSHOT_INTERVAL_MS = 10000;
const CONTROL_SCREENSHOT_INTERVAL_MS = 2000;
const MAX_SCREENSHOT_STREAMS = Number(process.env.FARM_MAX_SCREENSHOT_STREAMS || 12);

export class FarmService {
  private activeStreams: Map<string, Socket> = new Map(); // socketId → socket
  private visibleAccountsBySocket: Map<string, Set<string>> = new Map();
  private controlModeAccount: string | null = null;
  private interval: NodeJS.Timeout | null = null;
  private primarySocket: Socket | null = null;
  private initializedAccounts: Set<string> = new Set(); // tracks accounts that already have context+page
  private monitoringContextAccountIds: Set<string> = new Set(); // contexts opened by Farm View monitoring

  public startStreaming(socket: Socket) {
    this.activeStreams.set(socket.id, socket);
    this.visibleAccountsBySocket.set(socket.id, new Set());
    this.primarySocket = socket;
    console.log(`Farm stream started for ${socket.id}`);

    if (!this.interval) {
      this.interval = setInterval(() => this.broadcastScreenshots(), DEFAULT_SCREENSHOT_INTERVAL_MS);
    }
  }

  public stopStreaming(socket: Socket) {
    this.activeStreams.delete(socket.id);
    this.visibleAccountsBySocket.delete(socket.id);

    if (this.activeStreams.size === 0) {
      if (this.interval) { clearInterval(this.interval); this.interval = null; }
      this.primarySocket = null;
      this.initializedAccounts.clear();
      this.controlModeAccount = null;
      void this.closeUnusedMonitoringContexts('farm stream stopped');
      console.log('Farm stream stopped — no active clients');
    } else {
      // Hand off primary to another connected socket
      this.primarySocket = [...this.activeStreams.values()][0];
      void this.closeUnusedMonitoringContexts('farm stream client left');
    }
  }

  public async setControlMode(accountId: string | null, socket: Socket) {
    this.controlModeAccount = accountId;
    if (this.interval) clearInterval(this.interval);

    const intervalMs = accountId ? CONTROL_SCREENSHOT_INTERVAL_MS : DEFAULT_SCREENSHOT_INTERVAL_MS;
    this.primarySocket = socket;
    this.interval = setInterval(() => this.broadcastScreenshots(), intervalMs);
    console.log(`Farm interval → ${intervalMs}ms. Control mode: ${accountId ?? 'off'}`);
  }

  public updateVisibleAccounts(socket: Socket, accountIds: string[]) {
    if (!this.activeStreams.has(socket.id)) return;

    const uniqueIds = [...new Set(accountIds.filter(Boolean))].slice(0, MAX_SCREENSHOT_STREAMS);
    this.visibleAccountsBySocket.set(socket.id, new Set(uniqueIds));
    console.log(
      `[FarmService] ${socket.id} visible accounts: ${uniqueIds.length}/${MAX_SCREENSHOT_STREAMS}. ` +
      `Screenshot streams: ${this.getScreenshotStreamCount()}`
    );
    void this.closeUnusedMonitoringContexts('visible accounts updated');
  }

  private async broadcastScreenshots() {
    if (this.activeStreams.size === 0) return;

    const targetIds = this.getTargetAccountIds();
    if (targetIds.length === 0) return;

    const accounts = await prisma.socialAccount.findMany({
      where: { id: { in: targetIds } },
    });

    const metrics = browserManager.getMetrics();
    console.log(
      `[FarmService] Metrics: contexts=${metrics.activeContexts}, pages=${metrics.activePages}, ` +
      `screenshotStreams=${targetIds.length}/${MAX_SCREENSHOT_STREAMS}`
    );

    for (const account of accounts) {
      try {
        const isControlMode = this.controlModeAccount === account.id;
        const options: any = isControlMode
          ? { type: 'jpeg', quality: 80 }
          : { type: 'jpeg', quality: 40 };

        // First encounter: create context + page for this monitored account
        if (!this.initializedAccounts.has(account.id)) {
          const hadContext = browserManager.hasContext(account.id);
          const context = await browserManager.getContext(account.id);
          const existingPages = context.pages();
          if (existingPages.length === 0) {
            const page = await context.newPage();
            const target = account.platform === 'Instagram'
              ? 'https://www.instagram.com'
              : 'https://www.tiktok.com';
            await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => {});
          }
          if (!hadContext) {
            this.monitoringContextAccountIds.add(account.id);
          }
          this.initializedAccounts.add(account.id);
        }

        // If context no longer exists (operator closed browser), mark disconnected
        if (!browserManager.hasContext(account.id)) {
          this.initializedAccounts.delete(account.id);
          this.emitDisconnected(account);
          continue;
        }

        const context = await browserManager.getContext(account.id);
        const pages = context.pages();

        // If page was closed by operator, mark disconnected — do NOT reopen
        if (pages.length === 0) {
          this.emitDisconnected(account);
          continue;
        }

        const page = pages[0];

        if (page.url() === 'about:blank') {
          const target = account.platform === 'Instagram'
            ? 'https://www.instagram.com'
            : 'https://www.tiktok.com';
          await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }

        const buffer = await page.screenshot(options);
        const base64Str = buffer.toString('base64');

        const payload = {
          accountId: account.id,
          username: account.username,
          platform: account.platform,
          status: account.status,
          warmingDay: account.warmingDay ?? 0,
          image: `data:image/jpeg;base64,${base64Str}`,
        };

        // Broadcast to ALL connected clients
        for (const [, sock] of this.activeStreams) {
          sock.emit('farm_screenshot', payload);
        }
      } catch (err) {
        console.error(`Screenshot failed for ${account.username}`);
        this.emitDisconnected(account);
      }
    }
  }

  private emitDisconnected(account: { id: string; username: string; platform: string; warmingDay: number | null }) {
    const payload = {
      accountId: account.id,
      username: account.username,
      platform: account.platform,
      status: 'disconnected',
      warmingDay: account.warmingDay ?? 0,
      image: null,
    };
    for (const [, sock] of this.activeStreams) {
      sock.emit('farm_screenshot', payload);
    }
  }

  public async handleControl(data: any) {
    const { accountId, action, params } = data;
    try {
      const context = await browserManager.getContext(accountId);

      // Save cookies doesn't need an active page
      if (action === 'save_cookies') {
        await browserManager.saveCookies(accountId);
        console.log(`[FarmService] Cookies saved for ${accountId} via remote control request.`);
        return;
      }

      const pages = context.pages();
      if (pages.length === 0) return;
      const page = pages[0];

      switch (action) {
        case 'click': {
          const size = page.viewportSize();
          if (size) {
            const x = (params.x / 100) * size.width;
            const y = (params.y / 100) * size.height;
            await page.mouse.click(x, y);
          }
          break;
        }

        case 'mouse_down': {
          const size = page.viewportSize();
          if (size) {
            const x = (params.x / 100) * size.width;
            const y = (params.y / 100) * size.height;
            await page.mouse.move(x, y);
            await page.mouse.down({ button: 'left' });
          }
          break;
        }

        case 'mouse_move': {
          const size = page.viewportSize();
          if (size) {
            const x = (params.x / 100) * size.width;
            const y = (params.y / 100) * size.height;
            await page.mouse.move(x, y, { steps: 3 });
          }
          break;
        }

        case 'mouse_up': {
          const size = page.viewportSize();
          if (size) {
            const x = (params.x / 100) * size.width;
            const y = (params.y / 100) * size.height;
            await page.mouse.move(x, y);
            await page.mouse.up({ button: 'left' });
          }
          break;
        }

        case 'drag': {
          const size = page.viewportSize();
          if (size) {
            const startX = (params.startX / 100) * size.width;
            const startY = (params.startY / 100) * size.height;
            const endX = (params.endX / 100) * size.width;
            const endY = (params.endY / 100) * size.height;
            await page.mouse.move(startX, startY);
            await page.mouse.down({ button: 'left' });
            await page.mouse.move(endX, endY, { steps: 35 });
            await page.waitForTimeout(150);
            await page.mouse.up({ button: 'left' });
          }
          break;
        }

        case 'type':
          await page.keyboard.type(params.text, { delay: 50 });
          break;

        case 'scroll':
          await page.mouse.wheel(0, params.deltaY ?? 500);
          break;

        case 'scroll_up':
          await page.mouse.wheel(0, -500);
          break;

        case 'scroll_down':
          await page.mouse.wheel(0, 500);
          break;

        case 'go_back':
          await page.goBack().catch(() => {});
          break;

        case 'reload':
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          break;

        case 'key':
          await page.keyboard.press(params.key ?? 'Enter');
          break;
      }
    } catch (err) {
      console.error(`Control action "${action}" failed for ${accountId}:`, err);
    }
  }

  public getScreenshotStreamCount(): number {
    return this.getTargetAccountIds().length;
  }

  private async closeUnusedMonitoringContexts(reason: string): Promise<void> {
    const targetIds = new Set(this.getTargetAccountIds());
    const trackedAccountIds = [...this.monitoringContextAccountIds];

    for (const accountId of trackedAccountIds) {
      if (targetIds.has(accountId)) continue;
      if (this.controlModeAccount === accountId) continue;

      if (sessionPool.hasSession(accountId)) {
        console.log(`[FarmService] Keeping monitoring context for ${accountId}; session pool is using it.`);
        continue;
      }

      const pageCount = browserManager.getContextPageCount(accountId);
      if (pageCount !== null && pageCount > 1) {
        console.log(`[FarmService] Keeping monitoring context for ${accountId}; ${pageCount} pages are open.`);
        continue;
      }

      this.monitoringContextAccountIds.delete(accountId);
      this.initializedAccounts.delete(accountId);
      await browserManager.closeContext(accountId, { saveCookies: false });
      console.log(`[FarmService] Closed Farm View monitoring context for ${accountId} (${reason}).`);
    }
  }

  private getTargetAccountIds(): string[] {
    const ordered = new Set<string>();
    if (this.controlModeAccount) ordered.add(this.controlModeAccount);

    for (const ids of this.visibleAccountsBySocket.values()) {
      for (const id of ids) {
        ordered.add(id);
        if (ordered.size >= MAX_SCREENSHOT_STREAMS) {
          return [...ordered];
        }
      }
    }

    return [...ordered];
  }
}

export const farmService = new FarmService();
