import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebActorRuntime } from '../src/runtime.js';
import { WebActor, FunctionActor } from '../src/actor.js';
import { ArtifactFilterGate, JoinGate, TopicGate } from '../src/gate.js';
import { topicTrigger, SingleArtifactResolver, CorrelationJoinResolver } from '../src/resolver.js';
import { ArtifactStore } from '../src/store.js';
import { EventBus } from '../src/bus.js';
import { startDemoServer } from '../src/demo-server.js';
import type { Artifact, Event } from '../src/types.js';

let testServerPort = 4180;

function nextPort() {
  return testServerPort++;
}

async function runTestSuite() {
  console.log('\n=============================================================');
  console.log('  RUNNING 12 INTEGRATION TESTS (8 CORE + 4 ARCHITECTURAL)');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`TEST [${name}] ... `);
    try {
      await fn();
      console.log('PASSED');
      passed++;
    } catch (err: any) {
      console.log('FAILED');
      console.error(`  -> Error: ${err.message}`);
      if (err.stack) {
        console.error(`  -> Stack: ${err.stack.split('\n').slice(1, 4).join('\n')}`);
      }
      failed++;
    }
  }

  // =========================================================================
  // 1. Broadcast: 하나의 Artifact가 여러 Actor를 activate한다.
  // =========================================================================
  await test('1. Broadcast: Single artifact activates multiple independent actors', async () => {
    const port = nextPort();
    const server = startDemoServer(port);
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    const activated: string[] = [];

    const actor1 = new FunctionActor({
      id: 'broadcast-listener-1',
      gate: new ArtifactFilterGate({ topics: ['doc.created'], types: ['spec'] }),
      outputType: 'b1-out',
      outputTopic: 'b1.done',
      fn: async (inputs) => {
        activated.push('actor1');
        return `Processed by 1: ${inputs[0].content}`;
      },
    });

    const actor2 = new FunctionActor({
      id: 'broadcast-listener-2',
      gate: new ArtifactFilterGate({ topics: ['doc.created'], types: ['spec'] }),
      outputType: 'b2-out',
      outputTopic: 'b2.done',
      fn: async (inputs) => {
        activated.push('actor2');
        return `Processed by 2: ${inputs[0].content}`;
      },
    });

    runtime.register(actor1);
    runtime.register(actor2);
    await runtime.start({ headless: true });

    const seed: Artifact = {
      id: randomUUID(),
      type: 'spec',
      content: 'Broadcast test specification',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      parentIds: [],
    };
    store.put(seed);

    const b1Done = runtime.bus.waitFor((e) => e.topic === 'b1.done', 5000);
    const b2Done = runtime.bus.waitFor((e) => e.topic === 'b2.done', 5000);

    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'doc.created',
      source: 'tester',
      artifactId: seed.id,
      timestamp: new Date().toISOString(),
    });

    await Promise.all([b1Done, b2Done]);
    await runtime.waitForIdle();

    assert.equal(activated.length, 2);
    assert.ok(activated.includes('actor1'));
    assert.ok(activated.includes('actor2'));

    await runtime.stop();
    server.close();
  });

  // =========================================================================
  // 2. Selective activation: 모든 Actor가 모든 Artifact에 반응하지 않는다.
  // =========================================================================
  await test('2. Selective Activation: Actors ignore non-matching topics and types', async () => {
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    let actorARan = false;
    let actorBRan = false;

    const actorA = new FunctionActor({
      id: 'selective-A',
      gate: new ArtifactFilterGate({ types: ['type-A'] }),
      outputType: 'res-A',
      outputTopic: 'res.A',
      fn: () => {
        actorARan = true;
        return 'A';
      },
    });

    const actorB = new FunctionActor({
      id: 'selective-B',
      gate: new ArtifactFilterGate({ types: ['type-B'] }),
      outputType: 'res-B',
      outputTopic: 'res.B',
      fn: () => {
        actorBRan = true;
        return 'B';
      },
    });

    runtime.register(actorA);
    runtime.register(actorB);
    await runtime.start({ headless: true });

    const artifactA: Artifact = {
      id: randomUUID(),
      type: 'type-A',
      content: 'For A only',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      parentIds: [],
    };
    store.put(artifactA);

    const aDone = runtime.bus.waitFor((e) => e.topic === 'res.A', 5000);
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'artifact.created',
      source: 'tester',
      artifactId: artifactA.id,
      timestamp: new Date().toISOString(),
    });

    await aDone;
    await runtime.waitForIdle();

    assert.equal(actorARan, true, 'Actor A should have run');
    assert.equal(actorBRan, false, 'Actor B should NOT have run');

    await runtime.stop();
  });

  // =========================================================================
  // 3. Independent execution: Actor들이 서로 직접 호출하지 않고 독립적으로 실행된다.
  // =========================================================================
  await test('3. Independent Execution: Actors execute via separate browser pages without direct coupling', async () => {
    const port = nextPort();
    const server = startDemoServer(port);
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    const reviewer = new WebActor({
      id: 'independent-reviewer',
      url: `http://127.0.0.1:${port}/reviewer`,
      gate: new ArtifactFilterGate({ types: ['document'] }),
      outputType: 'review',
      outputTopic: 'review.completed',
      buildPrompt: (inputs) => inputs[0].content,
    });

    const summarizer = new WebActor({
      id: 'independent-summarizer',
      url: `http://127.0.0.1:${port}/summarizer`,
      gate: new ArtifactFilterGate({ types: ['document'] }),
      outputType: 'summary',
      outputTopic: 'summary.completed',
      buildPrompt: (inputs) => inputs[0].content,
    });

    runtime.register(reviewer);
    runtime.register(summarizer);
    await runtime.start({ headless: true });

    const doc: Artifact = {
      id: randomUUID(),
      type: 'document',
      content: 'Independent actor execution validation',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      parentIds: [],
    };
    store.put(doc);

    const rDone = runtime.bus.waitFor((e) => e.topic === 'review.completed', 10000);
    const sDone = runtime.bus.waitFor((e) => e.topic === 'summary.completed', 10000);

    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'artifact.created',
      source: 'tester',
      artifactId: doc.id,
      timestamp: new Date().toISOString(),
    });

    await Promise.all([rDone, sDone]);
    await runtime.waitForIdle();

    const reviews = store.findByType('review');
    const summaries = store.findByType('summary');

    assert.equal(reviews.length, 1);
    assert.equal(summaries.length, 1);
    assert.ok(reviews[0].content.includes('Architectural analysis completed'));
    assert.ok(summaries[0].content.includes('Executive summary'));

    await runtime.stop();
    server.close();
  });

  // =========================================================================
  // 4. Chained activation: A의 결과가 B를 activate하고 B의 결과가 C를 activate할 수 있다.
  // =========================================================================
  await test('4. Chained Activation: A (Document) -> B (Reviewer) -> C (Critic)', async () => {
    const port = nextPort();
    const server = startDemoServer(port);
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    const reviewer = new WebActor({
      id: 'chain-reviewer',
      url: `http://127.0.0.1:${port}/reviewer`,
      gate: new ArtifactFilterGate({ topics: ['step1.doc'], types: ['document'] }),
      outputType: 'review',
      outputTopic: 'step2.review',
      buildPrompt: (inputs) => inputs[0].content,
    });

    const critic = new WebActor({
      id: 'chain-critic',
      url: `http://127.0.0.1:${port}/critic`,
      gate: new ArtifactFilterGate({ topics: ['step2.review'], types: ['review'] }),
      outputType: 'critique',
      outputTopic: 'step3.critic',
      buildPrompt: (inputs) => inputs[0].content,
    });

    runtime.register(reviewer);
    runtime.register(critic);
    await runtime.start({ headless: true });

    const doc: Artifact = {
      id: randomUUID(),
      type: 'document',
      content: 'Chained activation pipeline input',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      parentIds: [],
    };
    store.put(doc);

    const criticDone = runtime.bus.waitFor((e) => e.topic === 'step3.critic', 15000);

    // Only fire step1
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'step1.doc',
      source: 'tester',
      artifactId: doc.id,
      timestamp: new Date().toISOString(),
    });

    await criticDone;
    await runtime.waitForIdle();

    const critiques = store.findByType('critique');
    assert.equal(critiques.length, 1);
    assert.ok(critiques[0].content.includes('Critical risk assessment'));
    // Parent of critique is review
    const review = store.get(critiques[0].parentIds[0]);
    assert.equal(review.type, 'review');
    // Parent of review is doc
    assert.equal(review.parentIds[0], doc.id);

    await runtime.stop();
    server.close();
  });

  // =========================================================================
  // 5. Join / aggregation: 여러 Actor의 결과가 준비된 뒤 하나의 Actor가 종합한다.
  // =========================================================================
  await test('5. Join / Aggregation: Refiner waits for review, summary, and critique before activating', async () => {
    const port = nextPort();
    const server = startDemoServer(port);
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    const correlationId = randomUUID();

    const refiner = new WebActor({
      id: 'join-refiner',
      url: `http://127.0.0.1:${port}/refiner`,
      gate: new JoinGate({
        topics: ['artifact.created'],
        requiredTypes: ['review', 'summary', 'critique'],
      }),
      outputType: 'final',
      outputTopic: 'refinement.completed',
      buildPrompt: (inputs) => inputs.map((i) => `[${i.type}]: ${i.content}`).join('\n\n'),
    });

    runtime.register(refiner);
    await runtime.start({ headless: true });

    // Step 1: Put review only -> Refiner should NOT activate
    const artReview: Artifact = {
      id: randomUUID(),
      type: 'review',
      content: 'Review content',
      createdBy: 'reviewer',
      createdAt: new Date().toISOString(),
      parentIds: [],
      metadata: { correlationId },
    };
    store.put(artReview);
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'artifact.created',
      source: 'tester',
      artifactId: artReview.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });
    await runtime.waitForIdle();
    assert.equal(store.findByType('final').length, 0, 'Refiner must not run when only review is present');

    // Step 2: Put summary only -> Refiner still should NOT activate
    const artSummary: Artifact = {
      id: randomUUID(),
      type: 'summary',
      content: 'Summary content',
      createdBy: 'summarizer',
      createdAt: new Date().toISOString(),
      parentIds: [],
      metadata: { correlationId },
    };
    store.put(artSummary);
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'artifact.created',
      source: 'tester',
      artifactId: artSummary.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });
    await runtime.waitForIdle();
    assert.equal(store.findByType('final').length, 0, 'Refiner must not run when critique is missing');

    // Step 3: Put critique -> All 3 are now present -> Refiner activates!
    const artCritique: Artifact = {
      id: randomUUID(),
      type: 'critique',
      content: 'Critique content',
      createdBy: 'critic',
      createdAt: new Date().toISOString(),
      parentIds: [],
      metadata: { correlationId },
    };
    store.put(artCritique);

    const refinerDone = runtime.bus.waitFor((e) => e.topic === 'refinement.completed', 10000);
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'artifact.created',
      source: 'tester',
      artifactId: artCritique.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });

    await refinerDone;
    await runtime.waitForIdle();

    const finals = store.findByType('final');
    assert.equal(finals.length, 1, 'Refiner should have executed exactly once');
    assert.equal(finals[0].parentIds.length, 3, 'Final artifact must have all 3 parents');
    assert.ok(finals[0].content.includes('Final refined specification'));

    await runtime.stop();
    server.close();
  });

  // =========================================================================
  // 6. Failure isolation: 하나의 Actor가 실패해도 다른 Actor의 실행이 중단되지 않는다.
  // =========================================================================
  await test('6. Failure Isolation: Failing actor emits error without crashing runtime or sibling actors', async () => {
    const port = nextPort();
    const server = startDemoServer(port);
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    let siblingSucceeded = false;
    let failureDetected = false;

    // Failing actor using simulated server fault
    const failingActor = new WebActor({
      id: 'failing-summarizer',
      url: `http://127.0.0.1:${port}/summarizer?fail=true`,
      gate: new ArtifactFilterGate({ topics: ['work.start'], types: ['task'] }),
      outputType: 'summary',
      outputTopic: 'summary.completed',
      buildPrompt: () => 'TRIGGER_FAILURE',
    });

    // Sibling actor that should continue running successfully
    const healthyActor = new WebActor({
      id: 'healthy-reviewer',
      url: `http://127.0.0.1:${port}/reviewer`,
      gate: new ArtifactFilterGate({ topics: ['work.start'], types: ['task'] }),
      outputType: 'review',
      outputTopic: 'review.completed',
      buildPrompt: (inputs) => inputs[0].content,
    });

    runtime.register(failingActor);
    runtime.register(healthyActor);
    await runtime.start({ headless: true });

    const taskArtifact: Artifact = {
      id: randomUUID(),
      type: 'task',
      content: 'Task content for failure isolation test',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      parentIds: [],
    };
    store.put(taskArtifact);

    const healthyDone = runtime.bus.waitFor((e) => e.topic === 'review.completed', 10000);
    const failedEvent = runtime.bus.waitFor(
      (e) => e.topic === 'actor.failed' && e.source === 'failing-summarizer',
      10000
    );

    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'work.start',
      source: 'tester',
      artifactId: taskArtifact.id,
      timestamp: new Date().toISOString(),
    });

    await Promise.all([healthyDone, failedEvent]);
    await runtime.waitForIdle();

    siblingSucceeded = store.findByType('review').length === 1;
    failureDetected = store.findByType('summary').length === 0;

    assert.ok(siblingSucceeded, 'Healthy sibling actor must complete successfully');
    assert.ok(failureDetected, 'Failed actor must not produce artifact');

    await runtime.stop();
    server.close();
  });

  // =========================================================================
  // 7. Retry / eventual activation: 실패했던 입력이 나중에 생성되었을 때 필요한 Actor가 활성화된다.
  // =========================================================================
  await test('7. Retry / Eventual Activation: Downstream join actor activates after delayed retry succeeds', async () => {
    const port = nextPort();
    const server = startDemoServer(port);
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });
    const correlationId = randomUUID();

    // Join actor waiting for both 'partA' and 'partB'
    const joinActor = new FunctionActor({
      id: 'join-collector',
      gate: new JoinGate({
        topics: ['part.created'],
        requiredTypes: ['partA', 'partB'],
      }),
      outputType: 'aggregated',
      outputTopic: 'aggregated.done',
      fn: (inputs) => `Joined: ${inputs.map((i) => i.content).join(' + ')}`,
    });

    runtime.register(joinActor);
    await runtime.start({ headless: true });

    // Step 1: Part A succeeds
    const partA: Artifact = {
      id: randomUUID(),
      type: 'partA',
      content: 'Data A',
      createdBy: 'workerA',
      createdAt: new Date().toISOString(),
      parentIds: [],
      metadata: { correlationId },
    };
    store.put(partA);
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'part.created',
      source: 'workerA',
      artifactId: partA.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });
    await runtime.waitForIdle();

    // Join actor should NOT be activated yet
    assert.equal(store.findByType('aggregated').length, 0);

    // Step 2: Part B fails first (simulated by emitting an actor.failed or doing nothing)
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'actor.failed',
      source: 'workerB',
      correlationId,
      timestamp: new Date().toISOString(),
    });
    await runtime.waitForIdle();
    assert.equal(store.findByType('aggregated').length, 0);

    // Step 3: Part B is retried and SUCCEEDS!
    const partB: Artifact = {
      id: randomUUID(),
      type: 'partB',
      content: 'Data B (Retried)',
      createdBy: 'workerB',
      createdAt: new Date().toISOString(),
      parentIds: [],
      metadata: { correlationId },
    };
    store.put(partB);

    const aggDone = runtime.bus.waitFor((e) => e.topic === 'aggregated.done', 5000);
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'part.created',
      source: 'workerB',
      artifactId: partB.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });

    await aggDone;
    await runtime.waitForIdle();

    const aggResults = store.findByType('aggregated');
    assert.equal(aggResults.length, 1, 'Join actor must activate eventually once missing input arrives');
    assert.ok(aggResults[0].content.includes('Data A + Data B (Retried)'));

    await runtime.stop();
    server.close();
  });

  // =========================================================================
  // 8. Lineage: 최종 Artifact에서 입력 Artifact들의 관계를 추적할 수 있다.
  // =========================================================================
  await test('8. Lineage: ArtifactStore tracks full ancestor tree and dependency relationships', async () => {
    const store = new ArtifactStore(':memory:');

    // Root doc
    const rootDoc: Artifact = {
      id: 'doc-001',
      type: 'document',
      content: 'Root document',
      createdBy: 'user',
      createdAt: '2026-01-01T00:00:00Z',
      parentIds: [],
    };
    store.put(rootDoc);

    // Reviewer and Summarizer both derive from rootDoc
    const review: Artifact = {
      id: 'rev-001',
      type: 'review',
      content: 'Review of root document',
      createdBy: 'reviewer',
      createdAt: '2026-01-01T00:01:00Z',
      parentIds: [rootDoc.id],
    };
    store.put(review);

    const summary: Artifact = {
      id: 'sum-001',
      type: 'summary',
      content: 'Summary of root document',
      createdBy: 'summarizer',
      createdAt: '2026-01-01T00:01:10Z',
      parentIds: [rootDoc.id],
    };
    store.put(summary);

    // Critic derives from review
    const critique: Artifact = {
      id: 'crit-001',
      type: 'critique',
      content: 'Critique of review',
      createdBy: 'critic',
      createdAt: '2026-01-01T00:02:00Z',
      parentIds: [review.id],
    };
    store.put(critique);

    // Final artifact aggregates review, summary, and critique
    const finalArt: Artifact = {
      id: 'fin-001',
      type: 'final',
      content: 'Final synthesized proposal',
      createdBy: 'refiner',
      createdAt: '2026-01-01T00:03:00Z',
      parentIds: [review.id, summary.id, critique.id],
    };
    store.put(finalArt);

    // Query lineage tree
    const lineageTree = store.getLineage(finalArt.id);
    assert.equal(lineageTree.artifact.id, 'fin-001');
    assert.equal(lineageTree.parents.length, 3);

    // Query flat ancestors
    const ancestors = store.getAncestors(finalArt.id);
    const ancestorIds = ancestors.map((a) => a.id);
    assert.ok(ancestorIds.includes('rev-001'));
    assert.ok(ancestorIds.includes('sum-001'));
    assert.ok(ancestorIds.includes('crit-001'));
    assert.ok(ancestorIds.includes('doc-001'));

    // Query children of rootDoc
    const childrenOfRoot = store.findByParentId('doc-001');
    const childIds = childrenOfRoot.map((c) => c.id);
    assert.equal(childrenOfRoot.length, 2);
    assert.ok(childIds.includes('rev-001'));
    assert.ok(childIds.includes('sum-001'));
  });

  // =========================================================================
  // Test A — Join Identity: Two independent workflow instances must not mix
  // =========================================================================
  await test('Test A — Join Identity: Disjoint workflow instances are never cross-joined', async () => {
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    const collectedFinals: { correlationId: string; inputIds: string[] }[] = [];

    // Refiner using the new CorrelationJoinResolver
    const refiner = new FunctionActor({
      id: 'strict-refiner',
      activation: {
        trigger: (e) => ['review.done', 'summary.done', 'critique.done'].includes(e.topic),
        resolver: new CorrelationJoinResolver({
          requiredTypes: ['review', 'summary', 'critique'],
          requireCorrelation: true,
        }),
      },
      outputType: 'final',
      outputTopic: 'final.done',
      fn: (inputs, ctx) => {
        collectedFinals.push({
          correlationId: ctx.event.correlationId!,
          inputIds: inputs.map((i) => i.id).sort(),
        });
        return `Final for ${ctx.event.correlationId}`;
      },
    });

    runtime.register(refiner);
    await runtime.start({ headless: true });

    // Setup Workflow 1
    const wf1 = 'workflow-1';
    const rev1: Artifact = { id: 'rev-1', type: 'review', content: 'R1', createdBy: 'u', createdAt: '2026-01-01T00:00:01Z', parentIds: [], metadata: { correlationId: wf1 } };
    const sum1: Artifact = { id: 'sum-1', type: 'summary', content: 'S1', createdBy: 'u', createdAt: '2026-01-01T00:00:02Z', parentIds: [], metadata: { correlationId: wf1 } };
    const crit1: Artifact = { id: 'crit-1', type: 'critique', content: 'C1', createdBy: 'u', createdAt: '2026-01-01T00:00:03Z', parentIds: [], metadata: { correlationId: wf1 } };

    // Setup Workflow 2
    const wf2 = 'workflow-2';
    const rev2: Artifact = { id: 'rev-2', type: 'review', content: 'R2', createdBy: 'u', createdAt: '2026-01-01T00:00:04Z', parentIds: [], metadata: { correlationId: wf2 } };
    const sum2: Artifact = { id: 'sum-2', type: 'summary', content: 'S2', createdBy: 'u', createdAt: '2026-01-01T00:00:05Z', parentIds: [], metadata: { correlationId: wf2 } };
    const crit2: Artifact = { id: 'crit-2', type: 'critique', content: 'C2', createdBy: 'u', createdAt: '2026-01-01T00:00:06Z', parentIds: [], metadata: { correlationId: wf2 } };

    store.put(rev1); store.put(sum1); store.put(crit1);
    store.put(rev2); store.put(sum2); store.put(crit2);

    // Publish interleaved events for both workflows
    const final1Done = runtime.bus.waitFor((e) => e.topic === 'final.done' && e.correlationId === wf1, 5000);
    const final2Done = runtime.bus.waitFor((e) => e.topic === 'final.done' && e.correlationId === wf2, 5000);

    await runtime.bus.publish({ id: randomUUID(), topic: 'review.done', source: 'u', artifactId: rev1.id, correlationId: wf1, timestamp: '1' });
    await runtime.bus.publish({ id: randomUUID(), topic: 'summary.done', source: 'u', artifactId: sum2.id, correlationId: wf2, timestamp: '2' });
    await runtime.bus.publish({ id: randomUUID(), topic: 'review.done', source: 'u', artifactId: rev2.id, correlationId: wf2, timestamp: '3' });
    await runtime.bus.publish({ id: randomUUID(), topic: 'critique.done', source: 'u', artifactId: crit1.id, correlationId: wf1, timestamp: '4' });
    await runtime.bus.publish({ id: randomUUID(), topic: 'summary.done', source: 'u', artifactId: sum1.id, correlationId: wf1, timestamp: '5' });
    await runtime.bus.publish({ id: randomUUID(), topic: 'critique.done', source: 'u', artifactId: crit2.id, correlationId: wf2, timestamp: '6' });

    await Promise.all([final1Done, final2Done]);
    await runtime.waitForIdle();

    assert.equal(collectedFinals.length, 2, 'Refiner should execute exactly once per workflow');

    const wf1Result = collectedFinals.find((f) => f.correlationId === wf1);
    const wf2Result = collectedFinals.find((f) => f.correlationId === wf2);

    assert.ok(wf1Result, 'Workflow 1 final must be produced');
    assert.ok(wf2Result, 'Workflow 2 final must be produced');

    // Strict validation: inputs must NOT mix between wf1 and wf2!
    assert.deepEqual(wf1Result.inputIds, ['crit-1', 'rev-1', 'sum-1'], 'Workflow 1 must only contain wf1 artifacts');
    assert.deepEqual(wf2Result.inputIds, ['crit-2', 'rev-2', 'sum-2'], 'Workflow 2 must only contain wf2 artifacts');

    await runtime.stop();
  });

  // =========================================================================
  // Test B — Duplicate Events: Redundant events do not trigger duplicate executions
  // =========================================================================
  await test('Test B — Duplicate Events: Redundant notifications trigger execution exactly once', async () => {
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });
    let executionCount = 0;

    const actor = new FunctionActor({
      id: 'idempotent-joiner',
      activation: {
        trigger: (e) => e.topic === 'part.done',
        resolver: new CorrelationJoinResolver({ requiredTypes: ['A', 'B'] }),
      },
      outputType: 'joined',
      outputTopic: 'joined.done',
      fn: () => {
        executionCount++;
        return 'done';
      },
    });

    runtime.register(actor);
    await runtime.start({ headless: true });

    const corrId = 'wf-dup';
    const a: Artifact = { id: 'art-A', type: 'A', content: 'A', createdBy: 'u', createdAt: '1', parentIds: [], metadata: { correlationId: corrId } };
    const b: Artifact = { id: 'art-B', type: 'B', content: 'B', createdBy: 'u', createdAt: '2', parentIds: [], metadata: { correlationId: corrId } };
    store.put(a);
    store.put(b);

    const donePromise = runtime.bus.waitFor((e) => e.topic === 'joined.done', 5000);

    // Fire duplicate events repeatedly
    for (let i = 0; i < 3; i++) {
      await runtime.bus.publish({ id: randomUUID(), topic: 'part.done', source: 'u', artifactId: a.id, correlationId: corrId, timestamp: '1' });
      await runtime.bus.publish({ id: randomUUID(), topic: 'part.done', source: 'u', artifactId: b.id, correlationId: corrId, timestamp: '2' });
    }

    await donePromise;
    await runtime.waitForIdle();

    assert.equal(executionCount, 1, 'Actor should execute exactly once despite 6 redundant events');

    await runtime.stop();
  });

  // =========================================================================
  // Test C — Concurrent Completion: Simultaneous events race safely
  // =========================================================================
  await test('Test C — Concurrent Completion: Simultaneous completion events execute Join exactly once', async () => {
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });
    let executionCount = 0;

    const actor = new FunctionActor({
      id: 'concurrent-joiner',
      activation: {
        trigger: (e) => e.topic === 'comp.done',
        resolver: new CorrelationJoinResolver({ requiredTypes: ['X', 'Y', 'Z'] }),
      },
      outputType: 'final-concurrent',
      outputTopic: 'concurrent.done',
      fn: async () => {
        executionCount++;
        // Introduce small async tick to simulate real processing time
        await new Promise((r) => setTimeout(r, 20));
        return 'concurrent done';
      },
    });

    runtime.register(actor);
    await runtime.start({ headless: true });

    const corrId = 'wf-concurrent';
    const x: Artifact = { id: 'art-X', type: 'X', content: 'X', createdBy: 'u', createdAt: '1', parentIds: [], metadata: { correlationId: corrId } };
    const y: Artifact = { id: 'art-Y', type: 'Y', content: 'Y', createdBy: 'u', createdAt: '2', parentIds: [], metadata: { correlationId: corrId } };
    const z: Artifact = { id: 'art-Z', type: 'Z', content: 'Z', createdBy: 'u', createdAt: '3', parentIds: [], metadata: { correlationId: corrId } };
    store.put(x); store.put(y); store.put(z);

    const donePromise = runtime.bus.waitFor((e) => e.topic === 'concurrent.done', 5000);

    // Fire all three completion events in parallel in the exact same tick
    await Promise.all([
      runtime.bus.publish({ id: randomUUID(), topic: 'comp.done', source: 'u', artifactId: x.id, correlationId: corrId, timestamp: '1' }),
      runtime.bus.publish({ id: randomUUID(), topic: 'comp.done', source: 'u', artifactId: y.id, correlationId: corrId, timestamp: '2' }),
      runtime.bus.publish({ id: randomUUID(), topic: 'comp.done', source: 'u', artifactId: z.id, correlationId: corrId, timestamp: '3' }),
    ]);

    await donePromise;
    await runtime.waitForIdle();

    assert.equal(executionCount, 1, 'Concurrent join triggers must be deduplicated via atomic claim');

    await runtime.stop();
  });

  // =========================================================================
  // Test D — Actor Input Contract: Actor receives pre-resolved input artifacts
  // =========================================================================
  await test('Test D — Actor Input Contract: Actor receives resolved inputs without querying store', async () => {
    const store = new ArtifactStore(':memory:');
    const runtime = new WebActorRuntime({ store });

    let receivedInputs: Artifact[] = [];
    let receivedEventTopic = '';

    const actor = new FunctionActor({
      id: 'contract-actor',
      activation: {
        trigger: (e) => e.topic === 'input.trigger',
        resolver: new SingleArtifactResolver({ types: ['report'] }),
      },
      outputType: 'ack',
      outputTopic: 'contract.done',
      fn: (inputs, ctx) => {
        // Actor only interacts with inputs given directly in ctx
        receivedInputs = inputs;
        receivedEventTopic = ctx.event.topic;
        return 'acknowledged';
      },
    });

    runtime.register(actor);
    await runtime.start({ headless: true });

    const report: Artifact = {
      id: 'rep-999',
      type: 'report',
      content: 'Important contract report',
      createdBy: 'analyst',
      createdAt: new Date().toISOString(),
      parentIds: [],
    };
    store.put(report);

    const donePromise = runtime.bus.waitFor((e) => e.topic === 'contract.done', 5000);
    await runtime.bus.publish({
      id: randomUUID(),
      topic: 'input.trigger',
      source: 'analyst',
      artifactId: report.id,
      timestamp: new Date().toISOString(),
    });

    await donePromise;
    await runtime.waitForIdle();

    assert.equal(receivedInputs.length, 1);
    assert.equal(receivedInputs[0].id, 'rep-999');
    assert.equal(receivedInputs[0].type, 'report');
    assert.equal(receivedInputs[0].content, 'Important contract report');
    assert.equal(receivedEventTopic, 'input.trigger');

    await runtime.stop();
  });

  console.log('\n=============================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('=============================================================\n');


  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
