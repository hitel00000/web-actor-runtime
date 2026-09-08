import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export interface PersistentBrowserOptions {
  profilesDir?: string;
  headless?: boolean;
  useChromeChannel?: boolean;
}

/**
 * On Windows, terminate any orphaned chrome.exe processes associated with a profile directory.
 */
function cleanupOrphanedProcesses(profilePath: string): void {
  if (process.platform !== 'win32') return;
  try {
    const absPath = path.resolve(profilePath);
    const escaped = absPath.replace(/'/g, "''");
    // Terminate chrome processes whose CommandLine references this profile path
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch {
    // Best effort cleanup: ignore if powershell unavailable or timed out
  }
}

/**
 * Remove stale Chromium lockfiles that cause premature launch exit.
 */
function cleanupStaleLocks(profilePath: string): void {
  const lockNames = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'DevToolsActivePort',
    'lockfile',
  ];
  for (const name of lockNames) {
    try {
      const p = path.join(profilePath, name);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
      }
    } catch {
      // Ignore
    }
  }
}

export class PersistentBrowserRuntime {
  private profilesDir: string;
  private headless: boolean;
  private useChromeChannel: boolean;
  private contexts = new Map<string, BrowserContext>();
  private launchingContexts = new Map<string, Promise<BrowserContext>>();
  private busyPages = new Set<Page>();
  private launchLock: Promise<void> = Promise.resolve();
  private static registeredExitHooks = false;

  constructor(options: PersistentBrowserOptions = {}) {
    this.profilesDir = options.profilesDir ?? path.resolve(process.cwd(), '.profiles');
    this.headless = options.headless ?? false; // default to visible so user can see/interact
    this.useChromeChannel = options.useChromeChannel ?? false;

    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
    }

    this.registerGlobalExitHooks();
  }

  private registerGlobalExitHooks(): void {
    if (PersistentBrowserRuntime.registeredExitHooks) return;
    PersistentBrowserRuntime.registeredExitHooks = true;

    const cleanup = () => {
      for (const [name, ctx] of this.contexts.entries()) {
        try {
          ctx.close();
        } catch {
          // Ignore error during process termination
        }
      }
    };

    process.once('exit', cleanup);
    process.once('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.once('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    // Persistent contexts are launched on demand per profile
  }

  private isContextAlive(ctx: BrowserContext): boolean {
    try {
      ctx.pages();
      return true;
    } catch {
      return false;
    }
  }

  async context(profileName: string): Promise<BrowserContext> {
    // 1. Return already connected context if still alive
    const existing = this.contexts.get(profileName);
    if (existing) {
      if (this.isContextAlive(existing)) {
        return existing;
      }
      this.contexts.delete(profileName);
    }

    // 2. Deduplicate simultaneous launches for the SAME profile
    const inFlight = this.launchingContexts.get(profileName);
    if (inFlight) {
      return inFlight;
    }

    // 3. Serialize browser launches across DIFFERENT profiles to prevent Windows process spawn collisions
    const launchPromise = (async () => {
      const currentLock = this.launchLock;
      let releaseLock: () => void = () => {};
      this.launchLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      try {
        await currentLock;

        // Double-check if another caller resolved it while waiting for the lock
        const ready = this.contexts.get(profileName);
        if (ready && this.isContextAlive(ready)) {
          return ready;
        }

        return await this.launchWithRetry(profileName);
      } finally {
        releaseLock();
      }
    })();

    this.launchingContexts.set(profileName, launchPromise);

    try {
      const ctx = await launchPromise;
      this.contexts.set(profileName, ctx);
      return ctx;
    } finally {
      this.launchingContexts.delete(profileName);
    }
  }

  private async launchWithRetry(profileName: string): Promise<BrowserContext> {
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
      ignoreDefaultArgs: ['--enable-automation'],
      args: launchArgs,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    };

    if (this.useChromeChannel) {
      contextOptions.channel = 'chrome';
    }

    // First attempt: clean stale locks and orphaned processes, then launch
    cleanupOrphanedProcesses(profilePath);
    cleanupStaleLocks(profilePath);

    try {
      const context = await chromium.launchPersistentContext(profilePath, contextOptions);
      this.bindContextLifecycle(profileName, context);
      return context;
    } catch (err: any) {
      console.warn(
        `[PersistentBrowser] First launch attempt for '${profileName}' failed (${err.message}). Retrying after deep cleanup...`
      );

      // Second attempt: aggressive cleanup + short cooldown
      cleanupOrphanedProcesses(profilePath);
      cleanupStaleLocks(profilePath);
      await new Promise((r) => setTimeout(r, 1200));

      const context = await chromium.launchPersistentContext(profilePath, contextOptions);
      this.bindContextLifecycle(profileName, context);
      return context;
    }
  }

  private bindContextLifecycle(profileName: string, context: BrowserContext): void {
    context.once('close', () => {
      if (this.contexts.get(profileName) === context) {
        this.contexts.delete(profileName);
      }
    });
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
    this.busyPages.clear();
  }

  async page(profileName: string): Promise<Page> {
    const ctx = await this.context(profileName);
    const pages = ctx.pages();
    const available = pages.find((p) => !p.isClosed() && !this.busyPages.has(p));
    if (available) {
      this.busyPages.add(available);
      available.once('close', () => this.busyPages.delete(available));
      return available;
    }
    const newP = await ctx.newPage();
    this.busyPages.add(newP);
    newP.once('close', () => this.busyPages.delete(newP));
    return newP;
  }

  releasePage(page: Page): void {
    this.busyPages.delete(page);
  }
}
