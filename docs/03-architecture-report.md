# Web Actor Runtime — Architecture & Discovery Report

이 문서는 `draft.md` 및 `NEXT-EXPERIMENT.md`의 실험을 구현하며 발견한 아키텍처적 결론과 런타임 프리미티브 정립 과정을 기록한 최종 보고서입니다.

---

## 1. 핵심 질문과 결론

### 질문 1: 중앙 Orchestrator 없이도 복합 워크플로우가 자율적으로 구성되는가?
> **결론: 완벽하게 구성된다.**

- Actor들은 서로의 존재를 전혀 알지 못합니다.
- 선행 작업이 끝나 생성된 Artifact와 Event Bus의 알림만으로 후속 Actor가 자율적으로 깨어나며(Activation), 브로드캐스트(Broadcast), 연쇄 실행(Chained Activation), 다자간 수렴(Join/Aggregation)이 자연스럽게 창발됩니다.

### 질문 2: "Activation Gate"는 단일 프리미티브인가?
> **결론: 아니다. Gate 안에는 3가지의 서로 다른 관심사가 혼재되어 있었다.**

기존의 `JoinGate`는 하나의 클래스 안에 다음 3가지를 억지로 우겨넣고 있었습니다:
1. **Trigger (무상태 이벤트 필터)**: "이 이벤트가 이 액터와 관련이 있는가?"
2. **InputResolver (무상태 상태 투사)**: "현재 스토어에서 유효한 입력 세트가 완전히 모였는가?"
3. **ExecutionRegistry (멱등성 상태 관리자)**: "이 액터가 이 입력 조합으로 이미 실행되었는가?"

이 3가지를 분리함으로써 게이트의 내부 상태(`triggeredCombinations`)가 완전히 제거되었고, 런타임의 동시성 경쟁(Race condition)과 중복 이벤트 방어가 원자적으로 해결되었습니다.

---

## 2. 런타임 프리미티브 모델 (Runtime Primitives)

```text
Event
  │
  ▼
Trigger (Stateless Event Filter)
  │ "이 이벤트가 이 액터를 깨울 가능성이 있는가?" (토픽/발행처 거름망)
  ▼
InputResolver (Stateless State Projection)
  │ "현재 Store 상태에서 유효하고 온전한 입력 집합(InputSet)이 구성되는가?"
  ▼
ExecutionRegistry (Atomic Idempotency Coordinator)
  │ "이 액터가 이 입력 조합으로 이미 실행되었거나 실행 중인가?"
  ▼
Actor (Pure Execution Contract)
  │ "사전 해결된 inputs를 받아 브라우저/작업 실행"
```

| 프리미티브 | 책임 및 특성 | 구현체 |
| :--- | :--- | :--- |
| **`Trigger`** | Store를 조회하지 않는 순수 이벤트 레벨 필터 (`(event) => boolean`) | `topicTrigger(...)`, `anyTrigger()` |
| **`InputResolver`** | 현재 스토어 상태를 투사하여 유효한 `InputSet`을 결정론적으로 도출하는 무상태 컴포넌트 | `SingleArtifactResolver`, `CorrelationJoinResolver` |
| **`ExecutionRegistry`** | `${actorId}::${sortedInputIds}` 해시를 기반으로 실행의 유일성(Idempotency)과 라이프사이클(claimed -> completed/released)을 원자적으로 보장 | `ExecutionRegistry` |
| **`Actor`** | 입력 아티팩트가 어떻게 찾아졌는지 몰라도 됨. 주입된 `inputs: Artifact[]`만 가지고 비즈니스 로직(웹 조작) 수행 | `WebActor`, `FunctionActor` |
| **`ArtifactStore`** | 모든 산출물의 영속화 및 `parentIds` 기반 Lineage 트리 역추적 제공 | SQLite 기반 `ArtifactStore` |

---

## 3. 심층 발견 사항 (Key Discoveries)

### 3.1 Cross-Workflow 오염의 원인과 해결
- **문제**: 단순히 `findByType('review')`로 최신 아티팩트를 긁어오는 나이브한 조인은 여러 워크플로우 인스턴스가 동시에 실행될 때 A의 리뷰와 B의 요약이 엉뚱하게 결합되는 심각한 논리 오류를 유발합니다.
- **해결**: 조인 리졸버(`CorrelationJoinResolver`)는 반드시 동일한 상관관계(`correlationId`) 또는 동일한 루트 조상(`rootId`)을 공유하는 아티팩트 집합 내에서만 입력을 바인딩해야 합니다 (`Test A`로 검증).

### 3.2 멱등성(Idempotency)의 진정한 소유권
- 멱등성은 "게이트"나 "액터"의 속성이 아니라 **"액터 실행(Actor Execution)"의 속성**입니다.
- 이벤트가 동일 틱에 여러 개 동시에 날아올 때(`Test C`), 또는 동일 완료 이벤트가 네트워크/재시도로 반복 수신될 때(`Test B`), 런타임의 `ExecutionRegistry.claim()`이 단 1회만 선점하도록 보장함으로써 중복 실행이 원천 차단됩니다.

### 3.3 중앙 Orchestrator가 필요해지는 순간 (Governance Boundary)
런타임 자체는 오케스트레이터 없이도 100% 자율 동작하지만, 다음 운영 요구사항을 위해서는 런타임 외부에 별도의 **거버넌스 레이어(Governance Layer)**가 필요합니다:
1. **진행 가시성 (Observability)**: 전체 워크플로우 중 몇 단계가 완료되었는지 대시보드로 관측할 필요가 있을 때.
2. **조인 타임아웃 (Timeout & Deadlock Detection)**: 선행 액터 하나가 영구 다운되어 조인이 영원히 깨어나지 못할 때 이를 감지하고 대체 경로를 트리거할 감시자.
3. **보상 트랜잭션 (Saga / Compensation)**: 파이프라인 중도 실패 시 이미 생성된 선행 아티팩트를 무효화(Tombstone)할 필요가 있을 때.

---

## 4. Free-Tier Web LLM 오케스트레이션 적용 결과

이 런타임 모델은 **브라우저 전용 Free-Tier LLM(ChatGPT, Gemini, Claude)을 결합하는 수직 슬라이스**에 가장 적합한 아키텍처임이 입증되었습니다:
- **Persistent Context**: 사용자 로그인 세션(쿠키/스토리지)을 `.profiles/` 디렉토리에 영구 보존하여 캡차와 재로그인 회피.
- **Streaming Detection**: DOM 내 Mutation 변화 정지(2.5초 안정화) 및 'Copy' 버튼 출현을 감지하여 비동기 스트리밍 완료를 정확히 캡처.
- **비동기 수렴**: ChatGPT와 Gemini가 제각기 다른 속도로 텍스트를 스트리밍하더라도, 두 결과가 모두 도착하는 순간 Claude가 자동으로 활성화되어 종합 아키텍처 제안서(ADR)를 작성.
