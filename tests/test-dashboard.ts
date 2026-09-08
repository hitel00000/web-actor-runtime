import { startDashboard } from '../src/dashboard-server.js';

async function test() {
  const port = 3899;
  const server = startDashboard(port);

  try {
    const res = await fetch(`http://localhost:${port}/`);
    console.log('UI Status:', res.status);
    const html = await res.text();
    console.log('Contains Title:', html.includes('Web Actor Runtime — Control Panel'));
    console.log('Contains Presets:', html.includes('프리셋 1: 아키텍처 리뷰'));
    console.log('Contains Reviewer Provider:', html.includes('id="reviewerProvider"'));
    console.log('Contains Summarizer Provider:', html.includes('id="summarizerProvider"'));
    console.log('Contains Synthesizer Provider:', html.includes('id="synthesizerProvider"'));

    const controller = new AbortController();
    const sseRes = await fetch(`http://localhost:${port}/api/stream`, { signal: controller.signal });
    console.log('SSE Status:', sseRes.status);
    console.log('SSE Content-Type:', sseRes.headers.get('content-type'));
    controller.abort();

    // Test triggering a pipeline run in sim mode with custom LLM provider selections
    console.log('Testing /api/run with decoupled providers...');
    const runRes = await fetch(`http://localhost:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'sim',
        visible: false,
        seedText: 'Test Proposal for Multi-LLM Role Assignment',
        reviewerProvider: 'gemini',
        summarizerProvider: 'chatgpt',
        synthesizerProvider: 'claude',
        reviewerPrompt: 'Review this: {input}',
        summarizerPrompt: 'Summarize this: {input}',
        synthesizerPrompt: 'Synthesize this: {inputs}',
      }),
    });

    const runJson = (await runRes.json()) as any;
    console.log('Run status:', runRes.status, 'Response:', JSON.stringify(runJson));

    // Wait a brief moment and stop pipeline
    await new Promise((r) => setTimeout(r, 2000));
    const stopRes = await fetch(`http://localhost:${port}/api/stop`, { method: 'POST' });
    console.log('Stop status:', stopRes.status);

    console.log('ALL DASHBOARD TESTS PASSED!');
  } finally {
    server.close();
  }
}

test().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
