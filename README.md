# AI Board

AI Board는 팀원이 각자 로그인해서 GitHub, Notion, Figma, Google Calendar, AI API 키를 자기 계정에 연결하고, 그 연결을 바탕으로 자동화를 만들고 공유하는 웹 앱입니다.

구현 스택은 React + FastAPI + PostgreSQL입니다. 게시판, 자동화, 사용자별 연동 프로필, 지식자료(RAG), MCP 로그인/수동 토큰, AI Agent, GitHub/Notion/Figma/Google Calendar 연동을 한 화면에서 다룹니다.

## 한눈에 보는 핵심

- 사용자마다 계정이 분리됩니다.
- GitHub/Notion/Figma/Calendar 토큰과 OpenAI/Gemini/Anthropic 같은 AI API key는 사용자별 연동 프로필로 DB에 저장됩니다.
- 저장된 키 원문은 API 응답이나 화면에 다시 보여주지 않습니다.
- 같은 사용자가 다른 기기에서 로그인해도 저장된 프로필을 다시 선택해 자동화에 사용할 수 있습니다.
- 운영 환경에서는 PostgreSQL을 기본 DB로 사용합니다. SQLite는 격리 테스트용으로만 허용됩니다.

## 목차

- [프로젝트 개요](#프로젝트-개요)
- [과제 제출물 매핑](#과제-제출물-매핑)
- [주요 구현 기능](#주요-구현-기능)
- [전체 아키텍처 구조](#전체-아키텍처-구조)
- [AI 활용 기능과 구조](#ai-활용-기능과-구조)
- [사용자별 연동과 자동화](#사용자별-연동과-자동화)
- [AI API 키 저장 방식](#ai-api-키-저장-방식)
- [설정 우선순위와 사용 흐름](#설정-우선순위와-사용-흐름)
- [자동화 실행 상태 정책](#자동화-실행-상태-정책)
- [실행 방법](#실행-방법)
- [검증과 데모](#검증과-데모)
- [실제 외부 연동 검증 기록](#실제-외부-연동-검증-기록)
- [회고와 개선 아이디어](#회고와-개선-아이디어)

## 프로젝트 개요

AI Board는 게시판 사용자가 GitHub, Notion, Figma, Google Calendar 같은 외부 도구를 사용자별로 등록하고, 각 자동화마다 어떤 프로필과 AI 모델/API 설정을 쓸지 선택할 수 있게 만든 서비스입니다.

핵심 흐름은 다음과 같습니다.

1. 사용자가 가입/로그인합니다.
2. 게시글, 댓글, 태그, 검색, 페이징을 일반 게시판처럼 사용합니다.
3. 사용자는 서버 DB에 자기 연동 프로필을 저장합니다. 토큰은 응답에 원문으로 노출되지 않습니다.
4. 자동화는 저장된 프로필 또는 커스텀 설정을 선택해 주기, 지침, 템플릿, AI Agent를 저장합니다.
5. GitHub/Notion 프로필은 지식자료 수집과 live write에 사용할 수 있고, Figma/Google Calendar 프로필은 dry-run 또는 확인 문구 기반 live write 흐름을 검증합니다.
6. 자동화 실행 결과는 게시판에 공유할 수 있고, 실행 이력과 활동 로그가 사용자별로 분리됩니다.

## 과제 제출물 매핑

| 제출 요구 | README 위치 | 구현/검증 근거 |
| --- | --- | --- |
| React/FastAPI/PostgreSQL 앱 | 프로젝트 개요, 전체 아키텍처 구조 | `frontend`, `backend`, `backend/app/models.py`, `backend/app/db.py` |
| PostgreSQL-first SQLAlchemy | 전체 아키텍처 구조, 실행 방법 | `scripts/postgres-env.mjs`, `npm run verify:postgres` |
| GitHub issues/commits/pull requests | AI 활용 기능과 구조, 실제 외부 연동 검증 기록 | `backend/app/collectors.py`, `scripts/run_team_automation_check.py` |
| Notion database/pages | AI 활용 기능과 구조, 실제 외부 연동 검증 기록 | `backend/app/live_writers.py`, `backend/app/collectors.py` |
| Retrieval-Augmented Generation | AI 활용 기능과 구조 | `similar_posts()`, `similar_knowledge()`, `rag_answer()` |
| 사용자별 토큰/API 키 저장 | 사용자별 연동과 자동화, AI API 키 저장 방식 | `integration_profiles`, `enc:v1:`, Vault/KMS command provider |
| 자동화 실행/공유/상태 정책 | 설정 우선순위와 사용 흐름, 자동화 실행 상태 정책 | `automation_fingerprint()`, run history, activity log |
| 데모와 검증 증거 | 검증과 데모, `docs/evaluation-reports` | `docs/demo-screenshot.png`, `docs/submission-checklist.md` |

운영 화면에서 확인할 수 있는 항목:

- 사용자 기본값 적용: `기본 설정` 탭에서 AI 모델, 템플릿, 기본 연결을 저장한 뒤 자동화 폼으로 복사합니다.
- 자동화 연결 미리보기: `자동화` 탭에서 선택한 프로필과 custom connection이 실행 전 표시됩니다.
- Integration Activity Log: `점검` 탭에서 provider, 상태, 자동화, dry-run 여부로 실행 기록을 필터링합니다.
- System Readiness: `점검` 탭과 `/api/provider-readiness`가 GitHub/Notion/Figma/Google/OpenAI 준비 상태를 보여줍니다.
- Automation Run Status Policy: `changed`와 `skipped` 실행 상태를 구분하고 run-history snapshot을 저장합니다.
- Evaluation Report Verification: `docs/evaluation-reports`와 `npm run verify:evaluation-reports`로 라운드 리포트 존재를 확인합니다.
- Readiness Summary: `npm run verify:readiness`, `npm run verify:readiness:compact`, `npm run verify:readiness-output`으로 readiness 출력 형식을 확인합니다.
- Verification Command Scope: `npm run verify:command-scope`가 README 명령과 `package.json` 스크립트 범위를 맞춥니다.

## 주요 구현 기능

- 회원가입 / 로그인 / 현재 사용자 조회
- 게시글 CRUD, 댓글, 태그
- 게시글 검색, `limit`, `offset`, `total`, `nextOffset`, `hasMore` 기반 페이징
- 관리자/일반 사용자 역할 표시와 권한 분리
- 사용자별 프로필 설정: AI provider, AI model, API base, 템플릿 preset, 커스텀 연결
- 사용자별 연동 프로필: GitHub, Notion, Figma, Google Calendar, custom API
- 연동 프로필별 토큰/API key 저장, 응답 마스킹, `tokenStorage` 상태 표시
- AI API key 전용 프로필 생성 버튼: OpenAI, Anthropic, Gemini, OpenAI 호환 API
- 자동화 등록: 주기, 출발지/목적지, 지침, 템플릿, API provider, AI Agent
- 자동화별 프로필 선택 또는 커스텀 설정 사용
- 자동화 수동 실행, scheduler tick, 입력 변경 없음 skip 처리
- 자동화 실행 이력 페이지네이션과 retry UI
- 자동화 결과 게시판 공유
- 사용자별 integration activity log와 필터
- React/FastAPI/PostgreSQL/Redis/지식자료/MCP/Agent/외부 API 준비 상태 패널
- 지식자료(RAG) 질문 응답, 문서/텍스트/업로드 자료 저장
- Taskory 작업 상태 JSON/JSONL 업로드를 RAG 작업 문맥으로 자동 정리
- MCP JSON-RPC endpoint
- API hub dry-run 실행 콘솔

## 전체 아키텍처 구조

```mermaid
flowchart LR
  User["사용자"] --> React["React Frontend"]
  React --> FastAPI["FastAPI Backend"]
  FastAPI --> SQLAlchemy["SQLAlchemy Models"]
  SQLAlchemy --> PostgreSQL["PostgreSQL-first DB"]
  FastAPI --> Redis["Redis-ready Cache"]
  FastAPI --> RAG["지식자료 Services"]
  FastAPI --> MCP["MCP JSON-RPC /mcp/rpc"]
  FastAPI --> Agent["Automation Agent"]
  RAG --> GitHub["GitHub Issues/Commits/PRs"]
  RAG --> Notion["Notion Database/Pages"]
  Agent --> Figma["Figma dry-run/live write"]
  Agent --> Calendar["Google Calendar dry-run/live write"]
```

앱 런타임과 운영형 검증은 PostgreSQL을 기본 데이터베이스로 사용합니다. 기본 URL은 `postgresql://ai_board:ai_board@localhost:5432/ai_board`이며 `AI_BOARD_DATABASE_URL`로 다른 PostgreSQL 인스턴스를 지정할 수 있습니다. SQLite는 빠른 백엔드 단위 테스트에서만 격리용으로 사용합니다. Redis는 지식자료 유사도 검색 캐시용으로 구조를 갖췄고, 로컬에서는 메모리 캐시 fallback으로 동작합니다.

FastAPI 런타임 시작 시 `sqlite` DB URL이 감지되면 `AI_BOARD_ALLOW_SQLITE_TEST_DB=1`이 명시되지 않는 한 시작을 거부합니다. 이 플래그는 격리 테스트 전용이며 라이브 서버에는 절대 설정하지 않습니다.

## AI 활용 기능과 구조

### 지식자료 (RAG)

자동화가 실행될 때 여기 저장한 문서에서 관련 내용을 먼저 찾아본 다음 AI가 그 내용을 반영해서 처리합니다. 사내 규정, 업무 가이드, 자주 쓰는 양식 등을 저장해두면 자동화가 그 내용을 참고합니다.

구현 위치:

- `backend/app/services.py`: `similar_posts()`, `similar_knowledge()`, `rag_answer()`
- `backend/app/collectors.py`: GitHub/Notion 외부 수집기
- `POST /api/ai/rag`, `POST /api/knowledge/rag`, `POST /api/integration-profiles/{profile_id}/collect`

사용 가능한 데이터:

- 게시판 글과 댓글
- 자동화 실행 결과
- 사용자가 직접 입력한 지식자료
- 텍스트/문서 업로드 자료
- Taskory `task-explorer-state.json` 또는 `taskory-ai-board.jsonl` 업로드 자료
- GitHub issues, commits, pull requests
- Notion database rows, pages, page blocks

Taskory 연동 사용법:

1. Taskory 저장소에서 `python scripts/export_taskory_for_ai_board.py task-explorer-state.json -o taskory-ai-board.jsonl`를 실행합니다.
2. AI Board의 `지식자료` 탭에서 `자료 종류`를 `Taskory 작업 내보내기`로 선택합니다.
3. `taskory-ai-board.jsonl` 또는 원본 `task-explorer-state.json`을 첨부하고 저장합니다.
4. 자동화 프로필의 `지식자료 대상`에 자료명이나 태그를 넣으면 GitHub/Notion/Figma/Calendar 자동화가 Taskory 작업 맥락을 RAG 근거로 사용합니다.

Taskory 자동 업로드:

```powershell
$env:AI_BOARD_BASE_URL="https://your-domain.example"
$env:AI_BOARD_EMAIL="user@example.com"
$env:AI_BOARD_PASSWORD="your-password"
python scripts/sync_taskory_to_ai_board.py --state task-explorer-state.json --watch --interval 300
```

`sync_taskory_to_ai_board.py`는 Taskory 저장 파일 해시가 바뀐 경우에만 AI Board `/api/knowledge/upload`로 자료를 업로드합니다. 기본 동작은 새 업로드가 성공한 뒤 같은 제목의 기존 `taskory` 지식자료를 교체하는 방식이라 watcher를 오래 돌려도 RAG 자료가 중복 누적되지 않고, 업로드 실패 시 이전 자료가 지워지지 않습니다. 이전 스냅샷을 남기고 싶을 때만 `--append`를 사용합니다.

### MCP

MCP는 외부 시스템을 LLM 도구처럼 호출하기 위한 인터페이스입니다.

- Endpoint: `POST /mcp/rpc`
- Method: `automation.describe`, `weather.lookup`

사용자별 MCP 인증 프로필: AI Board는 Codex가 내부에서 사용하는 Notion/GitHub 세션을 받아서 재사용하지 않습니다. 각 사용자가 `auth_type: mcp_oauth`로 연동 프로필을 직접 생성합니다. API 응답은 `authType`, `mcpServerUrl`, `mcpAuthSubject`, `mcpScopes`는 반환하지만 raw 토큰은 절대 반환하지 않습니다.

MCP OAuth 로그인 흐름: `프로필` 탭에서 `GitHub MCP 로그인` 또는 `Notion MCP 로그인`을 클릭하면 백엔드가 provider OAuth 인가 코드 흐름을 시작하고, 반환된 access token을 사용자의 `mcp_oauth` 연동 프로필로 저장합니다.

필요한 서버 설정:

```powershell
$env:AI_BOARD_PUBLIC_BASE_URL="https://your-domain.example"
$env:AI_BOARD_GITHUB_OAUTH_CLIENT_ID="..."
$env:AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET="..."
$env:AI_BOARD_NOTION_OAUTH_CLIENT_ID="..."
$env:AI_BOARD_NOTION_OAUTH_CLIENT_SECRET="..."
$env:AI_BOARD_FIGMA_OAUTH_CLIENT_ID="..."
$env:AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET="..."
$env:AI_BOARD_GOOGLE_OAUTH_CLIENT_ID="..."
$env:AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET="..."
```

콜백 URL:

- GitHub: `https://your-domain.example/api/oauth/github/callback`
- Notion: `https://your-domain.example/api/oauth/notion/callback`
- Figma: `https://your-domain.example/api/oauth/figma/callback`
- Google Calendar: `https://your-domain.example/api/oauth/google_calendar/callback`

실제 앱에서는 `프로필` 탭의 **OAuth callback 진단** 영역에 현재 접속 주소 기준 콜백 URL이 그대로 표시됩니다. Figma나 Google에서 `Invalid redirect URI`가 뜨면 그 값을 복사해서 각 provider 개발자 콘솔의 callback/redirect URI allowlist에 등록합니다.

### AI Agent

Agent는 자동화 지침을 분석해 다음 정보를 계획합니다.

- 어떤 외부 시스템을 호출할지
- 어떤 API provider를 사용할지
- 어떤 템플릿으로 요청/게시글/업무를 만들지
- 토큰이 준비됐는지
- 변경이 없을 때 skip할지
- 결과를 게시판에 공유할지

구현 위치:

- `backend/app/services.py`: `automation_plan()`, `automation_fingerprint()`, `agent_review()`
- `POST /api/automations`, `POST /api/automations/{task_id}/run`, `POST /api/automations/scheduler/tick`

## 사용자별 연동과 자동화

연동 프로필은 사용자별로 DB에 저장됩니다. 다른 사용자의 프로필은 조회/수집/실행/삭제할 수 없습니다.

`프로필` 탭에서 다음 두 종류의 정보를 저장합니다.

1. **외부 서비스 연결** — GitHub, Notion, Figma, Google Calendar, Custom API. MCP OAuth 로그인이 가능하면 로그인 버튼을 사용하고, 안 되는 경우 수동 프로필에 URL과 토큰을 입력합니다.

2. **AI API key** — OpenAI, Anthropic, Google Gemini, OpenAI 호환 API 키. `AI API 키 저장` 영역에서 제공자 버튼을 누르면 입력 폼이 채워집니다.

지원 필드: `source_kind`, `base_url`, `api_provider`, `token_name`, `token_value`, `ai_provider`, `ai_model`, `ai_api_base`, `rag_targets`, `collect_limit`, `collect_pages`, `custom_connections`, `custom_template`

**토큰 보안:**

- API 응답은 원문 토큰/API key를 반환하지 않습니다.
- API responses never expose raw tokens.
- 응답에는 `hasToken`, `tokenPreview`, `tokenStorage`만 표시됩니다.
- 신규 저장 토큰은 `enc:v1:` 형식으로 암호화됩니다.
- 사용자가 프로필을 삭제하면 해당 저장 키도 함께 삭제됩니다.
- 운영에서는 `AI_BOARD_TOKEN_ENCRYPTION_SECRET`을 `AI_BOARD_JWT_SECRET`과 다른 긴 랜덤 값으로 설정해야 합니다.
- Vault/KMS 연동은 `AI_BOARD_TOKEN_SECRET_COMMAND`를 통해 교체할 수 있습니다.

**비밀번호와 API key 저장 차이:**

- 비밀번호는 `pbkdf2` 해시로 저장됩니다. 원문 복구가 불가능해야 하므로 로그인 검증에만 씁니다.
- API key/token은 외부 API 호출 때 원문이 필요하므로 해시가 아니라 보호 저장합니다.

Vault/KMS command provider 설정:

- `AI_BOARD_TOKEN_SECRET_PROVIDER=command`
- `AI_BOARD_TOKEN_SECRET_COMMAND`를 `{"action":"protect"|"reveal","value":"..."}` stdin을 받아 `{"value":"..."}` 를 반환하는 커맨드로 지정합니다.
- `scripts/secret-adapter.sample.py`가 로컬 어댑터 예시입니다.

## AI API 키 저장 방식

### 입력 위치

1. 로그인합니다.
2. `프로필` 탭으로 이동합니다.
3. `AI API 키 저장` 영역에서 제공자를 선택합니다 (OpenAI / Anthropic / Gemini / 호환 API).
4. `토큰/API Key` 칸에 본인 키를 넣습니다.
5. `연동 프로필 저장`을 누릅니다.
6. `자동화` 탭에서 `저장된 연동 프로필`로 해당 AI 키 프로필을 선택합니다.

### 저장 위치와 재사용

| 항목 | 저장 위치 | 화면 재노출 | 다른 기기 로그인 후 사용 |
| --- | --- | --- | --- |
| 사용자 비밀번호 | `users.password_hash` | 불가능 | 로그인 검증에 사용 |
| AI API key | `integration_profiles.token_value` | 원문 재노출 없음 | 가능 |
| GitHub/Notion/Figma/Calendar token | `integration_profiles.token_value` | 원문 재노출 없음 | 가능 |

### 운영 주의사항

- `AI_BOARD_TOKEN_ENCRYPTION_SECRET`은 반드시 긴 랜덤 값으로 설정합니다.
- 이 값이 바뀌면 기존 `enc:v1:` 토큰을 복호화할 수 없으므로 운영 중 임의로 바꾸지 않습니다.
- 여러 서버 인스턴스를 띄울 경우 모든 인스턴스가 같은 값 또는 같은 Vault/KMS provider를 사용해야 합니다.
- 관리자도 API 응답으로 사용자 키 원문을 볼 수 없게 설계되어 있습니다.

Webhook 기반 변경 감지:

- `POST /api/webhooks/github`: GitHub webhook payload를 받고, `AI_BOARD_GITHUB_WEBHOOK_SECRET`이 설정된 경우 `X-Hub-Signature-256`을 검증합니다.
- `POST /api/webhooks/notion`: Notion 스타일 변경 payload를 받고, `AI_BOARD_NOTION_WEBHOOK_SECRET`이 설정된 경우 서명을 검증합니다.

## 설정 우선순위와 사용 흐름

자동화 설정은 세 단계로 나뉩니다.

1. **기본 설정** — AI provider, AI model, API base, API Key 전략, 기본 템플릿, 기본 custom connection을 저장합니다. 새 자동화를 만들 때 `내 기본값 적용`을 누르면 저장된 기본값이 자동화 폼으로 복사됩니다.

2. **연동 프로필** — GitHub, Notion, Figma, Google Calendar, Custom API별 base URL, 토큰, 지식자료 수집 범위를 저장합니다. 자동화 폼의 `저장된 연동 프로필`에서 선택하면 해당 프로필 설정을 우선 사용합니다.

3. **자동화별 커스텀 설정** — 특정 작업만 다른 지침, 템플릿, custom connection을 써야 할 때 자동화 폼에서 직접 수정합니다.

권장 데모 순서:

1. `기본 설정`에서 기본 AI 모델과 custom connection을 저장합니다.
2. `내 기본값 적용`으로 자동화 폼에 기본값을 가져옵니다.
3. 필요하면 `연동 프로필`을 만들어 토큰/지식자료 수집 범위를 분리합니다.
4. 자동화를 저장하고 `Run`, `Run history`, `Share`, `Scheduler tick`으로 실행과 게시판 공유를 확인합니다.

## 자동화 실행 상태 정책

- `changed`: 실행 내용이 변경된 경우. 실행 이력 스냅샷을 저장하고 `Run history`에 표시됩니다.
- `skipped`: 감시 중인 입력이 변경되지 않은 경우. 자동화 카드의 `마지막 실행` 배지를 업데이트하고 활동 로그에 기록됩니다.
- `Retry`와 `Scheduler tick` 모두 같은 fingerprint 가드를 사용하므로 사용자/프로필/API/템플릿/custom connection 설정이 변경되지 않으면 일관되게 skip됩니다.
- `changed` executions create persisted run-history snapshots.
- `skipped` executions mean watched inputs did not change.

## 실행 방법

### 1. 의존성 설치

```powershell
npm install
npm --prefix frontend install
python -m pip install -r backend/requirements.txt
```

### 2. 환경 변수

```powershell
$env:PYTHONPATH="backend"
$env:AI_BOARD_DATABASE_URL="postgresql://ai_board:ai_board@localhost:5432/ai_board"
```

Docker Desktop이 설치되어 있으면 `docker-compose.yml`로 PostgreSQL을 먼저 올릴 수 있습니다.

```powershell
npm run setup:postgres
npm run verify:postgres
```

토큰 암호화 예시:

```env
AI_BOARD_TOKEN_SECRET_PROVIDER="local"
AI_BOARD_TOKEN_ENCRYPTION_SECRET="replace-with-a-separate-long-random-secret"
```

### 3. 시드와 개발 서버

```powershell
python scripts/seed-fastapi.py
npm run dev
```

기본 접속:

- React: `http://127.0.0.1:3000`
- FastAPI Docs: `http://127.0.0.1:8000/docs`

기본 계정:

- `admin@example.com` / `password123`
- `user@example.com` / `password123`

### 4. LAN 접속 (같은 네트워크의 다른 기기)

```powershell
npm run dev:lan
```

LAN IP가 틀리면 직접 지정합니다.

```powershell
$env:AI_BOARD_PUBLIC_HOST="192.168.0.25"
npm run dev:lan
```

## LAN / Other Device Access

Open the printed AI Board browser URL after `npm run dev:lan`. 같은 와이파이에 있는 다른 기기는 `http://<LAN-IP>:3000` 형태로 접속합니다. 이 방식은 집/사무실 내부 테스트용이며, 외부 인터넷 사용자는 아래 Cloudflare 또는 고정 도메인 방식이 필요합니다.

### 5. 단일 프로세스 배포 (API + React 빌드 한 번에)

```powershell
npm run build
npm run start:lan
```

검증된 코드를 현재 라이브 서버에 반영:

```powershell
npm run apply:live
```

### 6. 외부 인터넷 접속 (Cloudflare quick tunnel 또는 고정 도메인)

현재 라이브 데모는 Cloudflare quick tunnel 또는 고정 도메인으로 외부에 열 수 있습니다. quick tunnel 주소는 `https://railway-mediterranean-snap-populations.trycloudflare.com`처럼 보이며, 터널을 다시 열면 주소가 바뀔 수 있습니다.

유치원생도 할 수 있는 접속 순서:

1. 서버 담당자가 알려준 `https://...trycloudflare.com` 또는 고정 도메인 주소를 브라우저 주소창에 붙여 넣습니다.
2. 로그인 또는 회원가입을 합니다. 같은 URL을 써도 계정은 각자 분리됩니다.
3. `프로필` 탭에서 GitHub, Notion, Figma, Google Calendar, AI API 키를 본인 계정으로 연결합니다.
4. Figma/Google 로그인에서 `Invalid redirect URI`가 뜨면 `프로필` 탭의 **OAuth callback 진단**에서 해당 provider의 Callback URL을 복사해 개발자 콘솔에 등록합니다.

Cloudflare quick tunnel 주의:

- quick tunnel 주소가 바뀌면 GitHub/Notion/Figma/Google OAuth 앱의 callback URL도 모두 새 주소로 다시 등록해야 합니다.
- 6~10명(6-10 users)이 계속 쓰는 팀 데모라면 Cloudflare named tunnel, ngrok reserved domain, Vercel/Render/Railway 같은 hosted deployment 중 하나로 고정 도메인을 쓰는 것이 낫습니다.
- 고정 도메인을 쓰면 `.env` 또는 실행 환경의 `AI_BOARD_PUBLIC_BASE_URL`을 `https://your-domain.example`로 맞춥니다.
- `AI_BOARD_PUBLIC_BASE_URL`을 설정하면 라이브 재시작 시 이전 `.cloudflare-url.txt` quick tunnel 주소보다 이 고정 도메인이 우선됩니다.

Cloudflare named tunnel 준비:

```powershell
$env:AI_BOARD_CLOUDFLARE_TUNNEL_NAME="ai-board"
$env:AI_BOARD_CLOUDFLARE_HOSTNAME="ai-board.your-domain.example"
$env:AI_BOARD_PUBLIC_BASE_URL="https://ai-board.your-domain.example"
npm run setup:cloudflare
```

위 명령은 `data/cloudflare/config.yml` 템플릿과 provider별 callback URL을 출력합니다. Cloudflare 계정에서 한 번만 아래 명령을 실행합니다.

```powershell
cloudflared tunnel login
cloudflared tunnel create ai-board
cloudflared tunnel route dns ai-board ai-board.your-domain.example
npm run serve:external -- --named-tunnel
```

`cloudflared tunnel create`가 출력한 tunnel UUID를 `data/cloudflare/config.yml`의 `<TUNNEL-UUID>` 자리에 넣고, 생성된 credentials JSON 경로도 맞춥니다. 이후 GitHub/Notion/Figma/Google 개발자 콘솔에는 `https://ai-board.your-domain.example/api/oauth/.../callback` 값을 등록합니다.

OAuth callback 등록 위치와 예시:

| Provider | 개발자 콘솔 등록 위치 | Callback URL |
| --- | --- | --- |
| GitHub | OAuth App의 **Authorization callback URL** | `https://your-domain.example/api/oauth/github/callback` |
| Notion | OAuth Integration의 **Redirect URI** | `https://your-domain.example/api/oauth/notion/callback` |
| Figma | OAuth App의 **Redirect URI** | `https://your-domain.example/api/oauth/figma/callback` |
| Google Calendar | Google Cloud OAuth Client의 **Authorized redirect URI** | `https://your-domain.example/api/oauth/google_calendar/callback` |

Google에서 `redirect_uri_mismatch`, Figma에서 `Invalid redirect URI`가 뜨면 앱이 보낸 callback이 provider allowlist에 없다는 뜻입니다. `프로필 > 진단`에서 해당 provider 카드의 값을 복사해 위 등록 위치에 그대로 붙여넣습니다.

현재 서버에서 정확한 값을 확인하려면 `프로필` 탭의 **OAuth callback 진단**을 봅니다. 앱은 브라우저가 접속한 public origin을 백엔드에 전달하므로 Cloudflare/Vite proxy 뒤에서도 현재 외부 URL 기준으로 callback을 계산합니다.

## 검증과 데모

빠른 전체 검증:

```powershell
npm run verify:full:quick
```

Serverless checks do not start FastAPI, Vite, or Chrome CDP:

```powershell
npm run verify:hygiene        # dist/, DB, .env 추적 방지, 실토큰 패턴 스캔
npm run verify:text           # 한글/문자열 회귀 검사
npm run verify:text-output    # 한글 검사 출력 계약 확인
npm run verify:frontend-helpers  # React 순수 함수 검사
npm run verify:template-presets  # 자동화 템플릿 preset 구조 확인
npm run verify:network-config    # LAN dev-server host, .env.example 검사
npm run verify:cloudflare-tunnel # Cloudflare named tunnel 설정 계약 확인
npm run verify:evaluation-reports # docs/evaluation-reports 라운드 리포트 확인
npm run verify:readiness         # 서버리스 준비 상태 JSON 요약 출력
npm run verify:readiness:compact # CI 친화적 한 줄 출력
npm run verify:readiness-output  # readiness 출력 스키마 확인
npm run verify:readiness-output-fixture # readiness fixture 출력 확인
npm run verify:command-scope     # README 명령 목록과 package.json 동기화 확인
npm run verify:readme            # README 구조, 체크리스트, PNG 무결성
npm run verify:readme-output     # README 검증 출력 계약 확인
```

Server-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials:

Run server-required checks sequentially. verify:postgres uses port 8140, verify:fastapi uses ports 8141/3141, verify:full:quick uses ports 8142/3142, and verify:external-serve uses port 8131; these checks must not stop the current 3000/8000 server.

```powershell
npm run verify:contract          # FastAPI 응답 계약 확인
npm run verify:postgres          # PostgreSQL 연결 및 프로필 저장 검증
npm run verify:production-serve  # 단일 프로세스 서빙 검증
npm run verify:external-serve    # 외부 포트 단일 서버 검증
npm run smoke:http               # HTTP smoke check
npm run smoke:ui                 # Chrome CDP UI smoke check
npm run verify:fastapi           # 백엔드 테스트 및 통합 검증
npm run verify:full:quick        # 전체 검증 (권장)
npm run verify:full              # 설치 포함 전체 검증
npm run test:live-integrations   # 실제 외부 API 토큰이 있는 경우 live integration 검사
```

Safe local verification order:

```powershell
npm run verify:readiness
npm run verify:command-scope
npm run verify:readme-output
npm run verify:postgres
npm run verify:fastapi
npm run verify:full:quick
```

검증 명령 설명:

| 명령 | 범위 |
| --- | --- |
| `verify:hygiene` | dist, DB, `.env`, 실토큰 패턴을 검사합니다. |
| `verify:text` | 한글/문자열 깨짐을 검사합니다. |
| `verify:text-output` | `verify:text` 출력 계약을 검사합니다. |
| `verify:frontend-helpers` | frontend helper 순수 함수 동작을 검사합니다. |
| `verify:template-presets` | 자동화 template preset 구조와 필수 연결을 검사합니다. |
| `verify:network-config` | LAN, 외부 접속, PostgreSQL-first runtime 설정을 검사합니다. |
| `verify:cloudflare-tunnel` | Cloudflare named tunnel 설정 파일과 실행 계약을 검사합니다. |
| `verify:evaluation-reports` | `docs/evaluation-reports` 리포트 존재와 형식을 검사합니다. |
| `verify:readiness` | readiness summary JSON을 출력합니다. |
| `verify:readiness:compact` | readiness summary를 CI용 한 줄 형식으로 출력합니다. |
| `verify:readiness-output` | readiness 출력 계약을 검사합니다. |
| `verify:readiness-output-fixture` | readiness fixture 출력 계약을 검사합니다. |
| `verify:command-scope` | README와 `package.json` 검증 명령 범위를 비교합니다. |
| `verify:readme` | README 구조, 제출 증거, 스크린샷 PNG 무결성을 검사합니다. |
| `verify:readme-output` | README 검증 출력 계약을 검사합니다. |
| `verify:contract` | FastAPI API 응답 계약을 검사합니다. |
| `verify:postgres` | PostgreSQL 연결과 저장 동작을 검사합니다. |
| `verify:production-serve` | 단일 프로세스 production serve를 검사합니다. |
| `verify:external-serve` | 외부 접속용 별도 테스트 포트 serve를 검사합니다. |
| `smoke:http` | HTTP smoke test를 실행합니다. |
| `smoke:ui` | Chrome CDP UI smoke test를 실행합니다. |
| `verify:fastapi` | backend test와 FastAPI 통합 검증을 실행합니다. |
| `verify:full:quick` | 재설치 없이 전체 주요 검증을 실행합니다. |
| `verify:full` | 의존성 설치 포함 전체 검증을 실행합니다. |
| `test:live-integrations` | 실제 GitHub/Notion/Google/Figma 토큰이 있을 때 live integration을 검사합니다. |

Serverless checks do not start FastAPI, Vite, or Chrome CDP. Server-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials.

데모 스크린샷:

![AI Board automation dashboard demo](docs/demo-screenshot.png)

제출 전 체크리스트는 `docs/submission-checklist.md`에 정리되어 있습니다.

## 실제 외부 연동 검증 기록

실제 외부 API 쓰기 검증은 사용자가 `.env`에 각 서비스 토큰과 대상 URL을 넣은 뒤 실행합니다.

```powershell
npm run test:live-integrations
```

필요한 환경 변수:

- `AI_BOARD_GITHUB_TOKEN`, `AI_BOARD_GITHUB_REPO`
- `AI_BOARD_NOTION_TOKEN`, `AI_BOARD_NOTION_DATABASE_ID`
- `AI_BOARD_GOOGLE_ACCESS_TOKEN`, `AI_BOARD_GOOGLE_CALENDAR_ID`
- `AI_BOARD_FIGMA_TOKEN`, `AI_BOARD_FIGMA_FILE_KEY`

앱 내부의 Figma/Google Calendar write는 기본적으로 `dry_run=true`입니다. 실제 외부 변경은 `dry_run=false`와 확인 문구 `WRITE LIVE`가 있을 때만 실행됩니다.

## 회고와 개선 아이디어

구현한 점:

- 게시판 필수 기능과 AI 응용 기능을 한 화면 흐름으로 연결했습니다.
- GitHub/Notion을 지식자료 수집의 중심으로 두고, 사용자별 프로필과 자동화별 선택 구조를 만들었습니다.
- MCP와 Agent를 별도 장식이 아니라 자동화 실행/설명/외부 도구 호출 구조에 녹였습니다.
- 토큰 원문 비노출, dry-run 우선 정책, 실제 write 확인 문구를 넣었습니다.

한계:

- 실제 운영 수준의 LLM 호출 비용/사용량 추적은 샘플 구조입니다.
- Redis는 로컬에서 메모리 캐시 fallback을 사용합니다.
- Google Calendar는 OAuth access token이 있어야 실제 이벤트 생성까지 가능합니다.
- Figma 실제 write는 토큰과 파일 권한이 필요합니다.

개선 아이디어:

- 운영 배포에서 refresh token, rate limit, audit log 강화
- pgvector 또는 외부 vector DB 연결
- LangGraph 기반의 더 엄격한 Agent 상태 머신
- CI에서 `npm run verify:full:quick` 자동 실행
