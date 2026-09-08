import type { Page, Locator } from 'playwright';
import type { WebAdapter } from './adapter.js';

export interface LLMAdapterOptions {
  timeoutMs?: number;
  stabilityWaitMs?: number;
  debugScreenshotPath?: string;
}

/**
 * Robust text insertion for modern Rich Text Editors (ProseMirror, Lexical, Draft.js)
 * Used by ChatGPT, Claude, and Gemini web UIs.
 */
async function typeIntoRichEditor(page: Page, inputLocator: Locator, text: string): Promise<void> {
  await inputLocator.scrollIntoViewIfNeeded().catch(() => undefined);
  await inputLocator.click();

  // Select all existing text and delete it cleanly
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');

  // insertText dispatches native 'beforeinput' and 'input' events with the exact text,
  // which properly synchronizes React / ProseMirror internal state!
  await page.keyboard.insertText(text);

  // Short pause to allow state reconciliation
  await page.waitForTimeout(500);
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/^ChatGPT said:\s*/i, '')
    .replace(/\b(Copy response|Copy message|Share|Read aloud|Good response|Bad response)\b/gi, '')
    .trim();
}

/**
 * Universal helper that waits for an LLM streaming response to complete.
 * Watches for text growth and detects when output has stabilized for a given duration,
 * or when a completion indicator (like a Copy button) appears.
 */
async function waitForStreamingContent(
  page: Page,
  serviceName: string,
  selectors: {
    container: string;
    stopButton?: string;
    copyButton?: string;
    errorSelector?: string;
  },
  timeoutMs = 90000,
  stabilityWaitMs = 2500,
  debugScreenshotPath?: string
): Promise<string> {
  const startTime = Date.now();
  let lastText = '';
  let lastChangeTime = Date.now();
  let containerFound = false;

  // Poll with periodic selector checking
  while (Date.now() - startTime < timeoutMs) {
    // 1. Check for blocking modals or error banners (Cloudflare, Rate limits, Login prompts)
    const currentUrl = page.url();
    if (currentUrl.includes('/auth') || currentUrl.includes('/login')) {
      throw new Error(`[${serviceName}] Browser was redirected to login page: ${currentUrl}. Please run 'npm run setup:login' first.`);
    }

    if (selectors.errorSelector) {
      const errorEl = page.locator(selectors.errorSelector).first();
      if ((await errorEl.count()) > 0 && (await errorEl.isVisible().catch(() => false))) {
        const errText = await errorEl.textContent().catch(() => '');
        throw new Error(`[${serviceName} Error / Rate Limit]: ${errText?.trim()}`);
      }
    }

    // 2. Locate the response container
    const locator = page.locator(selectors.container);
    const count = await locator.count().catch(() => 0);

    if (count > 0) {
      containerFound = true;

      // Find the best non-empty container among matched candidates (searching backwards to skip empty wrapper tags)
      let currentLocator = locator.last();
      let rawText = (await currentLocator.innerText().catch(() => '')).trim();

      if (!rawText && count > 1) {
        for (let idx = count - 1; idx >= 0; idx--) {
          const candidate = locator.nth(idx);
          const candidateText = (await candidate.innerText().catch(() => '')).trim();
          if (candidateText.length > 0) {
            currentLocator = candidate;
            rawText = candidateText;
            break;
          }
        }
      }

      // Check if copy button is visible and stop button is gone
      if (selectors.stopButton && selectors.copyButton) {
        const stopVisible = await page.locator(selectors.stopButton).first().isVisible().catch(() => false);
        const copyVisible = await page.locator(selectors.copyButton).last().isVisible().catch(() => false);
        if (!stopVisible && copyVisible) {
          const cleaned = cleanExtractedText(rawText);
          if (cleaned.length > 0) {
            return cleaned;
          }
        }
      }

      // Check text content stabilization
      const currentText = cleanExtractedText(rawText);

      if (currentText.length > 0 && currentText !== lastText) {
        lastText = currentText;
        lastChangeTime = Date.now();
      } else if (currentText.length > 0 && Date.now() - lastChangeTime >= stabilityWaitMs) {
        // Output stabilized for stabilityWaitMs
        return currentText;
      }
    }

    await page.waitForTimeout(400);
  }

  // If timed out, capture screenshot for immediate visual diagnosis
  const dumpPath = debugScreenshotPath ?? `debug-${serviceName}-timeout.png`;
  await page.screenshot({ path: dumpPath, fullPage: true }).catch(() => undefined);
  const pageTitle = await page.title().catch(() => 'unknown');
  const pageUrl = page.url();

  if (lastText.length > 0) {
    return lastText;
  }

  throw new Error(
    `[${serviceName}] Timed out waiting for response after ${timeoutMs}ms. (Page: "${pageTitle}" at ${pageUrl}, Container found: ${containerFound}). Screenshot saved to ${dumpPath}`
  );
}

// ============================================================================
// 1. ChatGPT Web Adapter
// ============================================================================
export class ChatGPTAdapter implements WebAdapter {
  constructor(private readonly options: LLMAdapterOptions = {}) {}

  async open(page: Page, url = 'https://chatgpt.com'): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Dismiss common guest / consent dialogs if present
    const dismissBtn = page.locator('button:has-text("Stay logged out"), button:has-text("Dismiss"), button:has-text("Accept")').first();
    if ((await dismissBtn.count()) > 0 && (await dismissBtn.isVisible().catch(() => false))) {
      await dismissBtn.click().catch(() => undefined);
    }

    // Wait for the prompt input (supports new 2025/2026 textarea & legacy rich editor)
    await page.waitForSelector(
      '#mobile-composer-prompt, textarea[name="prompt"], #prompt-textarea, textarea[placeholder*="ChatGPT"], div[contenteditable="true"], textarea',
      { timeout: 30000 }
    );
  }

  async send(page: Page, text: string): Promise<void> {
    const inputLocator = page.locator(
      '#mobile-composer-prompt, textarea[name="prompt"], textarea[placeholder*="ChatGPT"], #prompt-textarea, div[contenteditable="true"], textarea'
    ).first();
    await inputLocator.waitFor({ state: 'visible', timeout: 20000 });

    const isTextarea = await inputLocator.evaluate((el) => el.tagName.toLowerCase() === 'textarea').catch(() => false);
    if (isTextarea) {
      await inputLocator.scrollIntoViewIfNeeded().catch(() => undefined);
      await inputLocator.click();
      await inputLocator.fill(text);
      await page.waitForTimeout(400);
    } else {
      await typeIntoRichEditor(page, inputLocator, text);
    }

    // Wait up to 3 seconds for the send button to become enabled
    const sendBtn = page.locator(
      'button[aria-label="Send message"], button.wm-composer-submitButton, button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="보내기"]'
    ).first();
    let sent = false;

    for (let i = 0; i < 6; i++) {
      if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled().catch(() => false))) {
        await sendBtn.click().catch(() => undefined);
        sent = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!sent) {
      // Fallback: press Enter directly in the editor
      await inputLocator.press('Enter');
    }

    // Wait briefly to confirm message was dispatched (stop button appeared or input cleared)
    await page.waitForTimeout(800);
  }

  async waitForResponse(page: Page): Promise<string> {
    return waitForStreamingContent(
      page,
      'ChatGPT',
      {
        // Resilient selectors covering new 2025/2026 UI and legacy DOM structures
        container: [
          '[data-assistant-markdown]',
          'li[data-message-role="assistant"] div[class*="messageCopy"]',
          'div[class*="_wdUoQG_messageCopy"]',
          'div[class*="assistantMessage"]',
          'li[data-message-role="assistant"]',
          '[data-message-author-role="assistant"] .markdown',
          '[data-message-author-role="assistant"]',
          'div.agent-turn .markdown',
          'div.agent-turn',
          'article[data-testid^="conversation-turn-"] .markdown',
          'article:has(button[data-testid*="copy"])',
          '#response',
        ].join(', '),
        stopButton: 'button[aria-label*="Stop"], button.wm-composer-stopButton, button[data-testid="stop-button"], button[aria-label*="중지"]',
        copyButton: 'button[aria-label="Copy response"], button[aria-label*="Copy response"], button[data-testid*="copy"], button[aria-label*="Copy"], button[aria-label*="복사"], .copy-button',
        errorSelector: '[data-testid="error-banner"], .text-red-500, .error-message',
      },
      this.options.timeoutMs ?? 90000,
      this.options.stabilityWaitMs ?? 2500,
      this.options.debugScreenshotPath
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
    await inputLocator.waitFor({ state: 'visible', timeout: 15000 });

    await typeIntoRichEditor(page, inputLocator, text);

    const sendBtn = page.locator('button[aria-label*="Send"], button[aria-label*="전송"], button.send-button').first();
    let sent = false;

    for (let i = 0; i < 6; i++) {
      if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled().catch(() => false))) {
        await sendBtn.click().catch(() => undefined);
        sent = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!sent) {
      await inputLocator.press('Enter');
    }

    await page.waitForTimeout(800);
  }

  async waitForResponse(page: Page): Promise<string> {
    return waitForStreamingContent(
      page,
      'Gemini',
      {
        container: [
          'message-content',
          'model-response',
          '.model-response-text',
          '.response-container-content',
          '#response',
        ].join(', '),
        stopButton: 'button[aria-label*="Stop"], button[aria-label*="중지"]',
        copyButton: 'button[aria-label*="Copy"], button[aria-label*="복사"], .copy-button',
        errorSelector: '.error-container, .alert-box, .error-message',
      },
      this.options.timeoutMs ?? 90000,
      this.options.stabilityWaitMs ?? 2500,
      this.options.debugScreenshotPath
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
    await inputLocator.waitFor({ state: 'visible', timeout: 15000 });

    await typeIntoRichEditor(page, inputLocator, text);

    const sendBtn = page.locator('button[aria-label*="Send Message"], button[aria-label*="전송"], button[aria-label*="Send"]').first();
    let sent = false;

    for (let i = 0; i < 6; i++) {
      if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled().catch(() => false))) {
        await sendBtn.click().catch(() => undefined);
        sent = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!sent) {
      await inputLocator.press('Enter');
    }

    await page.waitForTimeout(800);
  }

  async waitForResponse(page: Page): Promise<string> {
    return waitForStreamingContent(
      page,
      'Claude',
      {
        container: [
          'div.font-claude-message',
          '[data-is-streaming="false"]',
          '.standard-markdown',
          'div.font-user-message ~ div',
          '#response',
        ].join(', '),
        stopButton: 'button[aria-label*="Stop generating"], button[aria-label*="중단"]',
        copyButton: 'button[aria-label*="Copy to clipboard"], button[aria-label*="Copy"], .copy-button',
        errorSelector: '.text-danger, .error-banner, .error-message',
      },
      this.options.timeoutMs ?? 90000,
      this.options.stabilityWaitMs ?? 2500,
      this.options.debugScreenshotPath
    );
  }
}

