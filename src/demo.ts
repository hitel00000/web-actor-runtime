import { randomUUID } from 'node:crypto';
import { WebActorRuntime } from './runtime.js';
import { WebActor } from './actor.js';
import { topicTrigger, SingleArtifactResolver, CorrelationJoinResolver } from './resolver.js';
import { startDemoServer } from './demo-server.js';
import type { Artifact, LineageNode } from './types.js';

function printLineageTree(node: LineageNode, indent = ''): void {
  console.log(`${indent}├── [${node.artifact.type.toUpperCase()}] ${node.artifact.id} (by: ${node.artifact.createdBy})`);
  for (const parent of node.parents) {
    printLineageTree(parent, indent + '│   ');
  }
}

async function main() {
  console.log('=====================================================');
  console.log('  Web Actor Runtime — Decentralized Experiment');
  console.log('=====================================================\n');

  const PORT = 4173;
  const server = startDemoServer(PORT);
  const runtime = new WebActorRuntime();

  // 1. Register Reviewer
  // Trigger: 'artifact.created'
  // Resolver: SingleArtifactResolver for 'document'
  const reviewer = new WebActor({
    id: 'reviewer',
    url: `http://127.0.0.1:${PORT}/reviewer`,
    activation: {
      trigger: topicTrigger('artifact.created'),
      resolver: new SingleArtifactResolver({ types: ['document'] }),
    },
    outputType: 'review',
    outputTopic: 'review.completed',
    buildPrompt: (inputs) => `Please review the architectural implications of this proposal:\n\n${inputs[0].content}`,
  });

  // 2. Register Summarizer
  // Trigger: 'artifact.created' (Broadcast!)
  // Resolver: SingleArtifactResolver for 'document'
  const summarizer = new WebActor({
    id: 'summarizer',
    url: `http://127.0.0.1:${PORT}/summarizer`,
    activation: {
      trigger: topicTrigger('artifact.created'),
      resolver: new SingleArtifactResolver({ types: ['document'] }),
    },
    outputType: 'summary',
    outputTopic: 'summary.completed',
    buildPrompt: (inputs) => `Summarize the key points of this proposal:\n\n${inputs[0].content}`,
  });

  // 3. Register Critic
  // Trigger: 'review.completed' (Chained activation)
  // Resolver: SingleArtifactResolver for 'review'
  const critic = new WebActor({
    id: 'critic',
    url: `http://127.0.0.1:${PORT}/critic`,
    activation: {
      trigger: topicTrigger('review.completed'),
      resolver: new SingleArtifactResolver({ types: ['review'] }),
    },
    outputType: 'critique',
    outputTopic: 'critique.completed',
    buildPrompt: (inputs) => `Critically evaluate this architectural review and expose potential risks:\n\n${inputs[0].content}`,
  });

  // 4. Register Refiner
  // Trigger: completion events
  // Resolver: CorrelationJoinResolver requiring [review, summary, critique] within the same correlation
  const refiner = new WebActor({
    id: 'refiner',
    url: `http://127.0.0.1:${PORT}/refiner`,
    activation: {
      trigger: topicTrigger('review.completed', 'summary.completed', 'critique.completed'),
      resolver: new CorrelationJoinResolver({
        requiredTypes: ['review', 'summary', 'critique'],
      }),
    },
    outputType: 'final',
    outputTopic: 'refinement.completed',
    buildPrompt: (inputs) => {
      return inputs
        .map((art) => `=== INPUT: ${art.type.toUpperCase()} (by ${art.createdBy}) ===\n${art.content}`)
        .join('\n\n');
    },
  });


  runtime.register(reviewer);
  runtime.register(summarizer);
  runtime.register(critic);
  runtime.register(refiner);

  console.log('[System] Starting WebActorRuntime...');
  await runtime.start({ headless: true });

  const correlationId = randomUUID();
  const seedArtifact: Artifact = {
    id: randomUUID(),
    type: 'document',
    content: `Proposal: Can web actors coordinate complex distributed workflows without a central orchestrator, relying purely on gates and artifact events?`,
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    parentIds: [],
    metadata: { correlationId, title: 'Web Actor Decentralization Proposal' },
  };

  runtime.store.put(seedArtifact);
  console.log(`\n[System] Seed Document Artifact created: ${seedArtifact.id}`);
  console.log(`[System] Publishing 'artifact.created' event (triggering decentralized workflow)...\n`);

  // Wait for the final refinement event
  const finalEventPromise = runtime.bus.waitFor(
    (e) => e.topic === 'refinement.completed' && e.correlationId === correlationId,
    25000
  );

  await runtime.bus.publish({
    id: randomUUID(),
    topic: 'artifact.created',
    source: 'system',
    artifactId: seedArtifact.id,
    correlationId,
    timestamp: new Date().toISOString(),
  });

  const finalEvent = await finalEventPromise;
  console.log(`\n[Event] Received final event: ${finalEvent.topic} (Artifact: ${finalEvent.artifactId})`);

  // Allow pending operations to settle
  await runtime.waitForIdle();

  const finalArtifact = runtime.store.get(finalEvent.artifactId!);
  console.log('\n=====================================================');
  console.log('  WORKFLOW COMPLETED SUCCESSFULLY');
  console.log('=====================================================');
  console.log('\nFinal Artifact Content:\n');
  console.log(finalArtifact.content);

  console.log('\n=====================================================');
  console.log('  ARTIFACT LINEAGE RECONSTRUCTION');
  console.log('=====================================================');
  const lineage = runtime.store.getLineage(finalArtifact.id);
  printLineageTree(lineage);

  console.log('\n[System] Shutting down runtime and server...');
  await runtime.stop();
  server.close();
  console.log('[System] Finished.');
}

main().catch(async (err) => {
  console.error('[Fatal Error]', err);
  process.exitCode = 1;
});

