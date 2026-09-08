import readline from 'node:readline';
import { PersistentBrowserRuntime } from './persistent-browser.js';

const SERVICE_URLS: Record<string, string> = {
  gemini: 'https://gemini.google.com/app',
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai/new',
};

async function main() {
  const target = process.argv[2]?.toLowerCase() ?? 'all';
  console.log('=============================================================');
  console.log('  Web Actor Runtime — Persistent Profile Login Setup');
  console.log('=============================================================');
  console.log(`Target: ${target}`);
  console.log('This will launch a visible browser window using persistent profiles.');
  console.log('Please log in to your Free-Tier account(s).\n');

  const runtime = new PersistentBrowserRuntime({ headless: false });

  const targetsToOpen = target === 'all' ? Object.keys(SERVICE_URLS) : [target];

  for (const name of targetsToOpen) {
    const url = SERVICE_URLS[name];
    if (!url) {
      console.error(`Unknown service: ${name}. Available: ${Object.keys(SERVICE_URLS).join(', ')}`);
      continue;
    }

    console.log(`[Setup] Opening profile window for '${name}' (${url})...`);
    const page = await runtime.page(name);
    await page.goto(url).catch((e) => console.log(`[Setup] Navigated to ${url}: ${e.message}`));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>((resolve) => {
    rl.question('\n>>> After completing your login(s) in the browser, press ENTER here to save and exit: ', () => {
      rl.close();
      resolve();
    });
  });

  console.log('\n[Setup] Saving profiles and closing browser...');
  await runtime.stop();
  console.log('[Setup] Session cookies and local storage saved in .profiles/ directory.');
  console.log('[Setup] You can now run the live orchestration demo!\n');
}

main().catch(console.error);
