import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

export interface PersistentBrowserOptions {
  profilesDir?: string;
  headless?: boolean;
  useChromeChannel?: boolean;
}

export class PersistentBrowserRuntime {
  private profilesDir: string;
  private headless: boolean;
  private useChromeChannel: boolean;
  private contexts = new Map<string, BrowserContext>();

  constructor(options: PersistentBrowserOptions = {}) {
    this.profilesDir = options.profilesDir ?? path.resolve(process.cwd(), '.profiles');
    this.headless = options.headless ?? false; // default to visible so user can see/interact
    this.useChromeChannel = options.useChromeChannel ?? false;

    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
    }
  }

  async start(): Promise<void> {
    // Persistent contexts are launched on demand per profile
  }

  async context(profileName: string): Promise<BrowserContext> {
    const existing = this.contexts.get(profileName);
    if (existing) {
      return existing;
    }

    const profilePath = path.join(this.profilesDir, profileName);
    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }

    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-default-browser-check',
      '--no-first-run',
    ];

    const contextOptions: any = {
      headless: this.headless,
      viewport: { width: 1280, height: 800 },
      args: launchArgs,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    };

    if (this.useChromeChannel) {
      contextOptions.channel = 'chrome';
    }

    const context = await chromium.launchPersistentContext(profilePath, contextOptions);
    this.contexts.set(profileName, context);
    return context;
  }

  async page(profileName: string): Promise<Page> {
    const ctx = await this.context(profileName);
    const pages = ctx.pages();
    if (pages.length > 0 && !pages[0].isClosed()) {
      return pages[0];
    }
    return ctx.newPage();
  }

  async stop(): Promise<void> {
    for (const [name, context] of this.contexts.entries()) {
      try {
        await context.close();
      } catch (err) {
        console.error(`[PersistentBrowser] Error closing context for ${name}:`, err);
      }
    }
    this.contexts.clear();
  }
}
