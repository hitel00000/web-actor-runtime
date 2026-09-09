import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebActorRuntime } from './runtime.js';
import { WebActor } from './actor.js';
import { topicTrigger, SingleArtifactResolver, CorrelationJoinResolver } from './resolver.js';
import { ChatGPTAdapter, GeminiAdapter, ClaudeAdapter } from './llm-adapters.js';
import { PersistentBrowserRuntime } from './persistent-browser.js';
import { startDemoServer } from './demo-server.js';
import { ArtifactStore } from './store.js';
import type { Artifact, Event } from './types.js';

export type LLMProvider = 'chatgpt' | 'gemini' | 'claude';

interface RunConfig {
  mode: 'sim' | 'live';
  visible: boolean;
  seedText: string;
  reviewerProvider: LLMProvider;
  summarizerProvider: LLMProvider;
  synthesizerProvider: LLMProvider;
  reviewerPrompt: string;
  summarizerPrompt: string;
  synthesizerPrompt: string;
}

const DEFAULT_SEED = `System Proposal: Decentralized Multi-Agent Orchestration via Browser-Mediated Free-Tier Web LLMs.
Goal: Leverage independent browser contexts for ChatGPT, Gemini, and Claude without API keys, orchestrating them via reactive Event and Artifact convergence.`;

const DEFAULT_REVIEWER_PROMPT = `[Role: Senior Software Architect]
Please review this proposal and provide a technical analysis of trade-offs, scalability, and risks:

{input}`;

const DEFAULT_SUMMARIZER_PROMPT = `[Role: Executive Product Lead]
Summarize this proposal into 3 essential bullet points and target outcomes:

{input}`;

const DEFAULT_SYNTHESIZER_PROMPT = `[Role: Principal Architect & Synthesizer]
You have received inputs from Technical Review and Executive Summary. Please synthesize them into an actionable, comprehensive architectural decision record (ADR):

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

function resolveProvider(provider: LLMProvider, isLive: boolean, simPort: number) {
  switch (provider) {
    case 'chatgpt':
      return {
        displayName: 'ChatGPT',
        profile: 'chatgpt',
        url: isLive ? 'https://chatgpt.com' : `http://127.0.0.1:${simPort}/sim/chatgpt`,
        adapter: new ChatGPTAdapter({ timeoutMs: 90000, stabilityWaitMs: 2500 }),
      };
    case 'gemini':
      return {
        displayName: 'Gemini',
        profile: 'gemini',
        url: isLive ? 'https://gemini.google.com/app' : `http://127.0.0.1:${simPort}/sim/gemini`,
        adapter: new GeminiAdapter({ timeoutMs: 90000, stabilityWaitMs: 2500 }),
      };
    case 'claude':
      return {
        displayName: 'Claude',
        profile: 'claude',
        url: isLive ? 'https://claude.ai/new' : `http://127.0.0.1:${simPort}/sim/claude`,
        adapter: new ClaudeAdapter({ timeoutMs: 120000, stabilityWaitMs: 2500 }),
      };
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
      --gemini: #38bdf8;
      --claude: #f59e0b;
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
    textarea { font-family: monospace; resize: vertical; min-height: 80px; }

    .role-config-box { background: #0f172a; border: 1px solid var(--border); border-radius: 6px; padding: 0.9rem; margin-bottom: 1rem; }
    .role-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .role-title { font-weight: 700; font-size: 0.9rem; }
    .role-select { width: auto; margin-bottom: 0; padding: 0.3rem 0.6rem; font-size: 0.85rem; }

    .options-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
    .option-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }

    .btn { background: var(--primary); color: white; border: none; padding: 0.7rem 1.5rem; border-radius: 6px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .btn:hover { background: var(--primary-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-danger { background: var(--danger); }

    /* Actors Pipeline Progress Grid */
    .pipeline { display: flex; align-items: center; justify-content: space-between; position: relative; margin-bottom: 1.5rem; gap: 0.5rem; }
    .actor-box { flex: 1; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; padding: 1rem; text-align: center; position: relative; z-index: 2; transition: all 0.3s ease; }
    .actor-box.active-glow { border-color: var(--primary); box-shadow: 0 0 12px rgba(59, 130, 246, 0.4); }
    .actor-name { font-weight: 700; font-size: 0.9rem; margin-bottom: 0.5rem; }
    .actor-state { font-size: 0.8rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; }
    .actor-state.idle { background: #1e293b; color: var(--muted); }
    .actor-state.active { background: #1e3a8a; color: #93c5fd; }
    .actor-state.done { background: #064e3b; color: #6ee7b7; }
    .actor-state.error { background: #7f1d1d; color: #fca5a5; }

    .pipeline-connector { display: flex; align-items: center; justify-content: center; color: var(--border); font-size: 1.2rem; font-weight: bold; width: 24px; z-index: 1; transition: color 0.3s; }
    .pipeline-connector.active { color: var(--primary); animation: pulse-arrow 1s infinite alternate; }
    @keyframes pulse-arrow { from { opacity: 0.4; transform: translateX(-2px); } to { opacity: 1; transform: translateX(2px); } }

    /* Tabs & Content Output */
    .tabs { display: flex; gap: 0.5rem; border-bottom: 1px solid var(--border); margin-bottom: 1rem; overflow-x: auto; }
    .tab { padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; color: var(--muted); }
    .tab.active { color: var(--text); border-bottom-color: var(--primary); }
    .tab-content { display: none; background: #0f172a; border: 1px solid var(--border); border-radius: 6px; padding: 1rem; max-height: 420px; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 0.95rem; line-height: 1.6; color: #e2e8f0; }
    .tab-content.active { display: block; }
    .tab-content h1, .tab-content h2, .tab-content h3 { margin-top: 1.5rem; margin-bottom: 1rem; color: #f8fafc; }
    .tab-content p { margin-bottom: 1rem; }
    .tab-content ul, .tab-content ol { margin-bottom: 1rem; padding-left: 1.5rem; }
    .tab-content li { margin-bottom: 0.5rem; }
    .tab-content code { background: #1e293b; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
    .tab-content pre { background: #1e293b; padding: 1rem; border-radius: 8px; overflow-x: auto; margin-bottom: 1rem; }
    .tab-content pre code { background: none; padding: 0; }
    .tab-content blockquote { border-left: 4px solid var(--primary); padding-left: 1rem; color: var(--muted); font-style: italic; margin-bottom: 1rem; }
    .tab-content table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
    .tab-content th, .tab-content td { border: 1px solid var(--border); padding: 0.75rem; text-align: left; }
    .tab-content th { background: #1e293b; }

    /* Event Logs */
    .log-container { background: #0f172a; border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; height: 180px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; color: #cbd5e1; }
    .log-item { margin-bottom: 0.35rem; display: flex; gap: 0.5rem; }
    .log-time { color: var(--muted); min-width: 65px; }
    .log-topic { color: #38bdf8; font-weight: 600; }
  </style>
</head>
<body>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

  <header>
    <h1>🕹️ Web Actor Runtime — Control Panel</h1>
    <div>
      <span id="globalStatus" class="status-badge status-idle">IDLE</span>
    </div>
  </header>

  <div class="grid">
    <!-- Left Column: Input & Roles Configuration -->
    <div>
      <div class="card">
        <div class="card-title">
          <span>워크플로우 설정</span>
          <select id="presetSelect" style="width: auto; margin-bottom: 0; padding: 0.3rem 0.6rem;">
            <option value="arch">프리셋 1: 아키텍처 리뷰 & 종합 ADR</option>
            <option value="code">프리셋 2: 코드 보안 및 최적화 검토</option>
            <option value="biz">프리셋 3: 사업 기획 & 시장성 분석</option>
          </select>
        </div>

        <label for="seedInput">초기 제안 / 작업 지시문 (Seed Document)</label>
        <textarea id="seedInput" rows="3"></textarea>

        <div class="options-row">
          <div class="option-item">
            <input type="radio" id="modeSim" name="mode" value="sim" checked>
            <label for="modeSim" style="margin:0; cursor:pointer;">시뮬레이션 모드 (즉시 검증)</label>
          </div>
          <div class="option-item">
            <input type="radio" id="modeLive" name="mode" value="live">
            <label for="modeLive" style="margin:0; cursor:pointer;">실제 라이브 웹 LLM (자율 브라우저)</label>
          </div>
        </div>

        <div class="option-item" style="margin-bottom: 1.25rem;">
          <input type="checkbox" id="visibleWindow" checked>
          <label for="visibleWindow" style="margin:0; cursor:pointer;">브라우저 창 화면에 표시 (Visible)</label>
        </div>

        <!-- Role 1: Reviewer -->
        <div class="role-config-box">
          <div class="role-header">
            <span class="role-title" style="color: #38bdf8;">🔍 역할 1: 기술 심층 분석 (Reviewer)</span>
            <select id="reviewerProvider" class="role-select">
              <option value="chatgpt" selected>ChatGPT (4o/Free)</option>
              <option value="gemini">Gemini (2.0/Free)</option>
              <option value="claude">Claude (3.5/Free)</option>
            </select>
          </div>
          <textarea id="reviewerPrompt" rows="2"></textarea>
        </div>

        <!-- Role 2: Summarizer -->
        <div class="role-config-box">
          <div class="role-header">
            <span class="role-title" style="color: #34d399;">📝 역할 2: 핵심 요약 및 정리 (Summarizer)</span>
            <select id="summarizerProvider" class="role-select">
              <option value="gemini" selected>Gemini (2.0/Free)</option>
              <option value="chatgpt">ChatGPT (4o/Free)</option>
              <option value="claude">Claude (3.5/Free)</option>
            </select>
          </div>
          <textarea id="summarizerPrompt" rows="2"></textarea>
        </div>

        <!-- Role 3: Synthesizer -->
        <div class="role-config-box">
          <div class="role-header">
            <span class="role-title" style="color: #fbbf24;">🎯 역할 3: 최종 종합 및 수렴 (Synthesizer)</span>
            <select id="synthesizerProvider" class="role-select">
              <option value="claude" selected>Claude (3.5/Free)</option>
              <option value="chatgpt">ChatGPT (4o/Free)</option>
              <option value="gemini">Gemini (2.0/Free)</option>
            </select>
          </div>
          <textarea id="synthesizerPrompt" rows="2"></textarea>
        </div>

        <div style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem;">
          <button id="runBtn" class="btn" style="flex: 1;">🚀 워크플로우 실행 (Run Pipeline)</button>
          <button id="stopBtn" class="btn btn-danger" style="display: none;">중단</button>
        </div>

        <div style="display: flex; gap: 0.5rem;">
          <button id="loginChatGPTBtn" class="btn" style="background: var(--chatgpt); font-size: 0.8rem; padding: 0.4rem 0.6rem; flex: 1;">🔑 ChatGPT 로그인</button>
          <button id="loginGeminiBtn" class="btn" style="background: #2563eb; font-size: 0.8rem; padding: 0.4rem 0.6rem; flex: 1;">🔑 Gemini 로그인</button>
          <button id="loginClaudeBtn" class="btn" style="background: var(--claude); font-size: 0.8rem; padding: 0.4rem 0.6rem; flex: 1;">🔑 Claude 로그인</button>
        </div>
      </div>
    </div>

    <!-- Right Column: Live Progress & Output Artifacts -->
    <div>
      <!-- Pipeline State Boxes -->
      <div class="card">
        <div class="card-title">역할별 실시간 상태 (Autonomous Convergence)</div>
        <div class="pipeline">
          <div class="actor-box" id="box-reviewer">
            <div class="actor-name" id="name-reviewer">리뷰어 (ChatGPT)</div>
            <span class="actor-state idle" id="state-reviewer">대기중</span>
          </div>
          <div class="pipeline-connector" id="conn-1">➔</div>
          <div class="actor-box" id="box-summarizer">
            <div class="actor-name" id="name-summarizer">요약가 (Gemini)</div>
            <span class="actor-state idle" id="state-summarizer">대기중</span>
          </div>
          <div class="pipeline-connector" id="conn-2">➔</div>
          <div class="actor-box" id="box-synthesizer">
            <div class="actor-name" id="name-synthesizer">종합자 (Claude)</div>
            <span class="actor-state idle" id="state-synthesizer">수렴 대기</span>
          </div>
        </div>

        <!-- Artifact Output Tabs -->
        <div class="tabs" style="align-items: center; justify-content: space-between;">
          <div style="display: flex; gap: 0.5rem; overflow-x: auto;">
            <div class="tab active" data-target="tab-final">✨ 최종 종합 (Synthesis)</div>
            <div class="tab" data-target="tab-review">🔍 리뷰 산출물 (Review)</div>
            <div class="tab" data-target="tab-summary">📝 요약 산출물 (Summary)</div>
            <div class="tab" data-target="tab-lineage">🌳 계보 (Lineage)</div>
            <div class="tab" data-target="tab-history">📜 이력 (History)</div>
          </div>
          <button id="exportBtn" class="btn" style="background: #059669; font-size: 0.8rem; padding: 0.35rem 0.75rem; whitespace: nowrap;">📥 내보내기 (.md)</button>
        </div>

        <div id="tab-final" class="tab-content active">(워크플로우가 완료되면 최종 산출물이 여기에 렌더링됩니다)</div>
        <div id="tab-review" class="tab-content">(대기 중...)</div>
        <div id="tab-summary" class="tab-content">(대기 중...)</div>
        <div id="tab-lineage" class="tab-content">(계보 트리 대기 중...)</div>
        <div id="tab-history" class="tab-content">
          <table id="historyTable" style="width:100%; border-collapse: collapse;">
            <thead><tr><th>시간</th><th>타입</th><th>생성자</th><th>내용(미리보기)</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
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
        reviewer: \`${DEFAULT_REVIEWER_PROMPT}\`,
        summarizer: \`${DEFAULT_SUMMARIZER_PROMPT}\`,
        synthesizer: \`${DEFAULT_SYNTHESIZER_PROMPT}\`
      },
      code: {
        seed: \`Review and optimize this algorithm for high-concurrency event loops:\\nfunction processQueue(queue) { while(queue.length) { handle(queue.shift()); } }\`,
        reviewer: \`[Role: Security & Robustness Expert]\\nIdentify potential memory leaks, unhandled exceptions, and concurrency bottlenecks:\\n\\n{input}\`,
        summarizer: \`[Role: Performance & Algorithmic Engineer]\\nSuggest performance optimizations and alternative data structures:\\n\\n{input}\`,
        synthesizer: \`[Role: Staff Software Engineer]\\nSynthesize the security points and performance suggestions into an optimized production-grade TypeScript implementation:\\n\\n{inputs}\`
      },
      biz: {
        seed: \`Business Plan: AI agent-driven automated personal shopping assistant browser plugin with zero API cost.\`,
        reviewer: \`[Role: VC Technical Due Diligence]\\nAnalyze feasibility, platform risks, and architectural obstacles:\\n\\n{input}\`,
        summarizer: \`[Role: Growth & Product Strategist]\\nHighlight unique value propositions and monetization avenues:\\n\\n{input}\`,
        synthesizer: \`[Role: Executive Business Consultant]\\nCombine technical risks and growth strategies into an executive summary pitch deck draft:\\n\\n{inputs}\`
      }
    };

    const seedInput = document.querySelector('#seedInput');
    const reviewerProvider = document.querySelector('#reviewerProvider');
    const summarizerProvider = document.querySelector('#summarizerProvider');
    const synthesizerProvider = document.querySelector('#synthesizerProvider');
    const reviewerPrompt = document.querySelector('#reviewerPrompt');
    const summarizerPrompt = document.querySelector('#summarizerPrompt');
    const synthesizerPrompt = document.querySelector('#synthesizerPrompt');

    const presetSelect = document.querySelector('#presetSelect');
    const runBtn = document.querySelector('#runBtn');
    const stopBtn = document.querySelector('#stopBtn');
    const globalStatus = document.querySelector('#globalStatus');
    const logContainer = document.querySelector('#logContainer');

    function updateBoxTitles() {
      const p1 = reviewerProvider.options[reviewerProvider.selectedIndex].text.split(' ')[0];
      const p2 = summarizerProvider.options[summarizerProvider.selectedIndex].text.split(' ')[0];
      const p3 = synthesizerProvider.options[synthesizerProvider.selectedIndex].text.split(' ')[0];

      document.querySelector('#name-reviewer').textContent = '리뷰어 (' + p1 + ')';
      document.querySelector('#name-summarizer').textContent = '요약가 (' + p2 + ')';
      document.querySelector('#name-synthesizer').textContent = '종합자 (' + p3 + ')';
    }

    reviewerProvider.onchange = updateBoxTitles;
    summarizerProvider.onchange = updateBoxTitles;
    synthesizerProvider.onchange = updateBoxTitles;

    function applyPreset(key) {
      const p = presets[key];
      if (!p) return;
      seedInput.value = p.seed;
      reviewerPrompt.value = p.reviewer;
      summarizerPrompt.value = p.summarizer;
      synthesizerPrompt.value = p.synthesizer;
    }

    applyPreset('arch');
    updateBoxTitles();
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

    // Load History
    async function loadHistory() {
      const res = await fetch('/api/history');
      const data = await res.json();
      const tbody = document.querySelector('#historyTable tbody');
      tbody.innerHTML = '';
      data.artifacts.forEach(art => {
        const tr = document.createElement('tr');
        const timeStr = art.createdAt.split('T')[1].split('.')[0];
        tr.innerHTML = '<td>' + timeStr + '</td><td>' + art.type + '</td><td>' + art.createdBy + '</td><td>' + art.content.substring(0, 50) + '...</td>';
        tbody.appendChild(tr);
      });
    }
    loadHistory();

    function updateActorState(role, state, text) {
      const el = document.querySelector('#state-' + role);
      const box = document.querySelector('#box-' + role);
      if (!el || !box) return;
      el.className = 'actor-state ' + state;
      el.textContent = text;

      if (state === 'active') {
        box.classList.add('active-glow');
      } else {
        box.classList.remove('active-glow');
      }

      // Update pipeline connectors active state
      const rState = document.querySelector('#state-reviewer').textContent;
      const sState = document.querySelector('#state-summarizer').textContent;
      const conn1 = document.querySelector('#conn-1');
      const conn2 = document.querySelector('#conn-2');

      if (rState.includes('완료') || rState.includes('중')) {
        conn1.classList.add('active');
      } else {
        conn1.classList.remove('active');
      }

      if (sState.includes('완료') || sState.includes('중')) {
        conn2.classList.add('active');
      } else {
        conn2.classList.remove('active');
      }
    }

    // Connect Server-Sent Events (SSE)
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'log') {
        addLog(data.topic, data.message);
      } else if (data.type === 'actor-state') {
        updateActorState(data.role, data.state, data.text);
      } else if (data.type === 'pipeline-init') {
        document.querySelector('#name-reviewer').textContent = '리뷰어 (' + data.reviewer + ')';
        document.querySelector('#name-summarizer').textContent = '요약가 (' + data.summarizer + ')';
        document.querySelector('#name-synthesizer').textContent = '종합자 (' + data.synthesizer + ')';
      } else if (data.type === 'artifact') {
        const html = marked.parse(data.content);
        if (data.artifactType === 'review') {
          document.querySelector('#tab-review').innerHTML = html;
        } else if (data.artifactType === 'summary') {
          document.querySelector('#tab-summary').innerHTML = html;
        } else if (data.artifactType === 'final-synthesis') {
          document.querySelector('#tab-final').innerHTML = html;
          latestFinalMarkdown = data.content;
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
        reviewerProvider: reviewerProvider.value,
        summarizerProvider: summarizerProvider.value,
        synthesizerProvider: synthesizerProvider.value,
        reviewerPrompt: reviewerPrompt.value,
        summarizerPrompt: summarizerPrompt.value,
        synthesizerPrompt: synthesizerPrompt.value
      };

      // Reset UI state
      updateActorState('reviewer', 'idle', '대기중');
      updateActorState('summarizer', 'idle', '대기중');
      updateActorState('synthesizer', 'idle', '수렴 대기');
      document.querySelector('#tab-final').textContent = '생성 중...';
      document.querySelector('#tab-review').textContent = '대기 중...';
      document.querySelector('#tab-summary').textContent = '대기 중...';
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

    // Login Manager Handlers
    async function triggerLogin(service) {
      addLog('control', service + ' 로그인 창을 띄웁니다...');
      await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service })
      });
    }

    document.querySelector('#loginChatGPTBtn').onclick = () => triggerLogin('chatgpt');
    document.querySelector('#loginGeminiBtn').onclick = () => triggerLogin('gemini');
    document.querySelector('#loginClaudeBtn').onclick = () => triggerLogin('claude');

    // Export Handler
    let latestFinalMarkdown = '';
    document.querySelector('#exportBtn').onclick = () => {
      const activeTabContent = document.querySelector('.tab-content.active');
      const text = latestFinalMarkdown || activeTabContent.innerText || activeTabContent.textContent;
      if (!text || text.includes('(대기 중') || text.includes('(워크플로우가')) {
        alert('내보낼 산출물이 없습니다.');
        return;
      }
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'artifact-synthesis-' + new Date().toISOString().slice(0, 10) + '.md';
      a.click();
      URL.revokeObjectURL(url);
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

  const PORT = 4173;
  if (config.mode === 'sim' && !simServer) {
    simServer = startDemoServer(PORT);
  }

  const isLive = config.mode === 'live';
  const reviewerSpec = resolveProvider(config.reviewerProvider, isLive, PORT);
  const summarizerSpec = resolveProvider(config.summarizerProvider, isLive, PORT);
  const synthesizerSpec = resolveProvider(config.synthesizerProvider, isLive, PORT);

  broadcastSSE({
    type: 'pipeline-init',
    reviewer: reviewerSpec.displayName,
    summarizer: summarizerSpec.displayName,
    synthesizer: synthesizerSpec.displayName,
  });

  broadcastSSE({
    type: 'log',
    topic: 'system',
    message: `Starting pipeline [Reviewer:${reviewerSpec.displayName}, Summarizer:${summarizerSpec.displayName}, Synthesizer:${synthesizerSpec.displayName}] in ${config.mode.toUpperCase()} mode...`
  });

  currentBrowser = new PersistentBrowserRuntime({
    headless: !config.visible,
    useChromeChannel: false,
  });

  currentRuntime = new WebActorRuntime({ browser: currentBrowser });

  // Attach bus listeners for real-time dashboard updates
  currentRuntime.bus.subscribe('*', (event: Event) => {
    broadcastSSE({ type: 'log', topic: event.topic, message: `from ${event.source} (artifact: ${event.artifactId ?? 'none'})` });

    if (event.topic === 'proposal.created') {
      broadcastSSE({ type: 'actor-state', role: 'reviewer', state: 'active', text: `${reviewerSpec.displayName} 스트리밍 중...` });
      broadcastSSE({ type: 'actor-state', role: 'summarizer', state: 'active', text: `${summarizerSpec.displayName} 스트리밍 중...` });
    } else if (event.topic === 'review.completed') {
      broadcastSSE({ type: 'actor-state', role: 'reviewer', state: 'done', text: '완료' });
      const art = currentRuntime?.store.tryGet(event.artifactId!);
      if (art) broadcastSSE({ type: 'artifact', artifactType: art.type, content: art.content });
    } else if (event.topic === 'summary.completed') {
      broadcastSSE({ type: 'actor-state', role: 'summarizer', state: 'done', text: '완료' });
      const art = currentRuntime?.store.tryGet(event.artifactId!);
      if (art) broadcastSSE({ type: 'artifact', artifactType: art.type, content: art.content });
    } else if (event.topic === 'synthesis.completed') {
      broadcastSSE({ type: 'actor-state', role: 'synthesizer', state: 'done', text: '완료' });
      const art = currentRuntime?.store.tryGet(event.artifactId!);
      if (art) {
        broadcastSSE({ type: 'artifact', artifactType: art.type, content: art.content });
        const tree = currentRuntime?.store.getLineage(art.id);
        if (tree) {
          broadcastSSE({ type: 'lineage', treeText: stringifyLineage(tree) });
        }
      }
    } else if (event.topic === 'actor.failed') {
      const failedRole = event.source.replace('role-', '');
      broadcastSSE({ type: 'actor-state', role: failedRole, state: 'error', text: '오류 발생' });
    }
  });

  // Register Role 1: Reviewer
  currentRuntime.register(
    new WebActor({
      id: 'role-reviewer',
      profile: reviewerSpec.profile,
      url: reviewerSpec.url,
      adapter: reviewerSpec.adapter,
      activation: {
        trigger: topicTrigger('proposal.created'),
        resolver: new SingleArtifactResolver({ types: ['proposal'] }),
      },
      outputType: 'review',
      outputTopic: 'review.completed',
      buildPrompt: (inputs) => config.reviewerPrompt.replace('{input}', inputs[0].content),
    })
  );

  // Register Role 2: Summarizer
  currentRuntime.register(
    new WebActor({
      id: 'role-summarizer',
      profile: summarizerSpec.profile,
      url: summarizerSpec.url,
      adapter: summarizerSpec.adapter,
      activation: {
        trigger: topicTrigger('proposal.created'),
        resolver: new SingleArtifactResolver({ types: ['proposal'] }),
      },
      outputType: 'summary',
      outputTopic: 'summary.completed',
      buildPrompt: (inputs) => config.summarizerPrompt.replace('{input}', inputs[0].content),
    })
  );

  // Register Role 3: Synthesizer (Correlation Join)
  currentRuntime.register(
    new WebActor({
      id: 'role-synthesizer',
      profile: synthesizerSpec.profile,
      url: synthesizerSpec.url,
      adapter: synthesizerSpec.adapter,
      activation: {
        trigger: topicTrigger('review.completed', 'summary.completed'),
        resolver: new CorrelationJoinResolver({
          requiredTypes: ['review', 'summary'],
        }),
      },
      outputType: 'final-synthesis',
      outputTopic: 'synthesis.completed',
      buildPrompt: (inputs) => {
        const parts = inputs.map(
          (art) => `=== INPUT FROM ${art.createdBy.toUpperCase()} (${art.type}) ===\n${art.content}`
        );
        return config.synthesizerPrompt.replace('{inputs}', parts.join('\n\n'));
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
    metadata: { correlationId, title: 'Dashboard Dynamic Execution' },
  };

  currentRuntime.store.put(seedProposal);
  broadcastSSE({ type: 'log', topic: 'seed', message: `Seed artifact created: ${seedProposal.id}` });

  // Execute pipeline in background
  (async () => {
    try {
      const finalDonePromise = currentRuntime!.bus.waitFor(
        (e) => e.topic === 'synthesis.completed' && e.correlationId === correlationId,
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
      broadcastSSE({ type: 'log', topic: 'success', message: 'All actors converged and final synthesis artifact is ready!' });
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

    // Login Manager API: launch visible browser for session setup
    if (url.pathname === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { service } = JSON.parse(body);
          const urls: Record<string, string> = {
            chatgpt: 'https://chatgpt.com',
            gemini: 'https://gemini.google.com/app',
            claude: 'https://claude.ai/new',
          };
          const targetUrl = urls[service] ?? 'https://chatgpt.com';
          
          // Launch a temporary visible browser session for user login
          const setupBrowser = new PersistentBrowserRuntime({ headless: false });
          const page = await setupBrowser.page(service);
          await page.goto(targetUrl).catch(() => {});

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: `Opened login window for ${service}` }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // History API: get past artifacts and runs
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const store = new ArtifactStore();
      try {
        const artifacts = store.list(50);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ artifacts }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        store.close();
      }
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

process.on('SIGINT', async () => {
  await stopPipeline();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await stopPipeline();
  process.exit(0);
});

if (process.argv[1]?.endsWith('dashboard-server.ts') || process.argv[1]?.endsWith('dashboard-server.js')) {
  startDashboard(3000);
}
