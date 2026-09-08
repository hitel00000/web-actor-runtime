import { randomUUID } from 'node:crypto';
import type { Actor, ActorContext, ActivationGate, ActivationSpec, Artifact } from './types.js';
import { DemoChatAdapter, type WebAdapter } from './adapter.js';
import { activationSpecFromGate } from './gate.js';

export interface WebActorOptions {
  id: string;
  activation?: ActivationSpec;
  gate?: ActivationGate;
  url: string;
  profile?: string;
  adapter?: WebAdapter;
  outputType: string;
  outputTopic: string;
  buildPrompt: (inputs: Artifact[], context: ActorContext) => string;
}

export class WebActor implements Actor {
  readonly id: string;
  readonly activation: ActivationSpec;
  readonly url: string;
  readonly profile: string;
  readonly adapter: WebAdapter;
  readonly outputType: string;
  readonly outputTopic: string;
  readonly buildPrompt: (inputs: Artifact[], context: ActorContext) => string;

  constructor(options: WebActorOptions) {
    this.id = options.id;
    if (options.activation) {
      this.activation = options.activation;
    } else if (options.gate) {
      this.activation = activationSpecFromGate(options.gate);
    } else {
      throw new Error(`Actor '${options.id}' must provide either 'activation' or 'gate'.`);
    }

    this.url = options.url;
    this.profile = options.profile ?? options.id;
    this.adapter = options.adapter ?? new DemoChatAdapter();
    this.outputType = options.outputType;
    this.outputTopic = options.outputTopic;
    this.buildPrompt = options.buildPrompt;
  }

  // Backwards compatibility
  get gate(): ActivationGate | undefined {
    return (this.activation as any)?.gate;
  }

  async execute(ctx: ActorContext): Promise<Artifact> {
    console.log(
      `[Actor:${this.id}] Activated by event '${ctx.event.topic}'. Inputs: [${ctx.inputs.map((i) => `${i.type}:${i.id}`).join(', ')}]`
    );

    const page = await ctx.browser.page(this.profile);
    await this.adapter.open(page, this.url);

    const prompt = this.buildPrompt(ctx.inputs, ctx);
    await this.adapter.send(page, prompt);
    const response = await this.adapter.waitForResponse(page);

    const correlationId =
      ctx.event.correlationId ??
      (ctx.inputs[0]?.metadata?.correlationId as string | undefined) ??
      randomUUID();

    const parentIds = ctx.inputs.map((a) => a.id);

    const artifact: Artifact = {
      id: randomUUID(),
      type: this.outputType,
      content: response,
      createdBy: this.id,
      createdAt: new Date().toISOString(),
      parentIds,
      metadata: {
        correlationId,
        inputTopic: ctx.event.topic,
        sourceInputs: parentIds,
      },
    };

    ctx.store.put(artifact);
    console.log(`[Actor:${this.id}] Created ${artifact.type} artifact ${artifact.id}`);

    await ctx.bus.publish({
      id: randomUUID(),
      topic: this.outputTopic,
      source: this.id,
      artifactId: artifact.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });

    return artifact;
  }
}

export interface FunctionActorOptions {
  id: string;
  activation?: ActivationSpec;
  gate?: ActivationGate;
  outputType: string;
  outputTopic: string;
  fn: (inputs: Artifact[], context: ActorContext) => Promise<string> | string;
}

export class FunctionActor implements Actor {
  readonly id: string;
  readonly activation: ActivationSpec;
  readonly outputType: string;
  readonly outputTopic: string;
  readonly fn: (inputs: Artifact[], context: ActorContext) => Promise<string> | string;

  constructor(options: FunctionActorOptions) {
    this.id = options.id;
    if (options.activation) {
      this.activation = options.activation;
    } else if (options.gate) {
      this.activation = activationSpecFromGate(options.gate);
    } else {
      throw new Error(`Actor '${options.id}' must provide either 'activation' or 'gate'.`);
    }

    this.outputType = options.outputType;
    this.outputTopic = options.outputTopic;
    this.fn = options.fn;
  }

  get gate(): ActivationGate | undefined {
    return (this.activation as any)?.gate;
  }

  async execute(ctx: ActorContext): Promise<Artifact> {
    const response = await this.fn(ctx.inputs, ctx);

    const correlationId =
      ctx.event.correlationId ??
      (ctx.inputs[0]?.metadata?.correlationId as string | undefined) ??
      randomUUID();

    const parentIds = ctx.inputs.map((a) => a.id);

    const artifact: Artifact = {
      id: randomUUID(),
      type: this.outputType,
      content: response,
      createdBy: this.id,
      createdAt: new Date().toISOString(),
      parentIds,
      metadata: {
        correlationId,
        inputTopic: ctx.event.topic,
        sourceInputs: parentIds,
      },
    };

    ctx.store.put(artifact);

    await ctx.bus.publish({
      id: randomUUID(),
      topic: this.outputTopic,
      source: this.id,
      artifactId: artifact.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });

    return artifact;
  }
}

