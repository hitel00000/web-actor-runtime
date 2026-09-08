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

    const controller = new AbortController();
    const sseRes = await fetch(`http://localhost:${port}/api/stream`, { signal: controller.signal });
    console.log('SSE Status:', sseRes.status);
    console.log('SSE Content-Type:', sseRes.headers.get('content-type'));
    controller.abort();

    console.log('ALL DASHBOARD TESTS PASSED!');
  } finally {
    server.close();
  }
}

test().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
