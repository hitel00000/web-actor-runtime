import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebActorRuntime } from './runtime.js';
import { WebActor } from './actor.js';
import { topicTrigger, SingleArtifactResolver, CorrelationJoinResolver } from './resolver.js';
import { ChatGPTAdapter, GeminiAdapter, ClaudeAdapter } from './llm-adapters.js';
import { PersistentBrowserRuntime } from './persistent-browser.js';
import { startDemoServer } from './demo-server.js';
import type { Artifact, Event } from './types.js';

interface RunConfig {
  mode: 'sim' | 'live';
  visible: boolean;
  seedText: string;
  chatgptPrompt: string;
  geminiPrompt: string;
  claudePrompt: string;
}

const DEFAULT_SEED = `System Proposal: Decentralized Multi-Agent Orchestration via Browser-Mediated Free-Tier Web LLMs.
Goal: Leverage independent browser contexts for ChatGPT, Gemini, and Claude without API keys, orchestrating them via reactive Event and Artifact convergence.`;

const DEFAULT_CHATGPT_PROMPT = `[Role: Senior Software Architect]
Please review this proposal and provide a technical analysis of trade-offs, scalability, and risks:

{input}`;

const DEFAULT_GEMINI_PROMPT = `[Role: Executive Product Lead]
Summarize this proposal into 3 essential bullet points and target outcomes:

{input}`;

const DEFAULT_CLAUDE_PROMPT = `[Role: Principal Architect & Synthesizer]
You have received inputs from ChatGPT (Technical Review) and Gemini (Executive Summary). Please synthesize them into an actionable, comprehensive architectural decision record (ADR):

{inputs}`;

let currentRuntime: WebActorRuntime | null = null;
let currentBrowser: PersistentBrowserRuntime | null = null;
let simServer: any = null;
let isRunning = false;
const sseClients = new Set<ServerResponse>();

function broadcastSSE(data: Record<string, unknown>) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function renderHTML(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Web Actor Runtime — Control Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --chatgpt: #10a37f;
      --gemini: #1a73e8;
      --claude: #d97706;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 1.5rem; line-height: 1.5; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
    .status-idle { background: #334155; color: #94a3b8; }
    .status-running { background: #854d0e; color: #fef08a; animation: pulse 2s infinite; }
    .status-completed { background: #065f46; color: #a7f3d0; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

    .grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 1.5rem; }
    @media (max-width: 1024px) { .grid { grid-template-columns: 1fr; } }

    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
    .card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; }

    label { display: block; font-size: 0.85rem; font-weight: 600; color: var(--muted); margin-bottom: 0.35rem; }
    input[type="text"], textarea, select {
      width: 100%; background: #0f172a; border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.75rem; color: var(--text); font-family: inherit; font-size: 0.9rem; margin-bottom: 1rem;
    }
    textarea { font-family: monospace; resize: vertical; min-height: 90px; }

    .options-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
    .option-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }

    .btn { background: var(--primary); color: white; border: none; padding: 0.7rem 1.5rem; border-radius: 6px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .btn:hover { background: var(--primary-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-danger { background: var(--danger); }

    /* Actors Pipeline Progress Grid */
    .pipeline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
    .actor-box { background: #0f172a; border: 1px solid var(--border); border-radius: 6px; padding: 1rem; text-align: center; }
    .actor-name { font-weight: 700; font-size: 0.95rem; margin-bottom: 0.5rem; }
    .actor-state { font-size: 0.8rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; }
    .actor-state.idle { background: #1e293b; color: var(--muted); }
    .actor-state.active { background: #1e3a8a; color: #93c5fd; }
    .actor-state.done { background: #064e3b; color: #6ee7b7; }
    .actor-state.error { background: #7f1d1d; color: #fca5a5; }

    /* Tabs & Content Output */
    .tabs { display: flex; gap: 0.5rem; border-bottom: 1px solid var(--border); margin-bottom: 1rem; overflow-x: auto; }
    .tab { padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; color: var(--muted); }
    .tab.active { color: var(--text); border-bottom-color: var(--primary); }
    .tab-content { display: none; background: #0f172a; border: 1px solid var(--border); border-radius: 6px; padding: 1rem; max-height: 420px; overflow-y: auto; font-family: monospace; font-size: 0.88rem; white-space: pre-wrap; word-break: break-word; }
    .tab-content.active { display: block; }

    /* Event Logs */
    .log-container { background: #0f172a; border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; height: 180px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; color: #cbd5e1; }
    .log-item { margin-bottom: 0.35rem; display: flex; gap: 0.5rem; }
    .log-time { color: var(--muted); min-width: 65px; }
    .log-topic { color: #38bdf8; font-weight: 600; }
  </style>
</head>
<body>

  <header>
    <h1>🕹️ Web Actor Runtime — Control Panel</h1>
    <div>
      <span id="globalStatus" class="status-badge status-idle">IDLE</span>
    </div>
  </header>

  <div class="grid">
    <!-- Left Column: Input & Prompts Configuration -->
    <div>
      <div class="card">
        <div class="card-title">
          <span>워크플로우 설정</span>
          <select id="presetSelect" style="width: auto; margin-bottom: 0; padding: 0.3rem 0.6rem;">
            <option value="arch">프리셋 1: 아키텍처 리뷰 & 종합 ADR</option>
            <option value="code">프리셋 2: 코드 보안 및 리팩토링 검토</option>
            <option value="biz">프리셋 3: 사업 기획 & 시장성 비판</option>
          </select>
        </div>

        <label for="seedInput">초기 제안 / 작업 지시문 (Seed Document)</label>
        <textarea id="seedInput" rows="4"></textarea>

        <div class="options-row">
          <div class="option-item">
            <input type="radio" id="modeSim" name="mode" value="sim" checked>
            <label for="modeSim" style="margin:0; cursor:pointer;">시뮬레이션 모드 (즉시 검증)</label>
          </div>
          <div class="option-item">
            <input type="radio" id="modeLive" name="mode" value="live">
            <label for="modeLive" style="margin:0; cursor:pointer;">실제 라이브 웹 (ChatGPT, Gemini, Claude)</label>
          </div>
        </div>

        <div class="option-item" style="margin-bottom: 1.25rem;">
          <input type="checkbox" id="visibleWindow" checked>
          <label for="visibleWindow" style="margin:0; cursor:pointer;">브라우저 창 화면에 표시 (Visible)</label>
        </div>

        <details style="margin-bottom: 1.25rem; border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem;">
          <summary style="cursor: pointer; font-weight: 600; font-size: 0.9rem; color: #38bdf8;">
            ⚙️ 각 Actor별 프롬프트 세부 지시문 커스텀
          </summary>
          <div style="margin-top: 1rem;">
            <label for="chatgptPrompt" style="color: var(--chatgpt);">ChatGPT 역할 프롬프트</label>
            <textarea id="chatgptPrompt" rows="3"></textarea>

            <label for="geminiPrompt" style="color: var(--gemini);">Gemini 역할 프롬프트</label>
            <textarea id="geminiPrompt" rows="3"></textarea>

            <label for="claudePrompt" style="color: var(--claude);">Claude 역할 프롬프트 (최종 합성)</label>
            <textarea id="claudePrompt" rows="3"></textarea>
          </div>
        </details>

        <div style="display: flex; gap: 0.75rem;">
          <button id="runBtn" class="btn" style="flex: 1;">🚀 워크플로우 실행 (Run Pipeline)</button>
          <button id="stopBtn" class="btn btn-danger" style="display: none;">중단</button>
        </div>
      </div>
    </div>

    <!-- Right Column: Live Progress & Output Artifacts -->
    <div>
      <!-- Pipeline State Boxes -->
      <div class="card">
        <div class="card-title">액터별 실시간 상태 (Autonomous Pipeline)</div>
        <div class="pipeline">
          <div class="actor-box" id="box-chatgpt">
            <div class="actor-name" style="color: var(--chatgpt);">ChatGPT</div>
            <span class="actor-state idle" id="state-chatgpt">대기중</span>
          </div>
          <div class="actor-box" id="box-gemini">
            <div class="actor-name" style="color: var(--gemini);">Gemini</div>
            <span class="actor-state idle" id="state-gemini">대기중</span>
          </div>
          <div class="actor-box" id="box-claude">
            <div class="actor-name" style="color: var(--claude);">Claude (Join)</div>
            <span class="actor-state idle" id="state-claude">수렴 대기</span>
          </div>
        </div>

        <!-- Artifact Output Tabs -->
        <div class="tabs">
          <div class="tab active" data-target="tab-final">✨ Claude 최종본 (Final)</div>
          <div class="tab" data-target="tab-chatgpt">ChatGPT 리뷰</div>
          <div class="tab" data-target="tab-gemini">Gemini 요약</div>
          <div class="tab" data-target="tab-lineage">🌳 계보 (Lineage)</div>
        </div>

        <div id="tab-final" class="tab-content active">(워크플로우가 완료되면 최종 산출물이 여기에 렌더링됩니다)</div>
        <div id="tab-chatgpt" class="tab-content">(대기 중...)</div>
        <div id="tab-gemini" class="tab-content">(대기 중...)</div>
        <div id="tab-lineage" class="tab-content">(계보 트리 대기 중...)</div>
      </div>

      <!-- Real-time Event Log -->
      <div class="card" style="margin-bottom: 0;">
        <div class="card-title" style="font-size: 0.95rem;">
          <span>실시간 이벤트 로그 (Event Bus Stream)</span>
          <button id="clearLogBtn" style="background:none; border:none; color:var(--muted); font-size:0.8rem; cursor:pointer;">지우기</button>
        </div>
        <div class="log-container" id="logContainer"></div>
      </div>
    </div>
  </div>

  <script>
    const presets = {
      arch: {
        seed: \`${DEFAULT_SEED}\`,
        chatgpt: \`${DEFAULT_CHATGPT_PROMPT}\`,
        gemini: \`${DEFAULT_GEMINI_PROMPT}\`,
        claude: \`${DEFAULT_CLAUDE_PROMPT}\`
      },
      code: {
        seed: \`Review and optimize this algorithm for high-concurrency event loops:\nfunction processQueue(queue) { while(queue.length) { handle(queue.shift()); } }\`,
        chatgpt: \`[Role: Security & Robustness Expert]\nIdentify potential memory leaks, unhandled exceptions, and concurrency bottlenecks:\n\n{input}\`,
        gemini: \`[Role: Performance & Algorithmic Engineer]\nSuggest performance optimizations and alternative data structures:\n\n{input}\`,
        claude: \`[Role: Staff Software Engineer]\nSynthesize the security points and performance suggestions into an optimized production-grade TypeScript implementation:\n\n{inputs}\`
      },
      biz: {
        seed: \`Business Plan: AI agent-driven automated personal shopping assistant browser plugin with zero API cost.\`,
        chatgpt: \`[Role: VC Technical Due Diligence]\nAnalyze feasibility, platform risks, and architectural obstacles:\n\n{input}\`,
        gemini: \`[Role: Growth & Product Strategist]\nHighlight unique value propositions and monetization avenues:\n\n{input}\`,
        claude: \`[Role: Executive Business Consultant]\nCombine technical risks and growth strategies into an executive summary pitch deck draft:\n\n{inputs}\`
      }
    };

    const seedInput = document.querySelector('#seedInput');
    const chatgptPrompt = document.querySelector('#chatgptPrompt');
    const geminiPrompt = document.querySelector('#geminiPrompt');
    const claudePrompt = document.querySelector('#claudePrompt');
    const presetSelect = document.querySelector('#presetSelect');
    const runBtn = document.querySelector('#runBtn');
    const stopBtn = document.querySelector('#stopBtn');
    const globalStatus = document.querySelector('#globalStatus');
    const logContainer = document.querySelector('#logContainer');

    function applyPreset(key) {
      const p = presets[key];
      if (!p) return;
      seedInput.value = p.seed;
      chatgptPrompt.value = p.chatgpt;
      geminiPrompt.value = p.gemini;
      claudePrompt.value = p.claude;
    }

    applyPreset('arch');
    presetSelect.onchange = (e) => applyPreset(e.target.value);

    // Tab switching
    document.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.querySelector('#' + t.dataset.target).classList.add('active');
      };
    });

    function addLog(topic, msg) {
      const time = new Date().toTimeString().split(' ')[0];
      const div = document.createElement('div');
      div.className = 'log-item';
      div.innerHTML = \`<span class="log-time">\${time}</span><span class="log-topic">[\${topic}]</span> <span>\${msg}</span>\`;
      logContainer.appendChild(div);
      logContainer.scrollTop = logContainer.scrollHeight;
    }

    document.querySelector('#clearLogBtn').onclick = () => {
      logContainer.innerHTML = '';
    };

    function updateActorState(id, state, text) {
      const el = document.querySelector('#state-' + id);
      if (!el) return;
      el.className = 'actor-state ' + state;
      el.textContent = text;
    }

    // Connect Server-Sent Events (SSE)
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'log') {
        addLog(data.topic, data.message);
      } else if (data.type === 'actor-state') {
        updateActorState(data.actor, data.state, data.text);
      } else if (data.type === 'artifact') {
        if (data.artifactType === 'chatgpt-review') {
          document.querySelector('#tab-chatgpt').textContent = data.content;
        } else if (data.artifactType === 'gemini-summary') {
          document.querySelector('#tab-gemini').textContent = data.content;
        } else if (data.artifactType === 'claude-final') {
          document.querySelector('#tab-final').textContent = data.content;
        }
      } else if (data.type === 'lineage') {
        document.querySelector('#tab-lineage').textContent = data.treeText;
      } else if (data.type === 'status') {
        globalStatus.textContent = data.status.toUpperCase();
        globalStatus.className = 'status-badge status-' + data.status;
        if (data.status === 'running') {
          runBtn.disabled = true;
          stopBtn.style.display = 'inline-block';
        } else {
          runBtn.disabled = false;
          stopBtn.style.display = 'none';
        }
      }
    };

    runBtn.onclick = async () => {
      const config = {
        mode: document.querySelector('input[name="mode"]:checked').value,
        visible: document.querySelector('#visibleWindow').checked,
        seedText: seedInput.value,
        chatgptPrompt: chatgptPrompt.value,
        geminiPrompt: geminiPrompt.value,
        claudePrompt: claudePrompt.value
      };

      // Reset UI state
      updateActorState('chatgpt', 'idle', '대기중');
      updateActorState('gemini', 'idle', '대기중');
      updateActorState('claude', 'idle', '수렴 대기');
      document.querySelector('#tab-final').textContent = '생성 중...';
      document.querySelector('#tab-chatgpt').textContent = '대기 중...';
      document.querySelector('#tab-gemini').textContent = '대기 중...';
      document.querySelector('#tab-lineage').textContent = '추적 중...';

      addLog('control', '워크플로우 실행을 요청했습니다...');

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (!res.ok) {
        alert('실행 오류: ' + (data.error || 'Unknown error'));
      }
    };

    stopBtn.onclick = async () => {
      addLog('control', '파이프라인 중단을 요청했습니다...');
      await fetch('/api/stop', { method: 'POST' });
    };
  </script>
</body>
</html>`;
}

function stringifyLineage(node: any, indent = ''): string {
  let res = `${indent}├── [${node.artifact.type.toUpperCase()}] (by: ${node.artifact.createdBy})\n`;
  for (const parent of node.parents) {
    res += stringifyLineage(parent, indent + '│   ');
  }
  return res;
}

async function runPipeline(config: RunConfig): Promise<void> {
  if (isRunning) {
    throw new Error('Pipeline is already running.');
  }

  isRunning = true;
  broadcastSSE({ type: 'status', status: 'running' });
  broadcastSSE({ type: 'log', topic: 'system', message: `Starting pipeline in ${config.mode.toUpperCase()} mode...` });

  const PORT = 4173;
  if (config.mode === 'sim' && !simServer) {
    simServer = startDemoServer(PORT);
  }

  currentBrowser = new PersistentBrowserRuntime({
    headless: !config.visible,
    useChromeChannel: false,
  });

  currentRuntime = new WebActorRuntime({ browser: currentBrowser });

  const isLive = config.mode === 'live';
  const chatGptUrl = isLive ? 'https://chatgpt.com' : `http://127.0.0.1:${PORT}/sim/chatgpt`;
  const geminiUrl = isLive ? 'https://gemini.google.com/app' : `http://127.0.0.1:${PORT}/sim/gemini`;
  const claudeUrl = isLive ? 'https://claude.ai/new' : `http://127.0.0.1:${PORT}/sim/claude`;

  // Attach bus listeners for real-time dashboard updates
  currentRuntime.bus.subscribe('*', (event: Event) => {
    broadcastSSE({ type: 'log', topic: event.topic, message: `from ${event.source} (artifact: ${event.artifactId ?? 'none'})` });

    if (event.topic === 'proposal.created') {
      broadcastSSE({ type: 'actor-state', actor: 'chatgpt', state: 'active', text: '스트리밍 중...' });
      broadcastSSE({ type: 'actor-state', actor: 'gemini', state: 'active', text: '스트리밍 중...' });
    } else if (event.topic === 'chatgpt.reviewed') {
      broadcastSSE({ type: 'actor-state', actor: 'chatgpt', state: 'done', text: '완료' });
      const art = currentRuntime?.store.tryGet(event.artifactId!);
      if (art) broadcastSSE({ type: 'artifact', artifactType: art.type, content: art.content });
    } else if (event.topic === 'gemini.summarized') {
      broadcastSSE({ type: 'actor-state', actor: 'gemini', state: 'done', text: '완료' });
      const art = currentRuntime?.store.tryGet(event.artifactId!);
      if (art) broadcastSSE({ type: 'artifact', artifactType: art.type, content: art.content });
    } else if (event.topic === 'claude.completed') {
      broadcastSSE({ type: 'actor-state', actor: 'claude', state: 'done', text: '완료' });
      const art = currentRuntime?.store.tryGet(event.artifactId!);
      if (art) {
        broadcastSSE({ type: 'artifact', artifactType: art.type, content: art.content });
        const tree = currentRuntime?.store.getLineage(art.id);
        if (tree) {
          broadcastSSE({ type: 'lineage', treeText: stringifyLineage(tree) });
        }
      }
    } else if (event.topic === 'actor.failed') {
      broadcastSSE({ type: 'actor-state', actor: event.source.replace('-reviewer', '').replace('-summarizer', '').replace('-refiner', ''), state: 'error', text: '에러 발생' });
    }
  });

  // Register ChatGPT Actor
  currentRuntime.register(
    new WebActor({
      id: 'chatgpt-reviewer',
      profile: 'chatgpt',
      url: chatGptUrl,
      adapter: new ChatGPTAdapter({ timeoutMs: 90000, stabilityWaitMs: 2500 }),
      activation: {
        trigger: topicTrigger('proposal.created'),
        resolver: new SingleArtifactResolver({ types: ['proposal'] }),
      },
      outputType: 'chatgpt-review',
      outputTopic: 'chatgpt.reviewed',
      buildPrompt: (inputs) => config.chatgptPrompt.replace('{input}', inputs[0].content),
    })
  );

  // Register Gemini Actor
  currentRuntime.register(
    new WebActor({
      id: 'gemini-summarizer',
      profile: 'gemini',
      url: geminiUrl,
      adapter: new GeminiAdapter({ timeoutMs: 90000, stabilityWaitMs: 2500 }),
      activation: {
        trigger: topicTrigger('proposal.created'),
        resolver: new SingleArtifactResolver({ types: ['proposal'] }),
      },
      outputType: 'gemini-summary',
      outputTopic: 'gemini.summarized',
      buildPrompt: (inputs) => config.geminiPrompt.replace('{input}', inputs[0].content),
    })
  );

  // Register Claude Actor (Join)
  currentRuntime.register(
    new WebActor({
      id: 'claude-refiner',
      profile: 'claude',
      url: claudeUrl,
      adapter: new ClaudeAdapter({ timeoutMs: 120000, stabilityWaitMs: 2500 }),
      activation: {
        trigger: topicTrigger('chatgpt.reviewed', 'gemini.summarized'),
        resolver: new CorrelationJoinResolver({
          requiredTypes: ['chatgpt-review', 'gemini-summary'],
        }),
      },
      outputType: 'claude-final',
      outputTopic: 'claude.completed',
      buildPrompt: (inputs) => {
        const parts = inputs.map(
          (art) => `=== INPUT FROM ${art.createdBy.toUpperCase()} (${art.type}) ===\n${art.content}`
        );
        return config.claudePrompt.replace('{inputs}', parts.join('\n\n'));
      },
    })
  );

  await currentRuntime.start();

  const correlationId = randomUUID();
  const seedProposal: Artifact = {
    id: randomUUID(),
    type: 'proposal',
    content: config.seedText,
    createdBy: 'dashboard-user',
    createdAt: new Date().toISOString(),
    parentIds: [],
    metadata: { correlationId, title: 'Dashboard Execution' },
  };

  currentRuntime.store.put(seedProposal);
  broadcastSSE({ type: 'log', topic: 'seed', message: `Seed artifact created: ${seedProposal.id}` });

  // Execute pipeline in background
  (async () => {
    try {
      const finalDonePromise = currentRuntime!.bus.waitFor(
        (e) => e.topic === 'claude.completed' && e.correlationId === correlationId,
        180000
      );

      const failurePromise = new Promise<never>((_, reject) => {
        currentRuntime!.bus.on('actor.failed', (e) => {
          if (e.correlationId === correlationId) {
            reject(new Error(`Actor '${e.source}' failed: ${(e.payload as any)?.error}`));
          }
        });
      });

      await currentRuntime!.bus.publish({
        id: randomUUID(),
        topic: 'proposal.created',
        source: 'dashboard',
        artifactId: seedProposal.id,
        correlationId,
        timestamp: new Date().toISOString(),
      });

      await Promise.race([finalDonePromise, failurePromise]);
      await currentRuntime!.waitForIdle();

      broadcastSSE({ type: 'status', status: 'completed' });
      broadcastSSE({ type: 'log', topic: 'success', message: 'All actors converged and final artifact is ready!' });
    } catch (err: any) {
      broadcastSSE({ type: 'status', status: 'idle' });
      broadcastSSE({ type: 'log', topic: 'error', message: err.message });
    } finally {
      isRunning = false;
      await stopPipeline();
    }
  })();
}

async function stopPipeline(): Promise<void> {
  if (currentRuntime) {
    await currentRuntime.stop().catch(() => undefined);
    currentRuntime = null;
  }
  if (currentBrowser) {
    await currentBrowser.stop().catch(() => undefined);
    currentBrowser = null;
  }
  isRunning = false;
  broadcastSSE({ type: 'status', status: 'idle' });
}

export function startDashboard(port = 3000) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // Serve HTML UI
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHTML());
      return;
    }

    // SSE Stream
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"type":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Run Pipeline API
    if (url.pathname === '/api/run' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const config: RunConfig = JSON.parse(body);
          await runPipeline(config);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Stop Pipeline API
    if (url.pathname === '/api/stop' && req.method === 'POST') {
      await stopPipeline();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`\n=============================================================`);
    console.log(`  Web Actor Runtime — Control Panel is running!`);
    console.log(`  Access URL: http://localhost:${port}`);
    console.log(`=============================================================\n`);
  });

  return server;
}

if (process.argv[1]?.endsWith('dashboard-server.ts') || process.argv[1]?.endsWith('dashboard-server.js')) {
  startDashboard(3000);
}
