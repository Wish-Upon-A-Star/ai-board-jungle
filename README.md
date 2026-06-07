# AI Board

React + FastAPI 기반의 AI 게시판입니다. 기본 게시판 기능 위에 사용자별 연동 프로필, GitHub/Notion 중심 자동화, RAG, MCP, AI Agent, Figma/Google Calendar dry-run write 검증을 자연스럽게 붙인 개인 과제용 구현입니다.

## 목차

- [과제 제출물 매핑](#과제-제출물-매핑)
- [프로젝트 개요](#프로젝트-개요)
- [주요 구현 기능](#주요-구현-기능)
- [전체 아키텍처 구조](#전체-아키텍처-구조)
- [AI 활용 기능과 구조](#ai-활용-기능과-구조)
- [사용자별 연동과 자동화](#사용자별-연동과-자동화)
- [설정 우선순위와 사용 흐름](#설정-우선순위와-사용-흐름)
- [실행 방법](#실행-방법)
- [검증과 데모](#검증과-데모)
- [실제 외부 연동 검증 기록](#실제-외부-연동-검증-기록)
- [회고와 개선 아이디어](#회고와-개선-아이디어)

## 과제 제출물 매핑

| 제출 요구 | README 위치 | 구현/검증 근거 |
| --- | --- | --- |
| 프로젝트 개요 | [프로젝트 개요](#프로젝트-개요) | React + FastAPI + PostgreSQL-ready SQLAlchemy + Redis-ready 구조 |
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
5. GitHub/Notion 프로필은 RAG 근거 수집에 사용할 수 있고, Figma/Google Calendar 프로필은 dry-run 또는 확인 문구 기반 live write 흐름을 검증합니다.
6. 자동화 실행 결과는 게시판에 공유할 수 있고, 실행 이력과 활동 로그가 사용자별로 분리됩니다.

## 주요 구현 기능

- 회원가입 / 로그인 / 현재 사용자 조회
- 게시글 CRUD, 댓글, 태그
- 게시글 검색, `limit`, `offset`, `total`, `nextOffset`, `hasMore` 기반 페이징
- 관리자/일반 사용자 역할 표시와 권한 분리
- 사용자별 프로필 설정: AI provider, AI model, API base, 템플릿 preset, 커스텀 연결
- 사용자별 연동 프로필: GitHub, Notion, Figma, Google Calendar, custom API
- 연동 프로필별 토큰 저장, 응답 마스킹, `tokenStorage` 상태 표시
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
  SQLAlchemy --> PostgreSQL["PostgreSQL-ready DB"]
  FastAPI --> Redis["Redis-ready Cache"]
  FastAPI --> RAG["RAG Services"]
  FastAPI --> MCP["MCP JSON-RPC /mcp/rpc"]
  FastAPI --> Agent["Automation Agent"]
  RAG --> GitHub["GitHub Issues/Commits/PRs"]
  RAG --> Notion["Notion Database/Pages"]
  Agent --> Figma["Figma dry-run/live write"]
  Agent --> Calendar["Google Calendar dry-run/live write"]
```

개발 검증은 SQLite를 기본으로 사용하지만, 모델과 세션 구성은 PostgreSQL-ready SQLAlchemy 구조입니다. `AI_BOARD_DATABASE_URL`을 PostgreSQL URL로 지정하면 운영 DB로 전환할 수 있습니다. Redis는 RAG 유사도 검색 캐시가 사용할 수 있도록 옵션 구조를 갖췄고, 로컬에서는 메모리 캐시 fallback으로 동작합니다.

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

- API 응답은 원문 토큰을 반환하지 않습니다.
- 응답에는 `hasToken`, `tokenPreview`, `tokenStorage`만 표시됩니다.
- 신규 저장 토큰은 `enc:v1:` 형식으로 암호화됩니다.
- 운영에서는 `AI_BOARD_TOKEN_ENCRYPTION_SECRET`을 `AI_BOARD_JWT_SECRET`과 다른 긴 랜덤 값으로 설정해야 합니다.
- Vault/KMS 연동은 `AI_BOARD_TOKEN_SECRET_COMMAND`를 통해 command provider 방식으로 교체할 수 있습니다.

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

로컬 기본값은 SQLite입니다.

```powershell
$env:PYTHONPATH="backend"
$env:AI_BOARD_DATABASE_URL="sqlite:///./data/dev.db"
```

PostgreSQL 예시:

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
npm run verify:evaluation-reports
npm run verify:readiness
npm run verify:readiness:compact
npm run verify:readiness-output
npm run verify:readiness-output-fixture
npm run verify:command-scope
npm run verify:readme
npm run verify:readme-output
npm run verify:contract
npm run verify:fastapi
npm run smoke:ui
npm run smoke:http
```

검증 내용:

- `verify:hygiene`: `frontend/dist/`, DB, 로그, `.env` 추적 방지와 실토큰 패턴 스캔
- `verify:text`: README, backend, frontend source, scripts, submission checklist의 깨진 한글/문자열 회귀 검사
- `verify:text-output`: parses `verify:text` JSON and checks required scanned file evidence
- `verify:frontend-helpers`: React 화면에서 쓰는 실행 결과 파싱, 게시글 병합, readiness 카드 계산 순수 함수 검사
- `verify:readme`: 제출 README 구조, 체크리스트, PNG 스크린샷 무결성 확인
- `verify:contract`: React UI가 의존하는 FastAPI 응답 계약 확인
- `verify:full:quick`: hygiene, text, frontend helper, README, backend tests, frontend build, API contract, HTTP smoke, UI CDP smoke, MCP smoke
- `verify:template-presets`: checks reusable automation templates for GitHub + Notion, Figma + Google Calendar, and custom API setups
- `verify:evaluation-reports`: checks contiguous round reports with scores and next-risk evidence
- `verify:readiness`: prints the serverless readiness JSON summary
- `verify:readiness:compact`: prints the same readiness checks as compact CI-friendly lines
- `verify:readiness-output`: asserts the compact readiness output keeps the required summary, PASS lines, README counts, and text-output evidence
- `verify:readiness-output-fixture`: checks that missing text-output evidence fails the readiness-output contract
- `verify:command-scope`: checks README verification command lists against `package.json`
- `verify:readme-output`: parses `verify:readme` JSON and checks command/checklist coverage counts
- `smoke:http`: runs HTTP smoke checks against the managed FastAPI server
- `smoke:ui`: runs Chrome CDP UI smoke checks against the managed React app
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
- PostgreSQL과 Redis는 ready 구조지만 로컬 검증 기본값은 SQLite와 메모리 캐시입니다.
- Google Calendar는 OAuth access token이 있어야 실제 이벤트 생성까지 가능합니다.
- Figma 실제 write는 토큰과 파일 권한이 필요합니다.

개선 아이디어:

- 운영 배포에서 refresh token, webhook signature verification, rate limit, audit log 강화
- pgvector 또는 외부 vector DB 연결
- LangGraph 기반의 더 엄격한 Agent 상태 머신
- 사용자별 토큰 KMS/Vault 연동
- GitHub/Notion webhook 기반 변경 감지
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
- `npm run verify:readiness-output-fixture` checks that a fake readiness result missing `scannedFileCount` fails the readiness-output contract.
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
- `npm run verify:evaluation-reports`
- `npm run verify:readiness`
- `npm run verify:readiness:compact`
- `npm run verify:readiness-output`
- `npm run verify:readiness-output-fixture`
- `npm run verify:command-scope`
- `npm run verify:readme`
- `npm run verify:readme-output`

Server-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials:

- `npm run verify:contract`
- `npm run smoke:http`
- `npm run smoke:ui`
- `npm run verify:fastapi`
- `npm run verify:full:quick`
- `npm run verify:full`
- `npm run test:live-integrations`
