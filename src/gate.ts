import type { Artifact, Event, GateContext, GateDecision, ActivationGate } from './types.js';

export class TopicGate implements ActivationGate {
  constructor(private readonly topics: string[]) {}

  decide(event: Event): GateDecision {
    const activate = this.topics.includes(event.topic);
    return {
      activate,
      reason: activate ? `Topic '${event.topic}' matched` : `Topic '${event.topic}' not in [${this.topics.join(', ')}]`,
      matchedArtifactIds: event.artifactId ? [event.artifactId] : [],
    };
  }
}

export interface ArtifactFilterOptions {
  topics?: string[];
  types?: string[];
  authors?: string[];
  metadataFilter?: (metadata: Record<string, unknown> | undefined) => boolean;
  lineageFilter?: (artifact: Artifact, context: GateContext) => boolean;
}

export class ArtifactFilterGate implements ActivationGate {
  constructor(private readonly options: ArtifactFilterOptions) {}

  decide(event: Event, context: GateContext): GateDecision {
    // 1. Topic check
    if (this.options.topics && !this.options.topics.includes(event.topic)) {
      return { activate: false, reason: `Topic '${event.topic}' does not match` };
    }

    if (!event.artifactId) {
      return { activate: false, reason: 'Event has no artifactId' };
    }

    const artifact: Artifact | undefined = context.store.tryGet(event.artifactId);
    if (!artifact) {
      return { activate: false, reason: `Artifact '${event.artifactId}' not found in store` };
    }

    // 2. Artifact Type check
    if (this.options.types && !this.options.types.includes(artifact.type)) {
      return {
        activate: false,
        reason: `Artifact type '${artifact.type}' not in [${this.options.types.join(', ')}]`,
      };
    }

    // 3. Artifact Author check
    if (this.options.authors && !this.options.authors.includes(artifact.createdBy)) {
      return {
        activate: false,
        reason: `Artifact author '${artifact.createdBy}' not in [${this.options.authors.join(', ')}]`,
      };
    }

    // 4. Metadata check
    if (this.options.metadataFilter && !this.options.metadataFilter(artifact.metadata)) {
      return { activate: false, reason: 'Artifact metadata filter condition not satisfied' };
    }

    // 5. Lineage check
    if (this.options.lineageFilter && !this.options.lineageFilter(artifact, context)) {
      return { activate: false, reason: 'Artifact lineage filter condition not satisfied' };
    }

    return {
      activate: true,
      reason: `Artifact '${artifact.id}' (type: ${artifact.type}) matched criteria`,
      matchedArtifactIds: [artifact.id],
    };
  }
}

export interface JoinGateOptions {
  topics?: string[];
  requiredTypes: string[];
  // If true, artifacts must share the same correlationId
  matchCorrelation?: boolean;
}

export class JoinGate implements ActivationGate {
  private triggeredCombinations = new Set<string>();

  constructor(private readonly options: JoinGateOptions) {}

  decide(event: Event, context: GateContext): GateDecision {
    if (this.options.topics && !this.options.topics.includes(event.topic)) {
      return { activate: false, reason: `Topic '${event.topic}' not monitored by JoinGate` };
    }

    if (!event.artifactId) {
      return { activate: false, reason: 'Event has no artifactId' };
    }

    const triggerArtifact = context.store.tryGet(event.artifactId);
    if (!triggerArtifact) {
      return { activate: false, reason: `Artifact '${event.artifactId}' not found` };
    }

    const correlationId =
      event.correlationId ?? (triggerArtifact.metadata?.correlationId as string | undefined);

    // Find candidate artifacts to satisfy the join
    let candidates: Artifact[] = [];
    if (correlationId && (this.options.matchCorrelation !== false)) {
      candidates = context.store.findByCorrelationId(correlationId);
    } else {
      // Fallback: search all artifacts in the store or ancestors
      candidates = context.store.list();
    }

    const matchedArtifacts: Artifact[] = [];
    const missingTypes: string[] = [];

    for (const reqType of this.options.requiredTypes) {
      // Pick the latest artifact matching this type
      const match = candidates
        .filter((a) => a.type === reqType)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      if (match) {
        matchedArtifacts.push(match);
      } else {
        missingTypes.push(reqType);
      }
    }

    if (missingTypes.length > 0) {
      return {
        activate: false,
        reason: `Waiting for remaining required artifact types: [${missingTypes.join(', ')}]`,
      };
    }

    // Deduplication key: combination of matched artifact IDs
    const comboKey = matchedArtifacts
      .map((a) => a.id)
      .sort()
      .join(':');

    if (this.triggeredCombinations.has(comboKey)) {
      return {
        activate: false,
        reason: `Combination [${comboKey}] already triggered`,
      };
    }

    this.triggeredCombinations.add(comboKey);

    return {
      activate: true,
      reason: `All required types [${this.options.requiredTypes.join(', ')}] are present`,
      matchedArtifactIds: matchedArtifacts.map((a) => a.id),
    };
  }

  reset(): void {
    this.triggeredCombinations.clear();
  }
}

export function activationSpecFromGate(gate: ActivationGate): import('./types.js').ActivationSpec {
  return {
    resolver: {
      async resolve(event: Event, store: any): Promise<import('./types.js').ResolutionResult> {
        const decision = await gate.decide(event, { store });
        if (!decision.activate) {
          return { ready: false, reason: decision.reason };
        }
        const matchedIds = decision.matchedArtifactIds ?? (event.artifactId ? [event.artifactId] : []);
        const inputs: Artifact[] = [];
        for (const id of matchedIds) {
          const art = store.tryGet(id);
          if (art) inputs.push(art);
        }
        return {
          ready: true,
          inputSet: {
            inputs,
            correlationId: event.correlationId ?? (inputs[0]?.metadata?.correlationId as string | undefined),
          },
          reason: decision.reason,
        };
      },
    },
  };
}


