import { createServer, type Server } from 'node:http';

function renderActorPage(title: string, role: string, accentColor: string, description: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; max-width: 800px; }
    h1 { color: ${accentColor}; margin-bottom: 0.5rem; }
    .desc { color: #555; margin-bottom: 1.5rem; }
    textarea { width: 100%; height: 120px; box-sizing: border-box; padding: 0.5rem; font-family: monospace; border: 1px solid #ccc; border-radius: 4px; }
    button { margin-top: 0.5rem; padding: 0.5rem 1.2rem; background: ${accentColor}; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    #status { display: inline-block; margin-left: 1rem; font-weight: bold; text-transform: uppercase; font-size: 0.85rem; }
    #status.idle { color: #888; }
    #status.processing { color: #f59e0b; }
    #status.done { color: #10b981; }
    #status.error { color: #ef4444; }
    pre { margin-top: 1.5rem; padding: 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; white-space: pre-wrap; word-break: break-word; font-family: monospace; min-height: 50px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="desc">${description}</div>
  <textarea id="input" placeholder="Input artifact content will be received here..."></textarea>
  <div>
    <button id="send">Process Artifact</button>
    <span id="status" class="idle">idle</span>
  </div>
  <pre id="response"></pre>

  <script>
    const input = document.querySelector('#input');
    const sendBtn = document.querySelector('#send');
    const statusEl = document.querySelector('#status');
    const responseEl = document.querySelector('#response');

    sendBtn.onclick = async () => {
      sendBtn.disabled = true;
      statusEl.className = 'processing';
      statusEl.textContent = 'processing';
      responseEl.textContent = '';

      try {
        const res = await fetch('/api/process?role=${role}', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: input.value
        });
        const text = await res.text();
        if (!res.ok) {
          statusEl.className = 'error';
          statusEl.textContent = 'error';
          responseEl.textContent = text;
        } else {
          statusEl.className = 'done';
          statusEl.textContent = 'done';
          responseEl.textContent = text;
        }
      } catch (err) {
        statusEl.className = 'error';
        statusEl.textContent = 'error';
        responseEl.textContent = err.message;
      } finally {
        sendBtn.disabled = false;
      }
    };
  </script>
</body>
</html>`;
}

export function startDemoServer(port = 4173): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    // Role-specific Web Actor Pages
    if (url.pathname === '/reviewer') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        renderActorPage(
          'Architectural Reviewer',
          'reviewer',
          '#2563eb',
          'Analyzes input artifacts for architectural soundness, modularity, and trade-offs.'
        )
      );
      return;
    }

    if (url.pathname === '/summarizer') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        renderActorPage(
          'Executive Summarizer',
          'summarizer',
          '#059669',
          'Condenses key concepts and findings into concise executive summaries.'
        )
      );
      return;
    }

    if (url.pathname === '/critic') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        renderActorPage(
          'Critical Evaluator',
          'critic',
          '#d97706',
          'Examines underlying assumptions, edge cases, failure modes, and potential bottlenecks.'
        )
      );
      return;
    }

    if (url.pathname === '/refiner') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        renderActorPage(
          'Artifact Refiner',
          'refiner',
          '#7c3aed',
          'Aggregates reviews, summaries, and critiques to produce the refined final synthesis.'
        )
      );
      return;
    }

    // =========================================================================
    // Simulated Web LLM Endpoints (ChatGPT, Gemini, Claude)
    // =========================================================================
    if (url.pathname === '/sim/chatgpt') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>ChatGPT Simulation</title>
<style>
body{font-family:sans-serif;margin:2rem;background:#202123;color:#ececf1;max-width:800px;}
textarea{width:100%;height:100px;background:#40414f;color:#fff;border:1px solid #565869;border-radius:6px;padding:0.5rem;}
button{padding:0.5rem 1rem;background:#10a37f;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-top:0.5rem;}
.markdown{margin-top:1.5rem;padding:1rem;background:#343541;border-radius:6px;white-space:pre-wrap;min-height:50px;}
</style></head>
<body>
<h1>ChatGPT Free Web UI (Simulation)</h1>
<textarea id="prompt-textarea" placeholder="Message ChatGPT..."></textarea>
<div>
  <button data-testid="send-button">Send</button>
  <button data-testid="stop-button" style="display:none;background:#ef4444;">Stop generating</button>
  <button data-testid="copy-turn-action-button" style="display:none;background:#6b7280;">Copy</button>
</div>
<article data-testid="conversation-turn-3">
  <div data-message-author-role="assistant">
    <div class="markdown" id="response"></div>
  </div>
</article>
<script>
const input = document.querySelector('#prompt-textarea');
const sendBtn = document.querySelector('button[data-testid="send-button"]');
const stopBtn = document.querySelector('button[data-testid="stop-button"]');
const copyBtn = document.querySelector('button[data-testid="copy-turn-action-button"]');
const responseEl = document.querySelector('#response');

sendBtn.onclick = async () => {
  sendBtn.disabled = true;
  stopBtn.style.display = 'inline-block';
  copyBtn.style.display = 'none';
  responseEl.textContent = '';
  
  const text = input.value;
  const res = await fetch('/api/process?role=reviewer', { method: 'POST', body: text });
  const fullResponse = await res.text();
  
  // Typewriter streaming effect
  const words = fullResponse.split(' ');
  for (let i = 0; i < words.length; i++) {
    responseEl.textContent += (i === 0 ? '' : ' ') + words[i];
    await new Promise(r => setTimeout(r, 20));
  }
  
  stopBtn.style.display = 'none';
  copyBtn.style.display = 'inline-block';
  sendBtn.disabled = false;
};
</script></body></html>`);
      return;
    }

    if (url.pathname === '/sim/gemini') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Gemini Simulation</title>
<style>
body{font-family:sans-serif;margin:2rem;background:#131314;color:#e3e3e3;max-width:800px;}
div[role="textbox"]{width:100%;height:100px;background:#1e1f20;color:#fff;border:1px solid #444746;border-radius:6px;padding:0.5rem;box-sizing:border-box;}
button{padding:0.5rem 1rem;background:#1a73e8;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-top:0.5rem;}
message-content{display:block;margin-top:1.5rem;padding:1rem;background:#1e1f20;border-radius:6px;white-space:pre-wrap;min-height:50px;}
</style></head>
<body>
<h1>Gemini Free Web UI (Simulation)</h1>
<div role="textbox" contenteditable="true" placeholder="Ask Gemini..."></div>
<div>
  <button aria-label="Send message" class="send-button">Send</button>
  <button aria-label="Stop" style="display:none;background:#ea4335;">Stop</button>
  <button aria-label="Copy" style="display:none;background:#5f6368;">Copy</button>
</div>
<model-response>
  <message-content id="response"></message-content>
</model-response>
<script>
const input = document.querySelector('div[role="textbox"]');
const sendBtn = document.querySelector('button[aria-label="Send message"]');
const stopBtn = document.querySelector('button[aria-label="Stop"]');
const copyBtn = document.querySelector('button[aria-label="Copy"]');
const responseEl = document.querySelector('#response');

sendBtn.onclick = async () => {
  sendBtn.disabled = true;
  stopBtn.style.display = 'inline-block';
  copyBtn.style.display = 'none';
  responseEl.textContent = '';
  
  const text = input.innerText;
  const res = await fetch('/api/process?role=summarizer', { method: 'POST', body: text });
  const fullResponse = await res.text();
  
  // Streaming simulation
  const words = fullResponse.split(' ');
  for (let i = 0; i < words.length; i++) {
    responseEl.textContent += (i === 0 ? '' : ' ') + words[i];
    await new Promise(r => setTimeout(r, 20));
  }
  
  stopBtn.style.display = 'none';
  copyBtn.style.display = 'inline-block';
  sendBtn.disabled = false;
};
</script></body></html>`);
      return;
    }

    if (url.pathname === '/sim/claude') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Claude Simulation</title>
<style>
body{font-family:sans-serif;margin:2rem;background:#fbfbfb;color:#333;max-width:800px;}
div[contenteditable="true"]{width:100%;height:100px;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:0.5rem;box-sizing:border-box;}
button{padding:0.5rem 1rem;background:#d97706;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-top:0.5rem;}
.font-claude-message{margin-top:1.5rem;padding:1rem;background:#fff;border:1px solid #e5e7eb;border-radius:6px;white-space:pre-wrap;min-height:50px;}
</style></head>
<body>
<h1>Claude Free Web UI (Simulation)</h1>
<div contenteditable="true" class="ProseMirror" placeholder="Talk to Claude..."></div>
<div>
  <button aria-label="Send Message">Send</button>
  <button aria-label="Stop generating" style="display:none;background:#ef4444;">Stop</button>
  <button aria-label="Copy to clipboard" style="display:none;background:#9ca3af;">Copy</button>
</div>
<div class="font-claude-message" id="response"></div>
<script>
const input = document.querySelector('div[contenteditable="true"]');
const sendBtn = document.querySelector('button[aria-label="Send Message"]');
const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
const copyBtn = document.querySelector('button[aria-label="Copy to clipboard"]');
const responseEl = document.querySelector('#response');

sendBtn.onclick = async () => {
  sendBtn.disabled = true;
  stopBtn.style.display = 'inline-block';
  copyBtn.style.display = 'none';
  responseEl.textContent = '';
  
  const text = input.innerText;
  const res = await fetch('/api/process?role=refiner', { method: 'POST', body: text });
  const fullResponse = await res.text();
  
  // Streaming simulation
  const words = fullResponse.split(' ');
  for (let i = 0; i < words.length; i++) {
    responseEl.textContent += (i === 0 ? '' : ' ') + words[i];
    await new Promise(r => setTimeout(r, 20));
  }
  
  stopBtn.style.display = 'none';
  copyBtn.style.display = 'inline-block';
  sendBtn.disabled = false;
};
</script></body></html>`);
      return;
    }


    // Role-specific API processor
    if (url.pathname === '/api/process' && req.method === 'POST') {
      const role = url.searchParams.get('role') ?? 'general';
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Failure simulation support
        if (body.includes('TRIGGER_FAILURE') || url.searchParams.has('fail')) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`[${role.toUpperCase()} ERROR]: Processing failed due to simulated upstream fault.`);
          return;
        }

        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        let result = '';

        if (role === 'reviewer') {
          result = `[Reviewer]: Architectural analysis completed.\n- Strengths: Decentralized event dispatch, autonomous gates.\n- Consideration: Join synchronization requires careful state management.\n- Context:\n${body}`;
        } else if (role === 'summarizer') {
          result = `[Summarizer]: Executive summary.\n- Core Idea: Web actors coordinated purely by events and gates.\n- Key Outcome: Decentralized workflow without central coordinator.\n- Context:\n${body}`;
        } else if (role === 'critic') {
          result = `[Critic]: Critical risk assessment.\n- Risk 1: Long-running joins may wait indefinitely if an upstream actor dies.\n- Risk 2: High volume events can cause race conditions during gate matching.\n- Input evaluated:\n${body}`;
        } else if (role === 'refiner') {
          result = `[Refiner]: Final refined specification.\n- Synthesis: Combined Architectural Review, Summary, and Critical Assessment.\n- Resolution: Implement explicit join timeouts and lineage queries.\n- Source inputs compiled:\n${body}`;
        } else {
          result = `[${role}]: Processed ${body}`;
        }

        res.end(result);
      });
      return;
    }

    // Legacy endpoints for backward compatibility
    if (req.url === '/a' || req.url === '/b' || req.url === '/c') {
      const name = req.url.slice(1).toUpperCase();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Demo Actor ${name}</title></head>
<body><h1>Demo Actor ${name}</h1>
<textarea id="input"></textarea><button id="send">Send</button>
<pre id="response"></pre>
<script>
const input = document.querySelector('#input');
const response = document.querySelector('#response');
document.querySelector('#send').onclick = async () => {
  response.textContent = '';
  const r = await fetch('/respond', {method:'POST', body:input.value});
  response.textContent = await r.text();
};
</script></body></html>`);
      return;
    }

    if (req.url === '/respond' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`Processed by ${req.headers['x-actor'] ?? 'web actor'}: ${body}`);
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port);
  return server;
}

