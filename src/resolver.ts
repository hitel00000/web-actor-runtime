import type { Artifact, Event, InputResolver, InputSet, ResolutionResult, Trigger } from './types.js';
import type { ArtifactStore } from './store.js';

// ============================================================================
// Trigger Helpers (Fast Event Filters)
// ============================================================================

export function topicTrigger(...topics: string[]): Trigger {
  return (event: Event) => topics.includes(event.topic);
}

export function anyTrigger(): Trigger {
  return () => true;
}

// ============================================================================
// Single Artifact Resolver
// ============================================================================

export interface SingleArtifactResolverOptions {
  types?: string[];
  authors?: string[];
  metadataFilter?: (metadata: Record<string, unknown> | undefined) => boolean;
  lineageFilter?: (artifact: Artifact, store: ArtifactStore) => boolean;
}

export class SingleArtifactResolver implements InputResolver {
  constructor(private readonly options: SingleArtifactResolverOptions = {}) {}

  resolve(event: Event, store: ArtifactStore): ResolutionResult {
    if (!event.artifactId) {
      return { ready: false, reason: 'Event does not contain artifactId' };
    }

    const artifact = store.tryGet(event.artifactId);
    if (!artifact) {
      return { ready: false, reason: `Artifact '${event.artifactId}' not found in store` };
    }

    if (this.options.types && !this.options.types.includes(artifact.type)) {
      return {
        ready: false,
        reason: `Artifact type '${artifact.type}' not in [${this.options.types.join(', ')}]`,
      };
    }

    if (this.options.authors && !this.options.authors.includes(artifact.createdBy)) {
      return {
        ready: false,
        reason: `Artifact author '${artifact.createdBy}' not in [${this.options.authors.join(', ')}]`,
      };
    }

    if (this.options.metadataFilter && !this.options.metadataFilter(artifact.metadata)) {
      return { ready: false, reason: 'Artifact metadata filter condition not satisfied' };
    }

    if (this.options.lineageFilter && !this.options.lineageFilter(artifact, store)) {
      return { ready: false, reason: 'Artifact lineage filter condition not satisfied' };
    }

    const correlationId =
      event.correlationId ?? (artifact.metadata?.correlationId as string | undefined);

    return {
      ready: true,
      inputSet: {
        inputs: [artifact],
        correlationId,
      },
      reason: `Artifact '${artifact.id}' (${artifact.type}) matched criteria`,
    };
  }
}

// ============================================================================
// Correlation Join Resolver (Scoped by Correlation ID or Root Provenance)
// ============================================================================

export interface CorrelationJoinResolverOptions {
  requiredTypes: string[];
  /**
   * If true, artifacts must share the same correlationId.
   * Defaults to true to guarantee cross-workflow isolation.
   */
  requireCorrelation?: boolean;
}

export class CorrelationJoinResolver implements InputResolver {
  constructor(private readonly options: CorrelationJoinResolverOptions) {}

  resolve(event: Event, store: ArtifactStore): ResolutionResult {
    if (!event.artifactId) {
      return { ready: false, reason: 'Event does not contain artifactId' };
    }

    const triggerArtifact = store.tryGet(event.artifactId);
    if (!triggerArtifact) {
      return { ready: false, reason: `Artifact '${event.artifactId}' not found in store` };
    }

    const correlationId =
      event.correlationId ?? (triggerArtifact.metadata?.correlationId as string | undefined);

    const requireCorrelation = this.options.requireCorrelation !== false;

    if (requireCorrelation && !correlationId) {
      return {
        ready: false,
        reason: `Trigger artifact '${event.artifactId}' lacks correlationId; cannot join safely`,
      };
    }

    // Strictly scope candidate artifacts to the same correlation instance
    const candidates = correlationId
      ? store.findByCorrelationId(correlationId)
      : store.list();

    const matchedArtifacts: Artifact[] = [];
    const missingTypes: string[] = [];

    for (const reqType of this.options.requiredTypes) {
      // Find the latest artifact of the required type within this correlation instance
      const matches = candidates.filter((a) => a.type === reqType);
      if (matches.length > 0) {
        // Sort descending by created time
        matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        matchedArtifacts.push(matches[0]);
      } else {
        missingTypes.push(reqType);
      }
    }

    if (missingTypes.length > 0) {
      return {
        ready: false,
        reason: `Missing required types [${missingTypes.join(', ')}] in correlation '${correlationId ?? 'global'}'`,
      };
    }

    return {
      ready: true,
      inputSet: {
        inputs: matchedArtifacts,
        correlationId,
      },
      reason: `All required types [${this.options.requiredTypes.join(', ')}] are present for correlation '${correlationId}'`,
    };
  }
}
