import { randomUUID } from 'node:crypto';
import { EventBus } from './bus.js';
import { ArtifactStore } from './store.js';
import { BrowserRuntime } from './browser.js';
import { ExecutionRegistry } from './execution-registry.js';
import type { Actor, Artifact, Event } from './types.js';

export interface RuntimeOptions {
  bus?: EventBus;
  store?: ArtifactStore;
  browser?: any;
  executionRegistry?: ExecutionRegistry;
}

export class WebActorRuntime {
  readonly bus: EventBus;
  readonly store: ArtifactStore;
  readonly browser: any;
  readonly executionRegistry: ExecutionRegistry;

  private actors = new Map<string, Actor>();
  private running = false;
  private unsubscribeBus?: () => void;
  private activeExecutions = new Set<Promise<void>>();

  constructor(options?: RuntimeOptions) {
    this.bus = options?.bus ?? new EventBus();
    this.store = options?.store ?? new ArtifactStore();
    this.browser = options?.browser ?? new BrowserRuntime();
    this.executionRegistry = options?.executionRegistry ?? new ExecutionRegistry();
  }

  register(actor: Actor): this {
    if (this.actors.has(actor.id)) {
      throw new Error(`Actor '${actor.id}' is already registered.`);
    }
    this.actors.set(actor.id, actor);
    return this;
  }

  getActor(id: string): Actor | undefined {
    return this.actors.get(id);
  }

  async start(options?: { headless?: boolean }): Promise<void> {
    if (this.running) return;

    await this.browser.start(options?.headless ?? true);
    this.running = true;

    // Listen to all events and evaluate autonomous activations
    this.unsubscribeBus = this.bus.subscribe('*', async (event: Event) => {
      if (!this.running) return;

      for (const actor of this.actors.values()) {
        // 1. Self-trigger prevention: actors do not respond to their own outputs
        if (event.source === actor.id) {
          continue;
        }

        try {
          // 2. Trigger check: fast event-level filtering without touching the store
          if (actor.activation.trigger && !actor.activation.trigger(event)) {
            continue;
          }

          // 3. Input resolution: check eligibility and resolve concrete input artifacts
          const resolution = await actor.activation.resolver.resolve(event, this.store);
          if (!resolution.ready) {
            continue;
          }

          const { inputs } = resolution.inputSet;
          const inputIds = inputs.map((a) => a.id);

          // 4. Execution Idempotency check: centrally managed by ExecutionRegistry
          const claimed = this.executionRegistry.claim(actor.id, inputIds);
          if (!claimed) {
            // Already claimed or executed for this exact input set
            continue;
          }

          console.log(
            `[Runtime:Activation] Actor '${actor.id}' activated (${resolution.reason}) with inputs: [${inputs.map((i) => i.id).join(', ')}]`
          );

          // 5. Asynchronous, isolated execution
          const executionPromise = (async () => {
            try {
              await actor.execute({
                event,
                inputs,
                store: this.store,
                bus: this.bus,
                browser: this.browser,
              });
              this.executionRegistry.complete(actor.id, inputIds);
            } catch (err) {
              console.error(`[Runtime] Error executing actor '${actor.id}':`, err);
              // Release claim on transient error to allow eventual retry
              this.executionRegistry.release(actor.id, inputIds);

              await this.bus.publish({
                id: randomUUID(),
                topic: 'actor.failed',
                source: actor.id,
                artifactId: event.artifactId,
                correlationId: event.correlationId ?? resolution.inputSet.correlationId,
                payload: {
                  error: err instanceof Error ? err.message : String(err),
                  triggerEvent: event.id,
                  inputIds,
                },
                timestamp: new Date().toISOString(),
              });
            }
          })();

          this.activeExecutions.add(executionPromise);
          executionPromise.finally(() => {
            this.activeExecutions.delete(executionPromise);
          });
        } catch (err) {
          console.error(`[Runtime] Activation evaluation error for actor '${actor.id}':`, err);
        }
      }
    });

    console.log(`[WebActorRuntime] Started with ${this.actors.size} registered actor(s).`);
  }

  async waitForIdle(timeoutMs = 20000): Promise<void> {
    const startTime = Date.now();
    while (this.activeExecutions.size > 0) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for actors to become idle (${timeoutMs}ms)`);
      }
      await Promise.all(Array.from(this.activeExecutions));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = undefined;
    }
    await this.waitForIdle(5000).catch(() => undefined);
    await this.browser.stop().catch(() => undefined);
    console.log('[WebActorRuntime] Stopped.');
  }
}

