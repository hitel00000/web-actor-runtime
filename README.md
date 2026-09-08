# Web Actor Runtime

탈중앙화된 Web Actor 실행 환경 (Decentralized Web Actor Runtime).

중앙 Orchestrator의 직접적인 순서 제어(`await actorA(); await actorB(); ...`) 없이, **Actor + Gate + Event + Artifact Store**만으로 복합 워크플로우를 자율적으로 구성하고 실행합니다.

---

## 핵심 아키텍처

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
                               │ (Join Gate: Review + Summary + Critique)
                               ▼
                            Refiner
                         (/refiner UI)
                               │
                     refinement.completed
                               │
                               ▼
                         Final Artifact
```

1. **Event**: 상태 변경 및 작업 완료를 알리는 경량 메시지 (`topic`, `source`, `artifactId`, `correlationId`).
2. **Artifact**: 영속화된 작업 산출물 및 Lineage 데이터 (`id`, `type`, `content`, `parentIds`, `metadata`).
3. **Trigger**: 특정 이벤트 수신 여부만 신속하게 거르는 무상태(stateless) 이벤트 필터 (`topicTrigger`, `anyTrigger`).
4. **Input Resolver**: 현재 Artifact Store 상태에서 Actor 실행에 필요한 유효한 입력 산출물 세트를 해결(resolve)하는 무상태 컴포넌트 (`SingleArtifactResolver`, `CorrelationJoinResolver`).
5. **Execution Registry**: 중복 실행 및 동시성 경쟁을 원자적으로 방지하는 멱등성(Idempotency) 관리자 (`claim`, `complete`, `release`).
6. **Web Actor**: Playwright 브라우저를 통해 독립된 Web UI와 상호작용하는 자율 액터.
7. **Artifact Store**: SQLite 기반 영속 저장소. Artifact 간의 계보(Lineage) 트리 및 조상(Ancestors) 추적 제공.

---

## 실행 방법

### 1. 의존성 설치
```bash
npm install
```

### 2. 전체 실험 데모 실행 (4개 Web Actor 상호작용)
```bash
npm run demo
```

### 3. Free-Tier Web LLM 수직 슬라이스 데모 (ChatGPT + Gemini + Claude)
```bash
# 1) 시뮬레이션 모드 (실제 DOM 태그 + 스트리밍 타자기 효과를 즉시 검증, 로그인 불필요)
npm run demo:llm

# 2) 실제 라이브 브라우저 모드 (실제 chatgpt.com, gemini.google.com, claude.ai 연결)
# 최초 1회 로그인 세션 저장:
npm run setup:login
# 그 후 라이브 오케스트레이션 실행:
npm run demo:llm:live
```
- **ChatGPT**: 기술적 아키텍처 리뷰 작성
- **Gemini**: 3대 핵심 요약 동시 작성 (Broadcast)
- **Claude**: 두 서비스의 결과가 모두 수렴되면 자율 활성화되어 최종 종합 의사결정서(ADR) 작성 (Join)

### 4. 통합 테스트 스위트 실행 (총 12개 테스트 자동 검증)
```bash
npm test
```

검증 항목:
- **기존 8대 핵심 워크플로우 요구사항**:
  1. **Broadcast**: 하나의 Artifact가 여러 Actor를 동시 활성화
  2. **Selective Activation**: 관심 없는 Topic/Type을 무시하고 선별적 활성화
  3. **Independent Execution**: 브라우저 기반 독립 세션에서 상호 결합 없이 실행
  4. **Chained Activation**: Doc -> Review -> Critique 연쇄 트리거
  5. **Join / Aggregation**: Review, Summary, Critique가 모두 수렴될 때까지 대기 후 Refiner 활성화
  6. **Failure Isolation**: 특정 Actor의 웹 UI 에러 발생 시에도 다른 Actor 및 시스템 정상 동작
  7. **Retry / Eventual Activation**: 실패했던 입력이 재시도되어 생성되면 대기 중이던 Join Actor 자동 활성화
  8. **Lineage**: 산출물 계보 트리 및 모든 조상 노드 추적 검증
- **신규 아키텍처 프리미티브 심층 검증**:
  - **Test A — Join Identity**: 독립된 워크플로우 인스턴스 간의 Artifact가 결코 교차 조인되지 않음
  - **Test B — Duplicate Events**: 중복 이벤트가 반복 발행되어도 단 1회만 실행 (멱등성 보장)
  - **Test C — Concurrent Completion**: 여러 이벤트가 동일 틱에 동시 발생해도 레이스 컨디션 없이 원자적 선점(Atomic Claim)
  - **Test D — Actor Input Contract**: Actor는 Store를 직접 쿼리하지 않고 Resolver가 사전 해결한 입력만 전달받음

### 4. 타입 검사
```bash
npm run typecheck
```

