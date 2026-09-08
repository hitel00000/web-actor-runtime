import type { Page } from 'playwright';
import type { WebAdapter } from './adapter.js';

export interface LLMAdapterOptions {
  timeoutMs?: number;
  stabilityWaitMs?: number;
}

/**
 * Universal helper that waits for an LLM streaming response to complete.
 * Watches for text growth and detects when output has stabilized for a given duration,
 * or when a completion indicator (like a Copy button) appears.
 */
async function waitForStreamingContent(
  page: Page,
  selectors: {
    container: string;
    stopButton?: string;
    copyButton?: string;
    errorSelector?: string;
  },
  timeoutMs = 90000,
  stabilityWaitMs = 2500
): Promise<string> {
  const startTime = Date.now();
  let lastText = '';
  let lastChangeTime = Date.now();

  // First wait for the response container to appear
  await page.locator(selectors.container).last().waitFor({ state: 'attached', timeout: 30000 });

  while (Date.now() - startTime < timeoutMs) {
    // Check for error banner or rate limits
    if (selectors.errorSelector) {
      const errorEl = page.locator(selectors.errorSelector).first();
      if ((await errorEl.count()) > 0 && (await errorEl.isVisible())) {
        const errText = await errorEl.textContent();
        throw new Error(`[LLM Web UI Error / Rate Limit]: ${errText?.trim()}`);
      }
    }

    // Check if copy button is already visible and stop button is gone
    if (selectors.stopButton && selectors.copyButton) {
      const stopVisible = await page.locator(selectors.stopButton).isVisible().catch(() => false);
      const copyVisible = await page.locator(selectors.copyButton).last().isVisible().catch(() => false);
      if (!stopVisible && copyVisible) {
        const finalText = await page.locator(selectors.container).last().innerText();
        if (finalText.trim().length > 0) {
          return finalText.trim();
        }
      }
    }

    // Measure text stability
    const currentLocator = page.locator(selectors.container).last();
    const currentText = (await currentLocator.innerText().catch(() => '')).trim();

    if (currentText.length > 0 && currentText !== lastText) {
      lastText = currentText;
      lastChangeTime = Date.now();
    } else if (currentText.length > 0 && Date.now() - lastChangeTime >= stabilityWaitMs) {
      // Content has stabilized for stabilityWaitMs
      return currentText;
    }

    await page.waitForTimeout(400);
  }

  if (lastText.length > 0) {
    return lastText;
  }
  throw new Error(`Timed out waiting for streaming response after ${timeoutMs}ms`);
}

// ============================================================================
// 1. ChatGPT Web Adapter
// ============================================================================
export class ChatGPTAdapter implements WebAdapter {
  constructor(private readonly options: LLMAdapterOptions = {}) {}

  async open(page: Page, url = 'https://chatgpt.com'): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Wait for the prompt input to be ready
    await page.waitForSelector('#prompt-textarea, [contenteditable="true"], textarea', {
      timeout: 30000,
    });
  }

  async send(page: Page, text: string): Promise<void> {
    const inputLocator = page.locator('#prompt-textarea, [contenteditable="true"], textarea').first();
    await inputLocator.click();
    await inputLocator.fill(text);

    // Click send or press Enter
    const sendButton = page.locator('button[data-testid="send-button"], button[aria-label*="Send"]').first();
    if ((await sendButton.count()) > 0 && (await sendButton.isEnabled())) {
      await sendButton.click();
    } else {
      await page.keyboard.press('Enter');
    }
  }

  async waitForResponse(page: Page): Promise<string> {
    return waitForStreamingContent(
      page,
      {
        container: '[data-message-author-role="assistant"], .agent-turn, .markdown, #response',
        stopButton: 'button[data-testid="stop-button"]',
        copyButton: 'button[data-testid="copy-turn-action-button"], .copy-button',
        errorSelector: '.text-red-500, [data-testid="error-banner"], .error-message',
      },
      this.options.timeoutMs ?? 90000,
      this.options.stabilityWaitMs ?? 2500
    );
  }
}

// ============================================================================
// 2. Gemini Web Adapter
// ============================================================================
export class GeminiAdapter implements WebAdapter {
  constructor(private readonly options: LLMAdapterOptions = {}) {}

  async open(page: Page, url = 'https://gemini.google.com/app'): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('div[role="textbox"], rich-textarea p, #prompt-textarea, textarea', {
      timeout: 30000,
    });
  }

  async send(page: Page, text: string): Promise<void> {
    const inputLocator = page.locator('div[role="textbox"], rich-textarea p, #prompt-textarea, textarea').first();
    await inputLocator.click();
    await inputLocator.fill(text);

    const sendBtn = page.locator('button[aria-label*="Send"], button[aria-label*="전송"], button.send-button').first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled())) {
      await sendBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
  }

  async waitForResponse(page: Page): Promise<string> {
    return waitForStreamingContent(
      page,
      {
        container: 'message-content, model-response, .model-response-text, #response',
        stopButton: 'button[aria-label*="Stop"], button[aria-label*="중지"]',
        copyButton: 'button[aria-label*="Copy"], button[aria-label*="복사"], .copy-button',
        errorSelector: '.error-container, .alert-box, .error-message',
      },
      this.options.timeoutMs ?? 90000,
      this.options.stabilityWaitMs ?? 2500
    );
  }
}

// ============================================================================
// 3. Claude Web Adapter
// ============================================================================
export class ClaudeAdapter implements WebAdapter {
  constructor(private readonly options: LLMAdapterOptions = {}) {}

  async open(page: Page, url = 'https://claude.ai/new'): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('div[contenteditable="true"], fieldset textarea, #prompt-textarea', {
      timeout: 30000,
    });
  }

  async send(page: Page, text: string): Promise<void> {
    const inputLocator = page.locator('div[contenteditable="true"], fieldset textarea, #prompt-textarea').first();
    await inputLocator.click();
    await inputLocator.fill(text);

    const sendBtn = page.locator('button[aria-label*="Send Message"], button[aria-label*="전송"], button[aria-label*="Send"]').first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled())) {
      await sendBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
  }

  async waitForResponse(page: Page): Promise<string> {
    return waitForStreamingContent(
      page,
      {
        container: 'div.font-claude-message, [data-is-streaming="false"], .standard-markdown, #response',
        stopButton: 'button[aria-label*="Stop generating"], button[aria-label*="중단"]',
        copyButton: 'button[aria-label*="Copy to clipboard"], .copy-button',
        errorSelector: '.text-danger, .error-banner, .error-message',
      },
      this.options.timeoutMs ?? 90000,
      this.options.stabilityWaitMs ?? 2500
    );
  }
}
