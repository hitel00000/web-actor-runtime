import http from 'node:http';
import { ChatGPTAdapter, GeminiAdapter } from './llm-adapters.js';
import { PersistentBrowserRuntime } from './persistent-browser.js';

export async function startOpenAILayer(port = 3001) {

  const browser = new PersistentBrowserRuntime({ headless: true });
  await browser.start();

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    // /v1/models
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-4', object: 'model', created: 0 }, { id: 'gemini-1.5', object: 'model', created: 0 }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    const adapter = (data.model ?? '').toLowerCase().includes('gemini') ? new GeminiAdapter() : new ChatGPTAdapter();
    const text = data.messages?.map((m: any) => `${m.role}:${m.content}`).join('\n') ?? '';

    const page = await browser.page('openai-default');
    try {
      await adapter.open(page);
      await adapter.send(page, text);
      const response = await adapter.waitForResponse(page);
      res.end(JSON.stringify({
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: data.model ?? 'free-browser',
        choices: [{ message: { role: 'assistant', content: response }, finish_reason: 'stop', index: 0 }],
      }));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });

  server.listen(port, () => console.log(`[OpenAILayer] Listening on http://localhost:${port}`));
  return server;
}

startOpenAILayer();
