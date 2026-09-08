import assert from 'node:assert/strict';
import { PersistentBrowserRuntime } from '../src/persistent-browser.js';

async function testConcurrency() {
  console.log('Testing PersistentBrowserRuntime Concurrency & Mutex...');

  const runtime = new PersistentBrowserRuntime({ headless: true });

  try {
    // Test 1: Simultaneous requests to the SAME profile
    console.log('1. Testing simultaneous launch on SAME profile...');
    const [ctx1, ctx2] = await Promise.all([
      runtime.context('test-concurrent-same'),
      runtime.context('test-concurrent-same'),
    ]);

    assert.strictEqual(ctx1, ctx2, 'Simultaneous calls for same profile must return identical BrowserContext');
    console.log('   -> Passed: Same profile deduplication verified.');

    // Test 2: Simultaneous requests to DIFFERENT profiles
    console.log('2. Testing simultaneous launch on DIFFERENT profiles...');
    const [ctxA, ctxB] = await Promise.all([
      runtime.context('test-concurrent-a'),
      runtime.context('test-concurrent-b'),
    ]);

    assert.notStrictEqual(ctxA, ctxB, 'Different profiles must have separate contexts');
    console.log('   -> Passed: Cross-profile serialization verified.');

    // Test 3: Multiple pages and releasePage
    console.log('3. Testing multi-page allocation and release...');
    const page1 = await runtime.page('test-concurrent-same');
    const page2 = await runtime.page('test-concurrent-same');
    assert.notStrictEqual(page1, page2, 'Consecutive busy page requests must allocate separate pages');

    runtime.releasePage(page1);
    const page3 = await runtime.page('test-concurrent-same');
    assert.strictEqual(page3, page1, 'Released page must be reused before allocating new page');
    runtime.releasePage(page2);
    runtime.releasePage(page3);
    console.log('   -> Passed: Page pooling and release verified.');

  } finally {
    console.log('4. Stopping persistent browser runtime...');
    await runtime.stop();
    console.log('   -> Stopped cleanly.');
  }

  console.log('\nALL PERSISTENT CONCURRENCY TESTS PASSED!\n');
}

testConcurrency().catch((err) => {
  console.error('CONCURRENCY TEST FAILED:', err);
  process.exit(1);
});
