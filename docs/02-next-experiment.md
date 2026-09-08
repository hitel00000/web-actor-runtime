# Web Actor Runtime — Next Architecture Experiment

## 1. Context

The current Web Actor Runtime has successfully demonstrated that a useful workflow can emerge without a central workflow orchestrator.

The current experiment implements four Web Actors:

```text
                    Seed Document
                         │
                  artifact.created
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
         Reviewer                 Summarizer
             │                       │
      review.completed        summary.completed
             │                       │
             ▼                       │
          Critic                     │
             │                       │
      critique.completed             │
             │                       │
             └───────────┬───────────┘
                         ▼
                      Refiner
                         │
                         ▼
                   Final Artifact
```

The workflow is driven by:

- Actor
- Activation Gate
- Event Bus
- Artifact Store
- Browser Runtime

The current implementation has also passed the eight integration experiments:

1. Broadcast
2. Selective Activation
3. Independent Execution
4. Chained Activation
5. Join / Aggregation
6. Failure Isolation
7. Retry / Eventual Activation
8. Lineage

The purpose of this next experiment is **not to add more features**.

The purpose is to determine whether the current abstractions represent the correct runtime primitives.

---

# 2. Current Architecture

The current implementation roughly follows:

```text
Event
  │
  ▼
WebActorRuntime
  │
  ├── Actor A
  │      └── Gate.decide()
  │
  ├── Actor B
  │      └── Gate.decide()
  │
  └── Actor C
         └── Gate.decide()
              │
              ▼
          ArtifactStore
              │
              ▼
        matchedArtifactIds
              │
              ▼
            Actor
```

An `ActivationGate` currently has the form:

```ts
interface ActivationGate {
  decide(
    event: Event,
    context: GateContext
  ): Promise<GateDecision> | GateDecision;
}
```

and the decision may contain:

```ts
interface GateDecision {
  activate: boolean;
  reason: string;
  matchedArtifactIds?: string[];
}
```

This means the Gate can currently perform several logically different jobs:

1. Determine whether an event is relevant.
2. Inspect the Artifact Store.
3. Resolve input Artifacts.
4. Determine whether a Join condition is satisfied.
5. Prevent duplicate activation.

The current `JoinGate` performs all of these.

The Runtime then takes `matchedArtifactIds` and resolves the actual Artifact objects before invoking the Actor.

---

# 3. The Problem to Investigate

The implementation revealed an important architectural tension.

A Join requires at least two distinct questions:

### Question A — Activation

> Is this Actor ready to execute?

For example:

```text
review exists
summary exists
critique exists
        ↓
     activate
```

### Question B — Input Resolution

> Which exact Artifacts constitute the inputs for this execution?

For example:

```text
review #17
summary #21
critique #23
        ↓
     inputs[]
```

The current `JoinGate` answers both questions.

This creates several consequences.

### 3.1 Gate becomes Store-aware

The Gate is no longer merely an event filter.

It becomes a query over the Artifact Store.

### 3.2 Gate becomes stateful

The current Join implementation contains a deduplication set:

```ts
private triggeredCombinations = new Set<string>();
```

This means activation history is maintained inside the Gate instance.

### 3.3 Activation and execution identity become coupled

The Gate determines a particular combination of Artifact IDs and uses that combination as an idempotency key.

### 3.4 Runtime depends on Gate-specific semantics

The generic Runtime understands `matchedArtifactIds`, even though input resolution is conceptually specific to some kinds of Gate.

---

# 4. Core Question

Investigate the following question:

> **Is Activation Gate actually one primitive, or are several independent concerns currently hiding inside it?**

Do not assume the answer.

The goal of this experiment is to discover the smallest useful set of runtime primitives.

---

# 5. Candidate Decomposition

Consider, but do not blindly implement, the following possible decomposition:

```text
Event
  │
  ▼
Activation Condition
  │
  │ "Should this Actor wake?"
  ▼
Input Resolver
  │
  │ "Which Artifacts should it receive?"
  ▼
Activation / Execution
  │
  ▼
Actor
```

Separately:

```text
Execution
  │
  ▼
Execution Identity / Idempotency
```

And outside the execution mechanism:

```text
Governance
  ├── Observability
  ├── Timeout
  ├── Deadlock detection
  ├── Retry policy
  └── Compensation
```

These are **hypotheses, not requirements**.

The implementation should determine whether this decomposition is actually better than the current model.

---

# 6. Required Experiment

Refactor the runtime enough to make the following workflow possible:

```text
                    Document
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
         Reviewer    Summarizer   Critic
             │          │          │
             └──────────┼──────────┘
                        ▼
                     Refiner
                        │
                        ▼
                       Final
```

The important constraint remains:

> No Actor directly invokes another Actor.

No central workflow should contain:

```ts
await reviewer.execute();
await summarizer.execute();
await critic.execute();
await refiner.execute();
```

The workflow must continue to emerge from Events, Artifact state, and Actor activation.

---

# 7. Investigate Activation vs Input Resolution

The new implementation should make it possible to express a Join conceptually as:

```text
Refiner becomes eligible when:

review exists
AND
summary exists
AND
critique exists
```

and separately determine:

```text
Refiner inputs:

[
  review,
  summary,
  critique
]
```

Determine where this responsibility belongs.

Possible designs include:

### Design A — Keep them together

```text
Gate.decide()
    ↓
activate + matched inputs
```

### Design B — Split condition and resolution

```text
Condition
    ↓
eligible
    ↓
Resolver
    ↓
inputs
```

### Design C — Treat the Join itself as an activation specification

```text
ActivationSpec
 ├── condition
 ├── input selection
 └── execution identity
```

Other designs are welcome.

Do not select a design because it appears architecturally elegant.

Select it based on whether it makes the actual runtime simpler and more composable.

---

# 8. Investigate Idempotency

The current `JoinGate` uses:

```text
combination of Artifact IDs
        ↓
deduplication key
        ↓
Set<string>
```

This prevents:

```text
review.completed
summary.completed
critique.completed
```

arriving close together from causing the same Join to execute multiple times.

However, this raises an important question:

> Is idempotency a property of a Gate, an Activation, an Actor execution, or the Runtime?

Investigate this explicitly.

The final design should answer:

- What uniquely identifies an Actor execution?
- Can the same Actor execute twice for the same input set?
- Where is that prevented?
- Does the protection survive multiple events?
- Does it survive Runtime restart?
- Is in-memory deduplication sufficient for the current Runtime?
- If not, what is the smallest persistent representation required?

Do not build distributed idempotency infrastructure.

The purpose is to identify the correct conceptual boundary.

---

# 9. Investigate Artifact Selection Semantics

The current Join implementation selects the latest Artifact for each required type.

This is potentially dangerous.

For example:

```text
review A
summary A
critique A

review B
summary B
critique B
```

A naive "latest Artifact of each type" query could produce:

```text
review B
summary A
critique B
```

which is not a valid logical Join.

The next design should make Artifact matching semantics explicit.

Investigate how the Runtime should express:

```text
same correlation
same root
same parent
same workflow instance
same generation
```

Do not immediately introduce a large workflow/DAG language.

Find the smallest representation that prevents invalid joins.

---

# 10. Lineage and Correlation

The current system has both:

```text
parentIds
```

and:

```text
metadata.correlationId
```

The experiment should determine what each represents.

At minimum, distinguish conceptually between:

### Lineage

> What produced this Artifact?

Example:

```text
Document
   ↓
Review
   ↓
Critique
```

### Correlation

> Which logical execution/workflow instance does this Artifact belong to?

Example:

```text
Workflow #42
├── Review
├── Summary
└── Critique
```

Do not assume that `parentIds` and `correlationId` can substitute for each other.

---

# 11. Actor Contract

Preserve the useful property of the current Actor abstraction:

```ts
Actor.execute(context)
```

should receive resolved inputs rather than needing to know how those inputs were discovered.

The Actor should not need to perform generic Store queries such as:

```ts
store.findByType(...)
store.findByCorrelationId(...)
```

just to reconstruct its activation inputs.

If the experiment determines that this is unavoidable, document why.

---

# 12. Event Bus

Keep the Event Bus simple.

The current Event Bus already provides:

- topic subscription
- wildcard subscription
- asynchronous handler execution
- failure isolation
- event waiting for tests

Do not turn the Event Bus into a workflow engine.

The Event Bus should remain responsible for:

> delivering notifications about state changes.

It should not become responsible for:

- task planning
- Actor scheduling policy
- Artifact querying
- Join resolution
- compensation
- workflow state machines

unless the experiment demonstrates a compelling reason.

---

# 13. Runtime

The Runtime should remain deliberately small.

Its fundamental responsibility is approximately:

```text
Event
  ↓
discover interested Actors
  ↓
evaluate activation
  ↓
resolve execution
  ↓
invoke Actor
```

The exact decomposition should be determined by the experiment.

The Runtime should not become a central workflow orchestrator.

In particular, do not introduce an API where callers describe:

```text
A → B → C → D
```

as the primary mechanism for workflow execution.

---

# 14. Governance Is a Separate Question

The previous experiment revealed several concerns:

### Observability

It is difficult to answer:

> Why has Refiner not executed yet?

without inspecting Event and Artifact history.

### Timeout

A Join can wait indefinitely if one required Artifact never arrives.

### Failure recovery

A permanently failed Actor can leave downstream Actors waiting forever.

### Compensation

There is currently no explicit mechanism for invalidating or compensating already-produced Artifacts.

These are important, but **do not implement them in this experiment**.

Instead, determine whether they naturally belong to a separate layer:

```text
                 Governance
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
 Observability    Timeout      Recovery
                     │
                     ▼
             Web Actor Runtime
```

The Runtime experiment should establish whether this separation makes sense.

---

# 15. Existing Tests Must Continue to Pass

The existing eight integration tests are part of the contract.

They must continue to pass after the architectural changes:

1. Broadcast
2. Selective Activation
3. Independent Execution
4. Chained Activation
5. Join / Aggregation
6. Failure Isolation
7. Retry / Eventual Activation
8. Lineage

If a test must change because its assumptions are proven to be wrong, do not simply modify the test to make it pass.

Explain:

1. What assumption was wrong.
2. Why the new behavior is more correct.
3. What invariant replaces the old assumption.

---

# 16. Add Focused Tests for the New Questions

Add tests for the architectural questions discovered above.

At minimum:

### Test A — Join identity

Two independent workflow instances containing the same Artifact types must not be accidentally joined.

```text
Workflow A:
  review A
  summary A
  critique A

Workflow B:
  review B
  summary B
  critique B
```

The Refiner must produce:

```text
Final A = {review A, summary A, critique A}
Final B = {review B, summary B, critique B}
```

and never a mixed combination.

### Test B — Duplicate events

Repeated completion events for the same Artifact combination must not cause duplicate execution.

### Test C — Concurrent completion

If required Artifacts become available almost simultaneously, the Join must execute exactly once.

### Test D — Actor input contract

The Actor should receive exactly the resolved input set determined by the Runtime's activation mechanism.

---

# 17. Do Not Implement Yet

Do not implement:

- LLM-based Gate
- LLM Planner
- distributed Event Bus
- vector database
- long-term memory
- workflow DSL
- microservices
- persistent distributed locking
- sophisticated scheduling
- Saga framework
- compensation framework
- timeout/deadlock subsystem
- production observability stack

These may become future experiments.

---

# 18. Architectural Freedom

The current implementation is experimental.

You may:

- rename abstractions
- split abstractions
- merge abstractions
- change interfaces
- move responsibilities between modules
- remove abstractions that are no longer useful
- rewrite implementation code

Do not preserve an abstraction merely because it already exists.

Conversely, do not introduce an abstraction merely because it is theoretically clean.

Prefer the smallest model that explains the behavior we have actually observed.

---

# 19. Success Criteria

This experiment is successful if, after implementation:

### 1.

Join activation and input selection have a clear conceptual relationship.

### 2.

Idempotency has a clearly defined owner.

### 3.

Artifact matching cannot accidentally combine unrelated workflow instances.

### 4.

Actors remain unaware of other Actors.

### 5.

The Event Bus remains a simple notification mechanism.

### 6.

The Runtime does not become a central workflow script.

### 7.

The resulting abstraction is simpler or more expressive than the current `Gate → matchedArtifactIds → Runtime → Actor` model.

### 8.

All existing behavioral guarantees remain intact.

---

# 20. Required Final Report

After implementation, do not report only that tests pass.

Produce a short architectural report with these sections:

## Current Model

Describe the resulting primitive model.

## What Changed

Describe the important changes from the previous implementation.

## Why

Explain why each changed boundary exists.

## What Became Simpler

Identify responsibilities that became clearer or smaller.

## What Became Harder

Identify new complexity introduced by the new model.

## Important Discoveries

Describe anything learned that was not obvious before implementation.

## Rejected Alternatives

Mention important alternative designs considered and why they were rejected.

## Governance Boundary

Explain which concerns belong outside the core Runtime.

## Remaining Questions

List the questions that should become future experiments.

---

# 21. Most Important Instruction

Do not optimize for completing a predefined list of coding tasks.

**Optimize for discovering the correct conceptual model.**

If the experiment shows that the current Gate abstraction is already the right abstraction, keep it.

If it shows that Gate should be split, split it.

If it shows that the proposed decomposition is wrong, discard it.

The goal is not:

> "Implement Activation Condition + Input Resolver."

The goal is:

> **"Determine what the minimal primitives of a decentralized Web Actor Runtime actually are."**