# Web Actor Runtime

> **중앙 오케스트레이터 없이 이벤트와 산출물 수렴만으로 자율 동작하는 탈중앙화 Web Actor 런타임**  
> *(Decentralized Web Actor Runtime & Free-Tier Web LLM Orchestrator)*

---

## 📌 프로젝트 소개

기존 멀티 에이전트 시스템은 중앙의 워크플로우 스크립트(`await actorA(); await actorB(); ...`)에 강하게 결합되어 있어, 웹 브라우저 기반 상호작용의 지연, 스트리밍, 일시적 오류(Rate limit), 세션 만료 등에 취약합니다.

**Web Actor Runtime**은 중앙 제어 코드 없이 오직 **Event + Artifact + Trigger + InputResolver + ExecutionRegistry**만으로 복합 분산 파이프라인(Broadcast, Chained Activation, Join/Aggregation)을 자율적으로 구성하고 실행합니다.

특히 **API 키 없이 브라우저로만 사용할 수 있는 무료 티어(Free-Tier) Web LLM(ChatGPT, Gemini, Claude)**을 각기 독립된 브라우저 프로필에서 띄워 오케스트레이션하는 데 최적화되어 있습니다.

---

## 🏛️ 핵심 아키텍처

```text
                     Seed Document Artifact
                               │
                        artifact.created
                               │
                ┌──────────────┼──────────────┐
                ▼                             ▼
             Reviewer                      Summarizer
          (/reviewer UI)                 (/summarizer UI)
                │                             │
          review.completed             summary.completed
                │                             │
                ▼                             │
              Critic                          │
           (/critic UI)                       │
                │                             │
         critique.completed                   │
                │                             │
                └──────────────┬──────────────┘
                               │ (CorrelationJoinResolver: Review + Summary + Critique)
                               ▼
                            Refiner
                         (/refiner UI)
                               │
                      refinement.completed
                               │
                               ▼
                         Final Artifact
```

### 런타임 실행 프리미티브

```text
Event ──▶ Trigger ──▶ InputResolver ──▶ ExecutionRegistry ──▶ Actor.execute(inputs)
          (이벤트 필터) (입력 세트 투사)      (원자적 멱등성 보장)        (브라우저 조작)
```

1. **[`Event`](src/types.ts)**: 상태 변경 및 작업 완료를 알리는 경량 메시지 (`topic`, `source`, `artifactId`, `correlationId`).
2. **[`Artifact`](src/types.ts)**: 영속화된 작업 산출물 및 Lineage 데이터 (`id`, `type`, `content`, `parentIds`, `metadata`).
3. **[`Trigger`](src/types.ts)**: Store를 건드리지 않는 순수 이벤트 레벨의 고속 필터 (`topicTrigger`, `anyTrigger`).
4. **[`InputResolver`](src/types.ts)**: Store 상태를 투사하여 유효하고 완전한 입력 아티팩트 세트를 결정론적으로 추출하는 무상태 컴포넌트 (`SingleArtifactResolver`, `CorrelationJoinResolver`).
5. **[`ExecutionRegistry`](src/execution-registry.ts)**: `${actorId}::${sortedInputIds}` 해시를 기반으로 중복 실행과 동시성 레이스를 원자적으로 방지하는 멱등성 관리자.
6. **[`WebActor`](src/actor.ts)**: Playwright 브라우저를 통해 독립된 Web UI와 상호작용하는 자율 액터.
7. **[`ArtifactStore`](src/store.ts)**: SQLite 기반 영속 저장소. 계보(Lineage) 트리 및 조상(Ancestors) 역추적 제공.

---

## 📂 프로젝트 구조

```text
web-actor-runtime/
├── docs/                       # 아키텍처 분석 및 실험 명세 문서
│   ├── 01-draft-experiment.md  # 1차 MVP 확장 실험 요구사항
│   ├── 02-next-experiment.md   # 2차 프리미티브 분해 실험 요구사항
│   └── 03-architecture-report.md # 최종 아키텍처 분석 보고서
├── src/                        # 런타임 코어 소스코드
│   ├── types.ts                # 핵심 인터페이스 및 타입 정의
│   ├── bus.ts                  # 실패 격리 비동기 EventBus
│   ├── store.ts                # Lineage 지원 SQLite ArtifactStore
│   ├── execution-registry.ts   # 멱등성 및 실행 라이프사이클 관리자
│   ├── resolver.ts             # Trigger 및 InputResolver 구현체
│   ├── gate.ts                 # 이전 버전 호환용 Gate 어댑터
│   ├── actor.ts                # WebActor 및 FunctionActor
│   ├── runtime.ts              # 자율 활성화 WebActorRuntime
│   ├── adapter.ts              # 기본 WebAdapter 인터페이스
│   ├── llm-adapters.ts         # ChatGPT, Gemini, Claude 전용 스트리밍 어댑터
│   ├── browser.ts              # 기본 Playwright BrowserRuntime
│   ├── persistent-browser.ts   # 세션 보존용 PersistentBrowserRuntime (.profiles/)
│   ├── demo-server.ts          # 역할별 로컬 웹 UI 및 LLM 스트리밍 시뮬레이터 서버
│   ├── demo.ts                 # 4대 Web Actor 탈중앙화 데모
│   ├── live-demo.ts            # Free-Tier Web LLM 수직 슬라이스 데모
│   ├── dashboard-server.ts     # 웹 UI 제어판 및 SSE 실시간 스트리밍 서버
│   └── setup-login.ts          # 1회성 웹 LLM 브라우저 로그인 도구
├── tests/                      # 통합 및 회귀 테스트 스위트
│   └── test-suite.ts           # 12개 핵심 통합 테스트
├── .gitignore                  # 세션 쿠키(.profiles), DB, node_modules 제외
├── package.json
└── tsconfig.json
```

---

## 🚀 실행 가이드

### 1. 웹 UI 제어판 (Web Control Panel) — 추천 ⭐
```bash
npm run dashboard
```
- 브라우저에서 `http://localhost:3000` 접속
- **프롬프트 커스텀 지시문 입력**: Seed Document 및 각 LLM(ChatGPT, Gemini, Claude)별 역할 프롬프트 자유 편집
- **3대 내장 프리셋**:
  - 🏗️ *아키텍처 리뷰 & 종합 ADR*
  - 🛡️ *코드 보안 및 리팩토링 검토*
  - 💼 *사업 기획 & 시장성 분석*
- **모드 전환**: 시뮬레이션 모드 (즉시 검증) ⟷ 실제 라이브 웹 LLM 모드
- **실시간 SSE 스트리밍**: 3대 액터 상태(스트리밍 중/완료), 실시간 EventBus 로그, 최종 산출물 및 계보 트리 실시간 렌더링

### 2. CLI 4대 Web Actor 자율 워크플로우 데모
```bash
npm run demo
```
- 내장 Web UI 서버 구동 (`/reviewer`, `/summarizer`, `/critic`, `/refiner`)
- 제안 문서 투입 -> Reviewer & Summarizer 병렬 실행 -> Critic 연쇄 실행 -> Refiner 3자 조인 수렴 -> 최종본 및 Lineage 트리 출력

### 3. Free-Tier Web LLM 수직 슬라이스 (ChatGPT + Gemini + Claude)

#### A. 스트리밍 시뮬레이션 모드 (로그인 불필요, 즉시 검증)
```bash
npm run demo:llm
```
- 실제 서비스와 100% 동일한 DOM 셀렉터와 타자기 스트리밍 효과를 제공하는 로컬 시뮬레이터를 통해 13초 만에 전체 흐름 완결.

#### B. 실제 라이브 웹 브라우저 모드
```bash
# 최초 1회: 실제 브라우저 창을 띄워 서비스에 로그인 후 세션 저장 (.profiles/)
npm run setup:login

# 실제 라이브 웹 창을 띄우고 오케스트레이션 실행
npm run demo:llm:live
```

---

## 🧪 테스트 스위트 (12개 전원 통과)

```bash
npm test
```

| 범주 | 테스트 항목 | 검증 내용 |
| :--- | :--- | :--- |
| **코어 실행** | 1. Broadcast | 하나의 Artifact가 여러 Actor를 동시 활성화 |
| | 2. Selective Activation | 관심 없는 Topic/Type을 무시하고 선별적 활성화 |
| | 3. Independent Execution | 브라우저 기반 독립 세션에서 상호 결합 없이 실행 |
| | 4. Chained Activation | Doc -> Review -> Critique 연쇄 트리거 |
| | 5. Join / Aggregation | Review, Summary, Critique가 모두 수렴될 때까지 대기 후 Refiner 활성화 |
| | 6. Failure Isolation | 특정 Actor 오류 발생 시에도 시스템 및 형제 Actor 정상 동작 |
| | 7. Retry / Eventual Activation | 실패했던 입력이 재시도되어 생성되면 대기 중이던 Join Actor 자동 활성화 |
| | 8. Lineage | 산출물 계보 트리 및 모든 조상 노드 추적 검증 |
| **프리미티브** | Test A — Join Identity | 독립된 워크플로우 인스턴스 간의 Artifact가 결코 교차 조인되지 않음 |
| | Test B — Duplicate Events | 중복 이벤트가 반복 발행되어도 단 1회만 실행 (멱등성 보장) |
| | Test C — Concurrent Completion | 여러 이벤트가 동일 틱에 동시 발생해도 레이스 컨디션 없이 원자적 선점 |
| | Test D — Actor Input Contract | Actor는 Store를 직접 쿼리하지 않고 Resolver가 사전 해결한 입력만 주입받음 |

---

## 📚 상세 문서

- [01-draft-experiment.md](docs/01-draft-experiment.md): 최초 Web Actor Runtime MVP 확장 요구사항 명세
- [02-next-experiment.md](docs/02-next-experiment.md): 아키텍처 프리미티브 정립 및 조인/멱등성 심층 실험 명세
- [03-architecture-report.md](docs/03-architecture-report.md): 최종 아키텍처 분석 보고서 및 거버넌스 경계 결론
