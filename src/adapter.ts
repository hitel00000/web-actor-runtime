import type { Page } from 'playwright';

export interface WebAdapter {
  open(page: Page, url: string): Promise<void>;
  send(page: Page, text: string): Promise<void>;
  waitForResponse(page: Page, timeoutMs?: number): Promise<string>;
}

export class DemoChatAdapter implements WebAdapter {
  async open(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async send(page: Page, text: string): Promise<void> {
    await page.locator('#input').fill(text);
    await page.locator('#send').click();
  }

  async waitForResponse(page: Page, timeoutMs = 10000): Promise<string> {
    // Wait for #response to have non-empty text, or #status to reach 'done' | 'error'
    const statusLocator = page.locator('#status');
    const responseLocator = page.locator('#response');

    const hasStatus = await statusLocator.count() > 0;
    if (hasStatus) {
      await page.waitForFunction(
        () => {
          const s = document.querySelector('#status')?.textContent?.trim();
          return s === 'done' || s === 'error';
        },
        { timeout: timeoutMs }
      );

      const status = await statusLocator.textContent().then((t) => t?.trim());
      const responseText = await responseLocator.textContent().then((t) => t?.trim() ?? '');
      if (status === 'error') {
        throw new Error(`Web actor failed in browser UI: ${responseText}`);
      }
      return responseText;
    }

    // Fallback for legacy pages without #status
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#response');
        return el && (el.textContent?.trim().length ?? 0) > 0;
      },
      { timeout: timeoutMs }
    );
    return responseLocator.textContent().then((x) => x?.trim() ?? '');
  }
}

