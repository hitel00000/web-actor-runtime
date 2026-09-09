# Web Actor Standalone Runtime Specification (독립 런타임 설계 및 API 규격서)

본 문서는 **Web Actor Runtime**을 독립형 데몬 서비스(Standalone Daemon API Server)로 전환하기 위한 아키텍처 원칙, 사용자 여정, 구동 방식 및 표준 API 규격을 정의합니다.

---

## 🏛️ 1. 아키텍처 철학 (Architecture Philosophy)

독립형 런타임은 로컬 혹은 원격 시스템에서 동작하는 다양한 애플리케이션(Python, Rust, Go, Shell Script 등)이 복잡한 웹 자동화나 Playwright 의존성 없이 **무료 티어 Web LLM 오케스트레이션**을 레고 블록처럼 사용할 수 있도록 설계됩니다.

1. **의존성 완전 격리 (Full Isolation)**: Playwright, Chromium 드라이버, `.profiles/` 브라우저 세션 락(Lock)은 오직 본 런타임 데몬 안에서만 캡슐화되어 동작합니다.
2. **반응형 이벤트 기반 (Event-Driven & Reactive)**: 중앙의 강결합 제어 방식 대신, 이벤트 버스(`EventBus`)와 산출물 스토어(`ArtifactStore`)의 반응형 수렴을 통해 자율 협업 파이프라인을 구축합니다.
3. **무상태 연동 (Stateless Integration)**: 호출자는 REST API와 SSE(Server-Sent Events) 스트림만 사용하여 작업을 요청하고 실시간으로 수렴 상태를 트레이싱합니다.

---

## 🔄 2. 사용자 활용 흐름 (Developer Journey)

```text
┌────────────────────────┐              ┌─────────────────────────┐              ┌────────────────────────┐
│   Main App (Any Lang)  │              │    Web Actor Runtime    │              │   Free-Tier Web LLMs   │
│   (Py, Rust, Bash...)  │              │     (Daemon on Port)    │              │    (ChatGPT, Gemini...)│
└───────────┬────────────┘              └────────────┬────────────┘              └───────────┬────────────┘
            │                                        │                                       │
            │ 1. Register Actor (POST /api/actors)   │                                       │
            ├───────────────────────────────────────>│                                       │
            │ <--- Actor Registered (201 Created)    │                                       │
            │                                        │                                       │
            │ 2. Publish Seed Event (POST /api/events)                                       │
            ├───────────────────────────────────────>│                                       │
            │                                        │───┐ (Trigger check)                   │
            │                                        │   │ (Resolve Inputs)                  │
            │                                        │<──┘                                   │
            │                                        │                                       │
            │ 3. Subscribe SSE (GET /api/stream)     │ 4. Autonomous Playwright Execution    │
            ├───────────────────────────────────────>│                                       │
            │                                        ├──────────────────────────────────────>│
            │                                        │ <--- Browser Output Streaming Done    │
            │                                        │                                       │
            │                                        │───┐ (Create Artifact)                 │
            │                                        │   │ (Publish completion event)        │
            │                                        │<──┘                                   │
            │ <--- Streamed Event: completion (SSE)  │                                       │
            │<───────────────────────────────────────│                                       │
            │                                        │                                       │
            │ 5. Get Final Result (GET /api/artifacts/:id)                                   │
            ├───────────────────────────────────────>│                                       │
            │ <--- Final Synthesized Markdown (200) │                                       │
            V                                        V                                       V
```

---

## 🔌 3. 표준 API 규격 (Standard API Specification)

기본 포트 대역은 오버맥스(overmax) 프로젝트 및 로컬 포트 충돌 방지 가이드라인에 따라 **30110** (Quiet Fixed Band 30100~30199 내 기본 포트)을 사용합니다.

### 3.1. 에이전트/액터 등록 (Actor Registration)
자율적으로 이벤트를 감지하여 동작할 브라우저 에이전트를 등록합니다.

*   **URL**: `POST /api/actors`
*   **Request Body**:
```json
{
  "id": "code-translator",
  "provider": "chatgpt",
  "activation": {
    "trigger_topic": "code.created",
    "required_types": ["source-code"]
  },
  "output_type": "translated-code",
  "output_topic": "code.translated",
  "prompt_template": "[Role: Senior Rust Developer]\nTranslate the following code to production-grade Rust:\n\n{input}"
}
```
*   **Response** (`201 Created`):
```json
{
  "ok": true,
  "message": "Actor 'code-translator' registered successfully."
}
```

### 3.2. 이벤트 발행 (Event Publishing)
시스템에 새로운 이벤트를 밀어 넣어 연쇄 반응을 트리거합니다.

*   **URL**: `POST /api/events`
*   **Request Body**:
```json
{
  "topic": "code.created",
  "content": "function add(a, b) { return a + b; }",
  "type": "source-code",
  "correlationId": "custom-uuid-12345"
}
```
*   **Response** (`202 Accepted`):
```json
{
  "ok": true,
  "eventId": "event-uuid-88888",
  "artifactId": "artifact-uuid-99999",
  "correlationId": "custom-uuid-12345"
}
```

### 3.3. 실시간 이벤트 스트림 수신 (SSE Stream)
액터들이 브라우저에서 활동하는 실시간 상태와 이벤트를 실시간으로 구독합니다.

*   **URL**: `GET /api/stream`
*   **Headers**: `Accept: text/event-stream`
*   **Response Events**:
```text
data: {"type": "log", "topic": "code.created", "message": "New source-code artifact generated"}

data: {"type": "actor-state", "role": "code-translator", "state": "active", "text": "ChatGPT 브라우저 타이핑 중..."}

data: {"type": "artifact", "artifactType": "translated-code", "content": "fn add(a: i32, b: i32) -> i32 { a + b }"}
```

### 3.4. 결과물 및 계보 조회 (Artifact & Lineage Retrieval)
완성된 산출물과 그 산출물이 어떤 과정을 통해 만들어졌는지에 대한 인과 계보(Lineage)를 상세 조회합니다.

*   **URL**: `GET /api/artifacts/:id`
*   **Response** (`200 OK`):
```json
{
  "id": "artifact-uuid-99999",
  "type": "translated-code",
  "content": "fn add(a: i32, b: i32) -> i32 { a + b }",
  "createdBy": "code-translator",
  "createdAt": "2026-09-09T15:30:00.000Z",
  "parentIds": ["artifact-uuid-source"],
  "lineage": {
    "artifact": { "id": "artifact-uuid-99999", "type": "translated-code" },
    "parents": [
      {
        "artifact": { "id": "artifact-uuid-source", "type": "source-code", "content": "function add..." },
        "parents": []
      }
    ]
  }
}
```

---

## 🚀 4. CLI 구동 명령 사양 (CLI Command Specification)

런타임을 백그라운드 서비스 및 데몬으로 손쉽게 구동하고 관리하기 위한 전용 CLI 명령 사양입니다.

```bash
# 1. 의존성 확인 및 웹 드라이버 설치
web-actor-runtime setup

# 2. 독립 데몬 API 서버 구동 (기본 포트 30110, 백그라운드 실행)
web-actor-runtime start --port 30110 --daemon

# 3. 현재 구동 중인 데몬의 상태 및 포트 점유 확인
web-actor-runtime status

# 4. 구동 중인 데몬 및 브라우저 세션 인스턴스 완전 안전 종료
web-actor-runtime stop
```

---

## 📅 5. 단계별 마일스톤 (Milestones)

1.  **Phase 1: REST API / SSE 라우터 정비**
    *   기존 `dashboard-server.ts`에서 화면 렌더링 부와 런타임 제어 API를 깔끔하게 분리
    *   `/api/actors` 등록 엔드포인트 및 `/api/events` 발행 엔드포인트 추가
2.  **Phase 2: CLI 커맨드라인 인터페이스 래핑**
    *   `src/cli.ts` 구현을 통해 프로세스 시작/정지/상태 모니터링 데몬 제어 기능 장착
3.  **Phase 3: 크로스 랭귀지(Python/Rust) 연동 클라이언트 SDK/예제 작성**
    *   런타임을 외부 프로세스에서 제어할 수 있음을 증명하기 위한 10줄 이내의 클라이언트 연동 예제 탑재
