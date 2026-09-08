export type Event = {
  id: string;
  topic: string;
  source: string;
  artifactId?: string;
  payload?: unknown;
  timestamp: string;
  correlationId?: string;
};

export type Artifact = {
  id: string;
  type: string;
  content: string;
  createdBy: string;
  createdAt: string;
  parentIds: string[];
  metadata?: Record<string, unknown>;
};

export type LineageNode = {
  artifact: Artifact;
  parents: LineageNode[];
};

// ============================================================================
// Primitives for Activation and Input Resolution
// ============================================================================

export type Trigger = (event: Event) => boolean;

export type InputSet = {
  inputs: Artifact[];
  correlationId?: string;
  rootId?: string;
};

export type ResolutionResult =
  | {
      ready: true;
      inputSet: InputSet;
      reason: string;
    }
  | {
      ready: false;
      reason: string;
    };

export interface InputResolver {
  resolve(event: Event, store: any): Promise<ResolutionResult> | ResolutionResult;
}

export interface ActivationSpec {
  trigger?: Trigger;
  resolver: InputResolver;
}

// Backward compatibility Gate types
export type GateDecision = {
  activate: boolean;
  reason: string;
  matchedArtifactIds?: string[];
};

export interface GateContext {
  store: any; // ArtifactStore
}

export interface ActivationGate {
  decide(event: Event, context: GateContext): Promise<GateDecision> | GateDecision;
}

export interface ActorContext {
  event: Event;
  inputs: Artifact[];
  store: any; // ArtifactStore
  bus: any; // EventBus
  browser: any; // BrowserRuntime
}

export interface Actor {
  readonly id: string;
  readonly activation: ActivationSpec;
  execute(ctx: ActorContext): Promise<Artifact | void>;
}


