# Web Actor Runtime — Next Experiment

현재 프로젝트는 `web-actor-runtime-mvp`다.

지금까지 다음 실험까지 성공했다.

```text
Actor A
   │
   │ artifact.created
   ├──────────────┐
   ▼              ▼
 Gate B         Gate C
   │              │
 Actor B        Actor C
   │              │
 Artifact B    Artifact C
```

즉, 하나의 Actor가 만든 Artifact를 Event Bus를 통해 여러 독립적인 Actor가 동시에 받아 각각 작업하고 결과 Artifact를 생성하는 것까지 검증했다.

이제 이 프로젝트를 단순한 데모가 아니라 **작은 Web Actor Runtime의 실제 실험**으로 확장하라.

---

## 핵심 질문

이번 작업에서 검증하고 싶은 것은 이것이다.

> **중앙 Orchestrator가 Actor들의 작업 순서를 직접 지시하지 않아도, Actor + Gate + Event + Artifact만으로 복합적인 작업 흐름이 자연스럽게 구성되는가?**

이 질문을 코드로 실험하라.

---

## 중요한 구현 원칙

### 1. 현재 API를 보존하는 것이 목적이 아니다.

현재 `Actor`, `Gate`, `EventBus`, `ArtifactStore`, `BrowserRuntime`의 설계가 실험을 방해한다면 과감하게 수정하거나 재설계해도 된다.

현재 코드는 MVP이며 최종 아키텍처가 아니다.

### 2. 과도하게 일반화하지 않는다.

framework를 만드는 것이 목적이 아니다.

실제 실험을 구현하면서 반복적으로 등장하는 개념만 abstraction으로 승격하라.

### 3. 중앙 Workflow 코드를 만들지 않는다.

다음과 같은 코드는 이번 실험의 목표와 맞지 않는다.

```ts
await actorA.run();
await actorB.run();
await actorC.run();
await actorD.run();
```

Actor 간의 작업 순서를 중앙에서 명시하지 말라.

각 Actor는 자신이 관심 있는 Event를 Gate를 통해 판단하고 활성화되어야 한다.

---

# 구현할 실험

최소 4개의 서로 다른 Actor를 만든다.

예:

```text
                    Input Artifact
                          │
                   artifact.created
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
          Reviewer     Summarizer    Critic
             │            │            │
             ▼            ▼            ▼
        Review Artifact  Summary      Critique
             │            │            │
             └────────────┼────────────┘
                          ▼
                       Refiner
                          │
                          ▼
                    Final Artifact
```

중요한 것은 이 workflow를 중앙에서 정의하지 않는 것이다.

각 Actor는 다음과 같은 방식으로 독립적으로 동작해야 한다.

```text
Event
  ↓
Gate
  ↓
Actor activation
  ↓
Browser interaction
  ↓
Artifact creation
  ↓
Event
```

따라서 `Refiner`는 Reviewer/Summarizer/Critic을 직접 호출해서는 안 된다.

필요한 Artifact가 존재하고 해당 Event가 발생하면 자신의 Gate가 Refiner를 활성화하도록 구성한다.

---

# Gate

현재 Gate를 실제 activation filter로 발전시켜라.

Gate는 최소한 다음 정보를 이용해서 activation 여부를 결정할 수 있어야 한다.

- Event topic
- Artifact type
- Artifact author
- Artifact metadata
- parent/lineage 정보

예를 들어:

```text
Reviewer
  → document artifact에 관심

Summarizer
  → document artifact에 관심

Critic
  → review 또는 summary artifact에 관심

Refiner
  → review + summary + critique가 모두 준비되었을 때 관심
```

특히 Refiner의 경우 단일 Event 하나만 보고 실행하는 것이 아니라 필요한 입력 Artifact들이 모두 존재하는지를 판단할 수 있어야 한다.

---

# Artifact Lineage

Artifact 간의 관계를 명확하게 표현하라.

예:

```text
Artifact A
├── Review B
├── Summary C
└── Critique D
       │
       └────────┐
                ▼
           Final Artifact E
```

Artifact Store를 통해 lineage를 조회할 수 있어야 한다.

가능하다면 최종 Artifact에서 자신이 어떤 Artifact들로부터 만들어졌는지도 추적할 수 있게 하라.

---

# Failure Isolation

Actor 하나가 실패해도 다른 Actor들은 계속 실행되어야 한다.

예:

```text
Input
 ├── Reviewer   → SUCCESS
 ├── Summarizer → FAILURE
 ├── Critic     → SUCCESS
 └── Refiner    → WAIT
```

Refiner는 필요한 입력이 부족하므로 실행하지 않는다.

나중에 Summarizer가 성공하면 새로운 Artifact/Event가 발생하고 Refiner가 다시 activation될 수 있어야 한다.

즉 Event-driven system에서 **재시도와 eventual activation**이 자연스럽게 가능한 구조인지 실험하라.

---

# Browser Actor

실제 Actor의 작업은 Browser Runtime을 통해 수행한다.

현재 local demo web service를 계속 사용해도 된다.

가능하다면 Actor마다 서로 다른 역할을 가진 Web UI를 제공하라.

예:

```text
/reviewer
/summarizer
/critic
/refiner
```

Actor가 직접 서로의 내부 함수를 호출하지 않고 Browser Adapter를 통해 Web UI와 상호작용해야 한다.

---

# AI Actor

이 단계에서는 최소 하나의 Actor를 실제 AI Web UI와 연결하는 것도 고려하라.

단, 특정 서비스에 강하게 종속되는 구조를 만들지 말라.

목표는 특정 AI 서비스 integration이 아니다.

검증하려는 것은:

```text
Event
  ↓
Gate
  ↓
AI/Web Actor
  ↓
Browser
  ↓
Result
  ↓
Artifact
  ↓
Event
```

이라는 전체 loop가 실제로 성립하는가이다.

로그인, CAPTCHA 우회, 서비스 정책 우회 등은 구현하지 않는다.

실제 서비스 연결이 불필요하게 실험을 방해한다면 local mock으로 먼저 전체 구조를 검증하고 실제 서비스 연결은 최소한으로 유지한다.

---

# Event와 Artifact의 역할

다음 구분을 유지하라.

### Event

무언가 발생했음을 알리는 것.

```text
artifact.created
review.completed
```

### Artifact

작업의 결과 또는 공유 가능한 데이터.

```text
document
review
summary
critique
final
```

Actor 간에 거대한 메시지를 직접 전달하기보다 Event를 통해 Artifact를 발견하도록 하는 방향을 선호한다.

---

# Runtime 요구사항

최종적으로 다음과 같은 코드가 가능하면 좋다.

```ts
runtime.register(reviewer);
runtime.register(summarizer);
runtime.register(critic);
runtime.register(refiner);

await runtime.start();
```

그 이후 실제 workflow는 Runtime이 직접 정의하지 않아도 Actor들의 Gate와 Event interaction으로 진행되어야 한다.

새로운 Actor를 추가할 때 기존 Actor 코드를 수정할 필요가 없어야 한다.

---

# 테스트

최소한 다음을 자동 또는 실행 가능한 integration test로 검증하라.

### 1. Broadcast

하나의 Artifact가 여러 Actor를 activate한다.

### 2. Selective activation

모든 Actor가 모든 Artifact에 반응하지 않는다.

### 3. Independent execution

Actor들이 서로 직접 호출하지 않고 독립적으로 실행된다.

### 4. Chained activation

A의 결과가 B를 activate하고 B의 결과가 C를 activate할 수 있다.

### 5. Join / aggregation

여러 Actor의 결과가 준비된 뒤 하나의 Actor가 그것들을 종합할 수 있다.

### 6. Failure isolation

하나의 Actor가 실패해도 다른 Actor의 실행이 중단되지 않는다.

### 7. Retry / eventual activation

실패했던 입력이 나중에 다시 Artifact로 생성되었을 때 필요한 Actor가 다시 활성화될 수 있다.

### 8. Lineage

최종 Artifact에서 입력 Artifact들의 관계를 추적할 수 있다.

---

# 중요한 관찰 포인트

구현하면서 다음을 특히 관찰하라.

1. `EventBus`가 실제로 충분히 단순한가?
2. `Gate`가 어디까지 책임져야 하는가?
3. Actor가 Event를 직접 처리해야 하는가, Runtime이 activation을 관리해야 하는가?
4. Artifact와 Event의 경계가 자연스러운가?
5. 여러 Artifact를 기다리는 Join 조건을 어떻게 표현하는 것이 가장 자연스러운가?
6. 실패와 재시도를 어디에서 책임지는 것이 자연스러운가?
7. 중앙 Orchestrator가 없어도 정말 workflow가 구성되는가?
8. 중앙 Orchestrator가 필요해지는 순간이 있다면 정확히 어떤 이유 때문인가?
9. Browser Adapter는 실제로 Actor의 일반적인 interface가 될 수 있는가?

---

# 결과물

코드만 작성하고 끝내지 말라.

구현이 끝나면 다음을 간단히 정리하라.

## What worked

실제로 자연스럽게 동작한 부분.

## What became awkward

추상화가 억지스럽거나 복잡해진 부분.

## What should change

현재 architecture에서 변경해야 할 부분.

## Important discoveries

처음 예상과 달랐던 부분.

특히 **"중앙 Orchestrator가 필요한가?"​**에 대한 판단을 반드시 포함하라.

---

# 범위에 대한 주의

다음은 이번 작업의 목표가 아니다.

- production-ready framework
- distributed deployment
- microservices
- vector database
- long-term memory
- complex UI
- Electron
- 자체 browser engine
- 완성된 permission system
- 완성된 LLM planner

**이번 작업의 목적은 Web Actor Runtime의 핵심 실행 모델을 실제 복합 workflow에서 시험하는 것이다.**

필요하다면 현재 코드를 상당 부분 다시 작성해도 된다.

가장 중요한 것은 예쁜 abstraction이 아니라 **실험 결과**다.