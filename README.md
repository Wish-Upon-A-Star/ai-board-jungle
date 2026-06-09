# AI Board

AI Board는 팀원이 각자 로그인해서 GitHub, Notion, Figma, Google Calendar, AI API 키를 자기 계정에 연결하고, 그 연결을 바탕으로 자동화를 만들고 공유하는 웹 앱입니다.

구현 스택은 React + FastAPI + PostgreSQL입니다. 게시판, 자동화, 사용자별 연동 프로필, RAG, MCP 로그인/수동 토큰, AI Agent, GitHub/Notion/Figma/Google Calendar write 검증을 한 화면에서 다룹니다.

## 한눈에 보는 핵심

- 사용자마다 계정이 분리됩니다.
- GitHub/Notion/Figma/Calendar 토큰과 OpenAI/Gemini/Anthropic 같은 AI API key는 사용자별 연동 프로필로 DB에 저장됩니다.
- 저장된 키 원문은 API 응답이나 화면에 다시 보여주지 않습니다.
- 같은 사용자가 다른 기기에서 로그인해도 저장된 프로필을 다시 선택해 자동화에 사용할 수 있습니다.
- 운영 환경에서는 PostgreSQL을 기본 DB로 사용합니다. SQLite는 격리 테스트용으로만 허용됩니다.
- 외부 접속은 Cloudflare Tunnel 또는 별도 배포 환경으로 열 수 있습니다.

## 목차

- [과제 제출물 매핑](#과제-제출물-매핑)
- [프로젝트 개요](#프로젝트-개요)
- [주요 구현 기능](#주요-구현-기능)
- [전체 아키텍처 구조](#전체-아키텍처-구조)
- [AI 활용 기능과 구조](#ai-활용-기능과-구조)
- [사용자별 연동과 자동화](#사용자별-연동과-자동화)
- [AI API 키 저장 방식](#ai-api-키-저장-방식)
- [설정 우선순위와 사용 흐름](#설정-우선순위와-사용-흐름)
- [실행 방법](#실행-방법)
- [검증과 데모](#검증과-데모)
- [실제 외부 연동 검증 기록](#실제-외부-연동-검증-기록)
- [회고와 개선 아이디어](#회고와-개선-아이디어)

## 과제 제출물 매핑

| 제출 요구 | README 위치 | 구현/검증 근거 |
| --- | --- | --- |
| 프로젝트 개요 | [프로젝트 개요](#프로젝트-개요) | React + FastAPI + PostgreSQL-first SQLAlchemy + Redis-ready 구조 |
| 주요 구현 기능 | [주요 구현 기능](#주요-구현-기능) | 회원가입/로그인, 게시글 CRUD, 댓글, 태그, 페이징, 검색, 자동화 |
| 전체 아키텍처 구조 | [전체 아키텍처 구조](#전체-아키텍처-구조) | Frontend, Backend, DB, Redis, RAG, MCP, Agent, 외부 API |
| RAG 기능 | [RAG](#rag) | 게시글, 자동화, 사용자 지식자료, GitHub issues/commits/pull requests, Notion database/pages |
| MCP 기능 | [MCP](#mcp) | FastAPI `POST /mcp/rpc` JSON-RPC endpoint |
| Agent 기능 | [AI Agent](#ai-agent) | 자동화 지침을 분석해 대상 API, 템플릿, 다음 액션을 계획 |
| 데모/스크린샷 | [검증과 데모](#검증과-데모) | `docs/demo-screenshot.png`, `npm run verify:full:quick` |
| 회고/한계/개선 | [회고와 개선 아이디어](#회고와-개선-아이디어) | 실서비스 운영 시 필요한 보완점 정리 |

## 프로젝트 개요

AI Board는 게시판 사용자가 GitHub, Notion, Figma, Google Calendar 같은 외부 도구를 사용자별로 등록하고, 각 자동화마다 어떤 프로필과 AI 모델/API 설정을 쓸지 선택할 수 있게 만든 서비스입니다.

핵심 흐름은 다음과 같습니다.

1. 사용자가 가입/로그인합니다.
2. 게시글, 댓글, 태그, 검색, 페이징을 일반 게시판처럼 사용합니다.
3. 사용자는 서버 DB에 자기 연동 프로필을 저장합니다. 토큰은 응답에 원문으로 노출되지 않습니다.
4. 자동화는 저장된 프로필 또는 커스텀 설정을 선택해 주기, 지침, 템플릿, AI Agent를 저장합니다.
5. GitHub/Notion 프로필은 RAG 근거 수집과 live write에 사용할 수 있고, Figma/Google Calendar 프로필은 dry-run 또는 확인 문구 기반 live write 흐름을 검증합니다.
6. 자동화 실행 결과는 게시판에 공유할 수 있고, 실행 이력과 활동 로그가 사용자별로 분리됩니다.

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
- 비개발자도 현재 React/FastAPI/PostgreSQL/Redis/RAG/MCP/Agent/외부 API 준비 상태를 볼 수 있는 System Readiness 패널
- RAG 질문 응답, 문서/텍스트/업로드 지식자료 저장
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
  FastAPI --> RAG["RAG Services"]
  FastAPI --> MCP["MCP JSON-RPC /mcp/rpc"]
  FastAPI --> Agent["Automation Agent"]
  RAG --> GitHub["GitHub Issues/Commits/PRs"]
  RAG --> Notion["Notion Database/Pages"]
  Agent --> Figma["Figma dry-run/live write"]
  Agent --> Calendar["Google Calendar dry-run/live write"]
```

앱 런타임과 운영형 검증은 PostgreSQL을 기본 데이터베이스로 사용합니다. 기본 URL은 `postgresql://ai_board:ai_board@localhost:5432/ai_board`이며 `AI_BOARD_DATABASE_URL`로 다른 PostgreSQL 인스턴스를 지정할 수 있습니다. SQLite는 빠른 백엔드 단위 테스트에서만 격리용으로 사용합니다. Redis는 RAG 유사도 검색 캐시가 사용할 수 있도록 옵션 구조를 갖췄고, 로컬에서는 메모리 캐시 fallback으로 동작합니다.

Runtime SQLite guard: FastAPI runtime startup rejects `sqlite` database URLs unless `AI_BOARD_ALLOW_SQLITE_TEST_DB=1` is explicitly set. That flag is only for isolated tests and must not be set on the live server.

## AI 활용 기능과 구조

### RAG

RAG는 Retrieval-Augmented Generation의 약자입니다. LLM이 바로 답하게 하지 않고, 먼저 게시글/자동화 결과/사용자 지식자료/외부 수집 자료를 검색한 뒤 그 근거를 바탕으로 답변하도록 만드는 구조입니다.

구현 위치:

- `backend/app/services.py`: `similar_posts()`, `similar_knowledge()`, `rag_answer()`
- `backend/app/collectors.py`: GitHub/Notion 외부 수집기
- `POST /api/ai/rag`
- `POST /api/knowledge/rag`
- `POST /api/integration-profiles/{profile_id}/collect`

사용 가능한 RAG 데이터:

- 게시판 글과 댓글 흐름
- 자동화 실행 결과
- 사용자가 직접 입력한 지식자료
- 텍스트/문서 업로드 자료
- GitHub issues, commits, pull requests
- Notion database rows, pages, page blocks

### MCP

MCP는 외부 시스템을 LLM 도구처럼 호출하기 위한 인터페이스입니다. 이 프로젝트는 FastAPI 내부에 JSON-RPC endpoint를 제공합니다.

- Endpoint: `POST /mcp/rpc`
- Method: `automation.describe`
- Method: `weather.lookup`
- 검증: `verify:contract`와 CDP UI smoke에서 `mcpOk: true` 확인

#### User-owned MCP auth profiles

AI Board does not receive or reuse the private Notion/GitHub connector session that Codex uses inside this desktop app. Instead, each real user creates an integration profile with `auth_type` set to `mcp` or `mcp_oauth`, an MCP server URL, the authenticated subject, scopes, and that user's own protected credential value.

- Stored fields: `auth_type`, `mcp_server_url`, `mcp_auth_subject`, `mcp_scopes_json`, plus the encrypted or secret-reference token record.
- API responses return `authType`, `mcpServerUrl`, `mcpAuthSubject`, and `mcpScopes`, but never return the raw credential.
- Automations keep using the selected user-owned integration profile, so webhook-triggered GitHub/Notion writes can be audited back to the user identity and MCP scope set that authorized the run.
- Demo setup can use the desktop token template files, but real operation requires replacing placeholders with real user-owned credentials and sharing the target Notion page/database with that integration.

#### MCP login / OAuth connector flow

The normal user path is no longer "paste an API token first." In the `연동 프로필` tab, users can click `GitHub MCP 로그인` or `Notion MCP 로그인`. The backend starts a provider OAuth authorization-code flow, stores the returned access token as the user's protected `mcp_oauth` integration profile, and records the MCP subject/scopes for audit.

Required server settings:

```powershell
$env:AI_BOARD_PUBLIC_BASE_URL="https://your-public-domain.example"
$env:AI_BOARD_GITHUB_OAUTH_CLIENT_ID="..."
$env:AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET="..."
$env:AI_BOARD_NOTION_OAUTH_CLIENT_ID="..."
$env:AI_BOARD_NOTION_OAUTH_CLIENT_SECRET="..."
```

Callback URLs to register in the provider apps:

- GitHub OAuth App callback: `https://your-public-domain.example/api/oauth/github/callback`
- Notion public integration redirect URI: `https://your-public-domain.example/api/oauth/notion/callback`

If these variables are missing, the login buttons return a visible setup error that names the missing variables instead of silently doing nothing. The manual token form remains only as an admin/fallback path.

### AI Agent

Agent는 사용자가 적은 자동화 지침을 분석해 다음 정보를 계획합니다.

- 어떤 외부 시스템을 호출할지
- 어떤 API provider를 사용할지
- 어떤 템플릿으로 요청/게시글/업무를 만들지
- 토큰이 준비됐는지
- 변경이 없을 때 skip할지
- 결과를 게시판에 공유할지

구현 위치:

- `backend/app/services.py`: `automation_plan()`, `automation_fingerprint()`, `agent_review()`
- `POST /api/automations`
- `POST /api/automations/{task_id}/run`
- `POST /api/automations/scheduler/tick`

## 사용자별 연동과 자동화

연동 프로필은 사용자별로 DB에 저장됩니다. 다른 사용자의 프로필은 조회/수집/실행/삭제할 수 없습니다.

사용자는 `프로필` 탭에서 다음 두 종류의 정보를 저장합니다.

1. 외부 서비스 연결
   - GitHub, Notion, Figma, Google Calendar, Custom API 연결 정보입니다.
   - MCP OAuth 로그인이 가능하면 로그인 버튼을 사용하고, 안 되는 경우 수동 프로필에 URL과 토큰을 넣습니다.

2. AI API key
   - OpenAI, Anthropic, Google Gemini, OpenAI 호환 API 키입니다.
   - `AI API 키 저장` 영역에서 제공자 버튼을 누르면 입력 폼이 해당 제공자에 맞게 채워집니다.
   - 사용자는 `토큰/API Key` 칸에 자기 키를 직접 넣고 `연동 프로필 저장`을 누릅니다.
   - 이 키는 GitHub/Notion 토큰과 같은 `integration_profiles.token_value` 컬럼에 사용자별로 저장됩니다.

지원 필드:

- `source_kind`: github, notion, figma, google_calendar, custom
- `base_url`
- `api_provider`
- `token_name`
- `token_value`
- `ai_provider`
- `ai_model`
- `ai_api_base`
- `rag_targets`
- `collect_limit`
- `collect_pages`
- `custom_connections`
- `custom_template`

토큰 보안:

- AI API key, GitHub token, Notion token, Figma token, Google Calendar token은 모두 같은 보호 저장 흐름을 사용합니다.
- API 응답은 원문 토큰/API key를 반환하지 않습니다.
- 응답에는 `hasToken`, `tokenPreview`, `tokenStorage`만 표시됩니다.
- 신규 저장 토큰은 `enc:v1:` 형식으로 암호화됩니다.
- 같은 사용자가 다른 기기에서 로그인하면 저장된 프로필 목록은 다시 보입니다. 단, 키 원문은 다시 보여주지 않고 자동화 실행 시 서버에서 복호화해 사용합니다.
- 사용자가 프로필을 삭제하면 해당 저장 키도 함께 삭제됩니다.
- 운영에서는 `AI_BOARD_TOKEN_ENCRYPTION_SECRET`을 `AI_BOARD_JWT_SECRET`과 다른 긴 랜덤 값으로 설정해야 합니다.
- Vault/KMS 연동은 `AI_BOARD_TOKEN_SECRET_COMMAND`를 통해 command provider 방식으로 교체할 수 있습니다.

비밀번호와 API key 저장 차이:

- 비밀번호는 `pbkdf2` 해시로 저장됩니다. 원문 복구가 불가능해야 하므로 로그인 검증에만 씁니다.
- API key/token은 외부 API 호출 때 원문이 필요하므로 해시가 아니라 보호 저장합니다.
- 기본 local provider는 `AI_BOARD_TOKEN_ENCRYPTION_SECRET` 기반 `enc:v1:` 암호화 문자열로 DB에 저장합니다.
- production에서는 local provider 대신 Vault/KMS command provider를 연결할 수 있습니다.

Vault/KMS command provider:

- Set `AI_BOARD_TOKEN_SECRET_PROVIDER=command`.
- Set `AI_BOARD_TOKEN_SECRET_COMMAND` to a command that accepts `{"action":"protect"|"reveal","value":"..."}` on stdin and returns `{"value":"..."}`.
- `scripts/secret-adapter.sample.py` is a local adapter example. Replace it with Vault, KMS, or a secret manager command in production.
- API responses never expose raw tokens; they return `hasToken`, `tokenPreview`, and `tokenStorage`.

## AI API 키 저장 방식

AI API key는 사용자가 우리에게 전달하는 파일이나 채팅 메시지가 아닙니다. 각 사용자가 웹 앱에서 자기 계정으로 직접 저장합니다.

### 입력 위치

1. 로그인합니다.
2. `프로필` 탭으로 이동합니다.
3. `AI API 키 저장` 영역에서 제공자를 선택합니다.
   - `OpenAI 키 입력`
   - `Anthropic 키 입력`
   - `Gemini 키 입력`
   - `호환 API 키`
4. `토큰/API Key` 칸에 본인 키를 넣습니다.
5. `연동 프로필 저장`을 누릅니다.
6. `자동화` 탭에서 `저장된 연동 프로필`로 해당 AI 키 프로필을 선택합니다.

### 저장 위치와 재사용

| 항목 | 저장 위치 | 화면 재노출 | 다른 기기 로그인 후 사용 |
| --- | --- | --- | --- |
| 사용자 비밀번호 | `users.password_hash` | 불가능 | 로그인 검증에 사용 |
| AI API key | `integration_profiles.token_value` | 원문 재노출 없음 | 가능 |
| GitHub/Notion/Figma/Calendar token | `integration_profiles.token_value` | 원문 재노출 없음 | 가능 |

자동화가 실행될 때는 자동화에 연결된 `integration_profile_id`를 따라 현재 사용자의 프로필을 찾고, 서버가 보호 저장된 키를 내부에서만 복호화해 외부 API 호출에 사용합니다.

### 운영 주의사항

- `AI_BOARD_TOKEN_ENCRYPTION_SECRET`은 반드시 긴 랜덤 값으로 설정합니다.
- 이 값이 바뀌면 기존 `enc:v1:` 토큰을 복호화할 수 없으므로 운영 중 임의로 바꾸지 않습니다.
- 여러 서버 인스턴스를 띄울 경우 모든 인스턴스가 같은 `AI_BOARD_TOKEN_ENCRYPTION_SECRET` 또는 같은 Vault/KMS provider를 사용해야 합니다.
- 관리자도 API 응답으로 사용자 키 원문을 볼 수 없게 설계되어 있습니다.

Webhook based change detection:

- `POST /api/webhooks/github` accepts GitHub webhook payloads and verifies `X-Hub-Signature-256` when `AI_BOARD_GITHUB_WEBHOOK_SECRET` is set.
- `POST /api/webhooks/notion` accepts Notion-style database/page change payloads and verifies `X-AI-Board-Signature` when `AI_BOARD_NOTION_WEBHOOK_SECRET` is set.
- Matching active automations run immediately, collect GitHub/Notion RAG sources, and write configured Notion/GitHub/Figma/Calendar actions using the current user's own integration profiles.

## 설정 우선순위와 사용 흐름

자동화 설정은 세 단계로 나뉩니다.

1. 사용자 기본 자동화 설정
   - AI provider, AI model, API base, API Key 전략, 기본 템플릿, 기본 custom connection을 저장합니다.
   - 새 자동화를 만들 때 `사용자 기본값 적용`을 누르면 저장된 기본 연결이 자동화 폼으로 복사됩니다.
   - 반복해서 쓰는 Notion 업무 DB, 사내 API, Google Calendar 같은 기본 경로에 적합합니다.

2. 연동 프로필
   - GitHub, Notion, Figma, Google Calendar, Custom API별 base URL, 토큰 변수명, 실제 토큰, RAG 수집 범위를 저장합니다.
   - 자동화 폼의 `저장된 연동 프로필`에서 선택하면 해당 프로필의 AI/API/connection 설정을 우선 사용합니다.
   - 토큰 원문은 API 응답에 나오지 않고 `hasToken`, `tokenPreview`, `tokenStorage`로만 확인합니다.

3. 자동화별 커스텀 설정
   - 특정 작업만 다른 지침, 템플릿, custom connection을 써야 할 때 자동화 폼에서 직접 수정합니다.
   - `자동화 연결 미리보기`에서 실제로 저장될 connection service/operation을 확인할 수 있습니다.

권장 데모 순서:

1. `사용자 기본 자동화 설정`에서 기본 AI 모델과 custom connection을 저장합니다.
2. `사용자 기본값 적용`으로 자동화 폼에 기본값을 가져옵니다.
3. 필요하면 `연동 프로필`을 만들어 토큰/RAG 수집 범위를 분리합니다.
4. 자동화를 저장하고 `Run`, `Run history`, `Share`, `Scheduler tick`으로 실행과 게시판 공유를 확인합니다.
5. `Integration Activity Log`와 `System Readiness`에서 준비 상태와 실행 로그를 확인합니다.

## 실행 방법

### 1. 의존성 설치

```powershell
npm install
npm --prefix frontend install
python -m pip install -r backend/requirements.txt
```

### 2. 환경 변수

로컬 앱 런타임 기본값은 PostgreSQL입니다.

```powershell
$env:PYTHONPATH="backend"
$env:AI_BOARD_DATABASE_URL="postgresql://ai_board:ai_board@localhost:5432/ai_board"
```

Docker Desktop이 설치되어 있으면 프로젝트의 `docker-compose.yml`로 PostgreSQL을 먼저 올릴 수 있습니다.

```powershell
npm run setup:postgres
npm run verify:postgres
```

Docker가 없는 Windows 환경에서는 PostgreSQL 17 설치 후 같은 URL에 맞춰 사용자/DB를 만들거나, `AI_BOARD_DATABASE_URL`을 이미 접근 가능한 PostgreSQL URL로 지정해야 합니다.

psycopg 드라이버명을 명시하는 예시:

```powershell
$env:AI_BOARD_DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/ai_board"
```

토큰 암호화 예시:

```env
AI_BOARD_TOKEN_SECRET_PROVIDER="local"
AI_BOARD_TOKEN_ENCRYPTION_SECRET="replace-with-a-separate-long-random-secret"
AI_BOARD_TOKEN_SECRET_COMMAND="python scripts/secret-adapter.sample.py"
```

### 3. 시드와 개발 서버

```powershell
python scripts/seed-fastapi.py
npm run dev
```

기본 접속:

- React: `http://127.0.0.1:3000`
- FastAPI Docs: `http://127.0.0.1:8000/docs`

## 같은 네트워크의 다른 기기에서 접속

같은 Wi-Fi나 같은 사내 네트워크의 다른 PC, 휴대폰, VM에서 열 때 사용합니다.

```powershell
npm run dev:lan
```

이 명령은 FastAPI와 Vite를 `0.0.0.0`에 바인딩하고 LAN IPv4 주소를 감지합니다. 출력된 AI Board 주소를 다른 기기 브라우저에서 열면 됩니다.

예시:

```text
http://192.168.0.25:3000
```

자동 감지된 LAN IP가 틀리면 직접 지정합니다.

```powershell
$env:AI_BOARD_PUBLIC_HOST="192.168.0.25"
npm run dev:lan
```

주요 환경 변수:

- `AI_BOARD_HOST`: 서버가 바인딩할 host입니다. 기본값은 `0.0.0.0`입니다.
- `AI_BOARD_PUBLIC_HOST`: 다른 기기 브라우저가 접근할 host 또는 tunnel domain입니다.
- `AI_BOARD_API_PORT`: 백엔드 포트입니다. 기본값은 `8000`입니다.
- `AI_BOARD_WEB_PORT`: 프론트엔드 포트입니다. 기본값은 `3000`입니다.
- `VITE_API_BASE`: 프론트엔드가 호출할 API URL 전체를 직접 지정합니다.

Windows 방화벽에서 선택한 프론트엔드/백엔드 포트의 인바운드 접근을 허용해야 합니다. 다른 기기는 이 PC 또는 tunnel domain에 접근 가능한 네트워크에 있어야 합니다.

## 단일 프로세스 배포 모드

API와 빌드된 React 앱을 FastAPI 프로세스 하나에서 같이 서비스할 때 사용합니다.

```powershell
npm run build
npm run start:lan
```

FastAPI는 `frontend/dist`의 React 빌드 결과를 서비스하고, `/api/*`, `/mcp/rpc`는 백엔드 라우트로 유지합니다. React deep link는 `index.html`로 fallback합니다. 빌드가 없으면 빈 화면 대신 `Frontend build not found. Run npm run build first.` 오류를 반환합니다.

검증한 코드를 현재 라이브 `3000/8000` 서버에 반영:

```powershell
npm run apply:live
```

`apply:live`는 먼저 `AI_BOARD_DATABASE_URL`이 PostgreSQL이고 실제 연결 가능한지 확인합니다. PostgreSQL에 연결할 수 없으면 현재 라이브 포트를 내리기 전에 중단합니다. 연결 가능하면 프론트엔드를 빌드하고 FastAPI `8000`, Vite `3000`을 재시작한 뒤 `/api/health`와 웹 앱 응답을 확인합니다.

Demo a GitHub webhook writing to the small Notion page:

```powershell
npm run demo:github-notion-webhook
```

This command reads the desktop token setup files `ai-board-demo-github-api-token.txt` and `ai-board-demo-notion-api-token.txt`, creates a demo user, GitHub source profile, Notion small-page target profile, automation task, and signed GitHub push webhook call. It writes through the AI Board automation path, not through manual Codex Notion updates. The Notion demo page is `https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8`; share that page with the Notion integration before running a real write.

Verify this mode with:

```powershell
npm run verify:production-serve
```

## 외부 인터넷 접속

LAN 밖의 6-10명 테스터가 접속해야 할 때 사용합니다. 현재 `npm run dev:lan` 서버를 멈추지 않고, 별도 단일 FastAPI 서버를 `8130` 포트에 띄운 뒤 Cloudflare Quick Tunnel URL을 엽니다.

```powershell
npm run serve:external
```

터널 준비가 끝나면 다음 형태의 주소가 출력됩니다.

```text
AI Board public URL: https://...trycloudflare.com
```

이 주소 하나만 테스터에게 공유하면 됩니다. 이 명령은 `3000`, `8000` 포트를 멈추거나 재사용하지 않습니다.

주요 환경 변수:

- `AI_BOARD_EXTERNAL_PORT`: tunnel이 바라볼 로컬 포트입니다. 기본값은 `8130`입니다.
- `AI_BOARD_EXTERNAL_HOST`: 로컬 bind host입니다. tunnel 사용 시 기본값은 `127.0.0.1`입니다.
- `AI_BOARD_EXTERNAL_WORKERS`: Uvicorn worker 수입니다. 기본값은 `1`입니다. PostgreSQL connection limit와 토큰 저장 설정을 확인한 뒤에만 늘립니다.
- `AI_BOARD_DATABASE_URL`: PostgreSQL DB URL입니다.

public tunnel 없이 외부 서버 경로만 검증:

```powershell
npm run verify:external-serve
```

장기 운영에는 Quick Tunnel 대신 named Cloudflare Tunnel, reverse proxy, 또는 호스팅 배포를 사용해야 합니다. Quick Tunnel URL은 임시 주소라 재시작하면 바뀔 수 있습니다.

기본 계정:

- `admin@example.com` / `password123`
- `user@example.com` / `password123`

## 검증과 데모

빠른 전체 검증:

```powershell
npm run verify:full:quick
```

의존성 설치까지 포함한 전체 검증:

```powershell
npm run verify:full
```

개별 검증:

```powershell
npm run verify:hygiene
npm run verify:text
npm run verify:text-output
npm run verify:frontend-helpers
npm run verify:network-config
npm run verify:evaluation-reports
npm run verify:readiness
npm run verify:readiness:compact
npm run verify:readiness-output
npm run verify:readiness-output-fixture
npm run verify:command-scope
npm run verify:readme
npm run verify:readme-output
npm run verify:contract
npm run verify:production-serve
npm run verify:external-serve
npm run verify:postgres
npm run verify:fastapi
npm run smoke:ui
npm run smoke:http
```

검증 내용:

- `verify:hygiene`: `frontend/dist/`, DB, 로그, `.env` 추적 방지와 실토큰 패턴 스캔
- `verify:text`: README, backend, frontend source, scripts, submission checklist의 깨진 한글/문자열 회귀 검사
- `verify:text-output`: parses `verify:text` JSON and checks required scanned file evidence
- `verify:frontend-helpers`: React 화면에서 쓰는 실행 결과 파싱, 게시글 병합, readiness 카드 계산 순수 함수 검사
- `verify:network-config`: checks LAN dev-server host, public API base, `.env.example`, and README external access instructions
- `verify:readme`: 제출 README 구조, 체크리스트, PNG 스크린샷 무결성 확인
- `verify:contract`: React UI가 의존하는 FastAPI 응답 계약 확인
- `verify:production-serve`: builds React and checks FastAPI can serve the built UI, SPA fallback, API health, and API 404 isolation from one process
- `verify:external-serve`: checks the external-access server script, separate 8131 test port, no current-server shutdown behavior, and single-process smoke path
- `verify:full:quick`: hygiene, text, frontend helper, README, backend tests, frontend build, API contract, HTTP smoke, UI CDP smoke, MCP smoke
- `verify:template-presets`: checks reusable automation templates for GitHub + Notion, Figma + Google Calendar, and custom API setups
- `verify:evaluation-reports`: checks contiguous round reports with scores and next-risk evidence
- `verify:readiness`: prints the serverless readiness JSON summary
- `verify:readiness:compact`: prints the same readiness checks as compact CI-friendly lines
- `verify:readiness-output`: asserts the compact readiness output keeps the required summary, PASS lines, README counts, and text-output evidence
- `verify:readiness-output-fixture`: checks that missing or failed text-output evidence fails the readiness-output contract
- `verify:command-scope`: checks README verification command lists against `package.json`
- `verify:readme-output`: parses `verify:readme` JSON and checks command/checklist coverage counts
- `smoke:http`: runs HTTP smoke checks against the managed FastAPI server
- `smoke:ui`: runs Chrome CDP UI smoke checks against the managed React app
- `setup:postgres`: starts the Docker Compose PostgreSQL service when Docker is available, or prints the exact PostgreSQL setup blocker
- `verify:postgres`: first checks PostgreSQL TCP reachability, then starts a separate PostgreSQL-backed FastAPI verification server and checks registration plus integration profile persistence
- `verify:fastapi`: runs backend tests and React/FastAPI integration verification
- `verify:full`: runs the full local verification gate, including live-ready checks that still respect dry-run safeguards
- `test:live-integrations`: checks real GitHub, Notion, Figma, and Google Calendar integrations when user-owned tokens are configured

데모 스크린샷:

![AI Board automation dashboard demo](docs/demo-screenshot.png)

제출 전 체크리스트는 `docs/submission-checklist.md`에 정리되어 있습니다. 반복 개선 리포트는 `docs/evaluation-reports`에 저장됩니다.

## 실제 외부 연동 검증 기록

실제 외부 API 쓰기 검증은 사용자가 `.env`에 각 서비스 토큰과 대상 URL을 넣은 뒤 실행합니다.

```powershell
npm run test:live-integrations
```

필요한 환경 변수 예시:

- `AI_BOARD_GITHUB_TOKEN`
- `AI_BOARD_GITHUB_REPO`
- `AI_BOARD_NOTION_TOKEN`
- `AI_BOARD_NOTION_DATABASE_ID`
- `AI_BOARD_GOOGLE_ACCESS_TOKEN`
- `AI_BOARD_GOOGLE_CALENDAR_ID`
- `AI_BOARD_FIGMA_TOKEN`
- `AI_BOARD_FIGMA_FILE_KEY`

앱 내부의 Figma/Google Calendar write는 기본적으로 `dry_run=true`입니다. 실제 외부 변경은 `dry_run=false`와 확인 문구 `WRITE LIVE`가 있을 때만 실행됩니다.

## 회고와 개선 아이디어

구현한 점:

- 게시판 필수 기능과 AI 응용 기능을 한 화면 흐름으로 연결했습니다.
- GitHub/Notion을 RAG 데이터 수집의 중심으로 두고, 사용자별 프로필과 자동화별 선택 구조를 만들었습니다.
- MCP와 Agent를 별도 장식이 아니라 자동화 실행/설명/외부 도구 호출 구조에 녹였습니다.
- 토큰 원문 비노출, dry-run 우선 정책, 실제 write 확인 문구를 넣었습니다.
- 검증 자동화를 반복적으로 보강해 UI/API/문서/보안 회귀를 잡도록 했습니다.

한계:

- 실제 운영 수준의 LLM 호출 비용/사용량 추적은 샘플 구조입니다.
- PostgreSQL은 앱 런타임 기본값입니다. SQLite는 빠른 단위 테스트에서만 사용됩니다. Redis는 로컬에서 메모리 캐시 fallback을 사용할 수 있습니다.
- Google Calendar는 OAuth access token이 있어야 실제 이벤트 생성까지 가능합니다.
- Figma 실제 write는 토큰과 파일 권한이 필요합니다.

개선 아이디어:

- 운영 배포에서 refresh token, rate limit, audit log 강화
- pgvector 또는 외부 vector DB 연결
- LangGraph 기반의 더 엄격한 Agent 상태 머신
- CI에서 `npm run verify:full:quick` 자동 실행
## Automation Run Status Policy

- `changed` executions create persisted run-history snapshots and appear in `Run history`.
- `skipped` executions mean watched inputs did not change. They update the automation card `Last run` badge and are audited in `Integration Activity Log`.
- `Retry` and `Scheduler tick` both use the same fingerprint guard, so unchanged user/profile/API/template/custom connection settings are skipped consistently.
- This keeps run history focused on changed execution snapshots while preserving skipped execution evidence in the task card and activity log.

## Evaluation Report Verification

- `npm run verify:evaluation-reports` checks that `docs/evaluation-reports` has a contiguous round sequence, no duplicate round numbers, and score/next-risk evidence in every report.
- `npm run verify:full:quick` runs this report continuity check before backend tests, frontend build, API contract, HTTP smoke, and UI CDP smoke.

## Readiness Summary

- `npm run verify:readiness` prints a JSON readiness summary without starting FastAPI, Vite, or Chrome CDP.
- `npm run verify:readiness:compact` prints the same serverless readiness checks as one line per check for CI logs.
- `npm run verify:readiness-output` asserts the compact output keeps the `READINESS OK` summary, required `PASS` lines, README counts, and text-output evidence.
- `npm run verify:readiness-output-fixture` checks that fake readiness results missing `scannedFileCount`, missing `requiredScannedFiles`, or reporting non-empty `missingRequiredFiles` fail the readiness-output contract.
- `npm run verify:command-scope` asserts the README serverless/server-required command lists stay synchronized with `package.json`.
- It runs hygiene, text, text-output, frontend helper, template preset, evaluation report, README, readiness-output fixture, command scope, and backend syntax checks.
- Server-required checks are listed separately in the output so users know when to run `npm run verify:full:quick`.

## Verification Command Scope

Serverless checks do not start FastAPI, Vite, or Chrome CDP:

- `npm run verify:hygiene`
- `npm run verify:text`
- `npm run verify:text-output`
- `npm run verify:frontend-helpers`
- `npm run verify:template-presets`
- `npm run verify:network-config`
- `npm run verify:evaluation-reports`
- `npm run verify:readiness`
- `npm run verify:readiness:compact`
- `npm run verify:readiness-output`
- `npm run verify:readiness-output-fixture`
- `npm run verify:command-scope`
- `npm run verify:readme`
- `npm run verify:readme-output`

Server-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials:

Run server-required checks sequentially. verify:postgres uses port 8140, verify:fastapi uses ports 8141/3141, verify:full:quick uses ports 8142/3142, and verify:external-serve uses port 8131; these checks must not stop the current 3000/8000 server.

Safe local verification order:

```powershell
npm run verify:readiness
npm run verify:command-scope
npm run verify:readme-output
npm run verify:postgres
npm run verify:fastapi
npm run verify:full:quick
```

- `npm run verify:contract`
- `npm run verify:postgres`
- `npm run verify:production-serve`
- `npm run verify:external-serve`
- `npm run smoke:http`
- `npm run smoke:ui`
- `npm run verify:fastapi`
- `npm run verify:full:quick`
- `npm run verify:full`
- `npm run test:live-integrations`
