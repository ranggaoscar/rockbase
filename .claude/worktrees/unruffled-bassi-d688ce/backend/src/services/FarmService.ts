import { Socket } from 'socket.io';
import { browserManager } from './BrowserManager';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class FarmService {
  private activeStreams: Map<string, Socket> = new Map(); // socketId → socket
  private controlModeAccount: string | null = null;
  private interval: NodeJS.Timeout | null = null;
  private primarySocket: Socket | null = null;

  public startStreaming(socket: Socket) {
    this.activeStreams.set(socket.id, socket);
    this.primarySocket = socket;
    console.log(`Farm stream started for ${socket.id}`);

    if (!this.interval) {
      this.interval = setInterval(() => this.broadcastScreenshots(), 5000);
    }
  }

  public stopStreaming(socket: Socket) {
    this.activeStreams.delete(socket.id);

    if (this.activeStreams.size === 0) {
      if (this.interval) { clearInterval(this.interval); this.interval = null; }
      this.primarySocket = null;
      console.log('Farm stream stopped — no active clients');
    } else {
      // Hand off primary to another connected socket
      this.primarySocket = [...this.activeStreams.values()][0];
    }
  }

  public async setControlMode(accountId: string | null, socket: Socket) {
    this.controlModeAccount = accountId;
    if (this.interval) clearInterval(this.interval);

    const intervalMs = accountId ? 1000 : 5000;
    this.primarySocket = socket;
    this.interval = setInterval(() => this.broadcastScreenshots(), intervalMs);
    console.log(`Farm interval → ${intervalMs}ms. Control mode: ${accountId ?? 'off'}`);
  }

  private async broadcastScreenshots() {
    if (this.activeStreams.size === 0) return;

    let accounts = await prisma.socialAccount.findMany({ take: 30 });

    for (const account of accounts) {
      try {
        const isControlMode = this.controlModeAccount === account.id;
        const options: any = isControlMode
          ? { type: 'jpeg', quality: 80 }
          : { type: 'jpeg', quality: 40 };

        const context = await browserManager.getContext(account.id);
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();

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
        const errorPayload = {
          accountId: account.id,
          username: account.username,
          platform: account.platform,
          status: 'error',
          warmingDay: account.warmingDay ?? 0,
          image: null,
        };
        for (const [, sock] of this.activeStreams) {
          sock.emit('farm_screenshot', errorPayload);
        }
      }
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
}

export const farmService = new FarmService();
