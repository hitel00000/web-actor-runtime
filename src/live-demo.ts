import { randomUUID } from 'node:crypto';
import { WebActorRuntime } from './runtime.js';
import { WebActor } from './actor.js';
import { topicTrigger, SingleArtifactResolver, CorrelationJoinResolver } from './resolver.js';
import { ChatGPTAdapter, GeminiAdapter, ClaudeAdapter } from './llm-adapters.js';
import { PersistentBrowserRuntime } from './persistent-browser.js';
import { startDemoServer } from './demo-server.js';
import type { Artifact, LineageNode } from './types.js';

function printLineage(node: LineageNode, indent = ''): void {
  console.log(`${indent}├── [${node.artifact.type.toUpperCase()}] ${node.artifact.id} (by: ${node.artifact.createdBy})`);
  for (const parent of node.parents) {
    printLineage(parent, indent + '│   ');
  }
}

async function main() {
  const isLive = process.argv.includes('--live');
  const isVisible = process.argv.includes('--visible') || isLive;

  console.log('=============================================================');
  console.log('  Web Actor Runtime — FreeTier Web LLM Vertical Slice Demo');
  console.log('=============================================================');
  console.log(`Mode: ${isLive ? 'LIVE WEB LLMs (ChatGPT, Gemini, Claude)' : 'SIMULATED STREAMING WEB LLMs'}`);
  console.log(`Browser Display: ${isVisible ? 'VISIBLE WINDOWS' : 'HEADLESS'}\n`);

  const PORT = 4173;
  let server: any;
  if (!isLive) {
    server = startDemoServer(PORT);
  }

  // Persistent browser profile management
  const browser = new PersistentBrowserRuntime({
    headless: !isVisible,
    useChromeChannel: false,
  });

  const runtime = new WebActorRuntime({ browser });

  // Endpoint URLs
  const chatGptUrl = isLive ? 'https://chatgpt.com' : `http://127.0.0.1:${PORT}/sim/chatgpt`;
  const geminiUrl = isLive ? 'https://gemini.google.com/app' : `http://127.0.0.1:${PORT}/sim/gemini`;
  const claudeUrl = isLive ? 'https://claude.ai/new' : `http://127.0.0.1:${PORT}/sim/claude`;

  // =========================================================================
  // 1. Actor: ChatGPT (Architectural Reviewer)
  // =========================================================================
  const chatGptActor = new WebActor({
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
    buildPrompt: (inputs) =>
      `[Role: Senior Software Architect]\nPlease review this proposal and provide a technical analysis of trade-offs, scalability, and risks:\n\n${inputs[0].content}`,
  });

  // =========================================================================
  // 2. Actor: Gemini (Executive Summarizer)
  // =========================================================================
  const geminiActor = new WebActor({
    id: 'gemini-summarizer',
    profile: 'gemini',
    url: geminiUrl,
    adapter: new GeminiAdapter({ timeoutMs: 90000, stabilityWaitMs: 2500 }),
    activation: {
      trigger: topicTrigger('proposal.created'), // Broadcast: triggered by same proposal!
      resolver: new SingleArtifactResolver({ types: ['proposal'] }),
    },
    outputType: 'gemini-summary',
    outputTopic: 'gemini.summarized',
    buildPrompt: (inputs) =>
      `[Role: Executive Product Lead]\nSummarize this proposal into 3 essential bullet points and target outcomes:\n\n${inputs[0].content}`,
  });

  // =========================================================================
  // 3. Actor: Claude (Master Synthesizer / Refiner)
  // =========================================================================
  const claudeActor = new WebActor({
    id: 'claude-refiner',
    profile: 'claude',
    url: claudeUrl,
    adapter: new ClaudeAdapter({ timeoutMs: 120000, stabilityWaitMs: 2500 }),
    activation: {
      trigger: topicTrigger('chatgpt.reviewed', 'gemini.summarized'),
      // Join Condition: waits until BOTH ChatGPT review and Gemini summary exist for the same correlation!
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
      return `[Role: Principal Architect & Synthesizer]\nYou have received inputs from ChatGPT (Technical Review) and Gemini (Executive Summary). Please synthesize them into an actionable, comprehensive architectural decision record (ADR):\n\n${parts.join('\n\n')}`;
    },
  });

  runtime.register(chatGptActor);
  runtime.register(geminiActor);
  runtime.register(claudeActor);

  console.log('[System] Launching WebActorRuntime with 3 Free-Tier LLM Web Actors...');
  await runtime.start();

  const correlationId = randomUUID();
  const seedProposal: Artifact = {
    id: randomUUID(),
    type: 'proposal',
    content: `System Proposal: Decentralized Multi-Agent Orchestration via Browser-Mediated Free-Tier Web LLMs.
Goal: Leverage independent browser contexts for ChatGPT, Gemini, and Claude without API keys, orchestrating them via reactive Event and Artifact convergence.`,
    createdBy: 'product-owner',
    createdAt: new Date().toISOString(),
    parentIds: [],
    metadata: { correlationId, title: 'Web LLM Orchestration Architecture' },
  };

  runtime.store.put(seedProposal);
  console.log(`\n[System] Seed Proposal Artifact created: ${seedProposal.id}`);
  console.log(`[System] Publishing 'proposal.created' event to EventBus...\n`);

  try {
    // Wait for the final convergence from Claude OR early failure from an upstream actor
    const finalDonePromise = runtime.bus.waitFor(
      (e) => e.topic === 'claude.completed' && e.correlationId === correlationId,
      180000
    );

    const failurePromise = new Promise<never>((_, reject) => {
      runtime.bus.on('actor.failed', (e) => {
        if (e.correlationId === correlationId) {
          const errorMsg = (e.payload as any)?.error ?? 'Unknown actor execution error';
          reject(new Error(`[Pipeline Aborted] Upstream actor '${e.source}' failed: ${errorMsg}`));
        }
      });
    });

    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'proposal.created',
      source: 'system',
      artifactId: seedProposal.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });

    // Race between completion and upstream failure
    const finalEvent = await Promise.race([finalDonePromise, failurePromise]);
    console.log(`\n[Event] Received final event: ${finalEvent.topic} (Artifact: ${finalEvent.artifactId})`);

    await runtime.waitForIdle();

    const finalArtifact = runtime.store.get(finalEvent.artifactId!);

    console.log('\n=============================================================');
    console.log('  FREE-TIER LLM ORCHESTRATION COMPLETED SUCCESSFULLY');
    console.log('=============================================================');
    console.log('\nFinal Synthesized Output from Claude:\n');
    console.log(finalArtifact.content);

    console.log('\n=============================================================');
    console.log('  FULL ARTIFACT LINEAGE PROVENANCE');
    console.log('=============================================================');
    const lineage = runtime.store.getLineage(finalArtifact.id);
    printLineage(lineage);
  } finally {
    console.log('\n[System] Shutting down browser contexts and server...');
    await runtime.stop().catch(() => undefined);
    if (server) server.close();
    console.log('[System] Done.');
  }
}

main().catch(async (err) => {
  console.error('[Fatal Demo Error]', err);
  process.exitCode = 1;
});
