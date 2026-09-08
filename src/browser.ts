import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export class BrowserRuntime {
  private browser?: Browser;
  private contexts = new Map<string, BrowserContext>();

  async start(headless = true): Promise<void> {
    this.browser = await chromium.launch({ headless });
  }

  async context(profile: string): Promise<BrowserContext> {
    if (!this.browser) throw new Error('BrowserRuntime is not started');
    const existing = this.contexts.get(profile);
    if (existing) return existing;
    const context = await this.browser.newContext();
    this.contexts.set(profile, context);
    return context;
  }

  async page(profile: string): Promise<Page> {
    const context = await this.context(profile);
    return context.newPage();
  }

  releasePage(_page?: Page): void {
    // no-op for ephemeral browser runtime
  }

  async stop(): Promise<void> {
    for (const context of this.contexts.values()) await context.close();
    await this.browser?.close();
  }
}
