# AI Board

React, FastAPI, PostgreSQL-ready SQLAlchemy, Redis 캐시를 기반으로 만든 AI 자동화 게시판입니다. 단순 게시판에 AI 버튼만 붙인 구조가 아니라, 사용자가 GitHub, Notion, Google Calendar, Figma뿐 아니라 Jira, Slack, Sheets, 사내 API 같은 임의의 외부 업무 흐름을 자동화 작업으로 등록하고 실행 결과를 게시판에 공유하는 방식으로 구성했습니다.

## 주요 사용 흐름

1. 사용자가 회원가입 또는 로그인합니다.
2. 자동화 작업에 `몇 분마다`, `어디에서`, `어디로`, `지침`, `사용 API`, `AI Agent`, `AI 모델`, `템플릿 선택`, `커스텀 출력 템플릿`, `API Key 관리 방식`을 입력합니다.
3. 사용자는 `커스텀 연결 칸`을 필요한 만큼 추가합니다. 각 칸에는 표시 이름, 서비스 키, URL/ID, 요청 API, 토큰 변수명, 작업 방식, 연결별 템플릿을 넣습니다.
4. GitHub/Notion/Figma/Calendar 입력은 빠른 예시용일 뿐이며 필수 대상이 아닙니다. 실제 우선 대상은 사용자가 추가한 커스텀 연결 칸입니다.
5. Agent가 지침과 연결 칸을 분석해 필요한 대상과 API를 선택합니다.
6. 사용자는 작업 카드의 `실행` 버튼으로 자동화 계획을 실행하고, `게시판 공유` 버튼으로 결과를 게시글로 남깁니다.
7. `API 실행 콘솔`에서 Health, RAG, MCP, Agent Hub 버튼을 눌러 실제 FastAPI API 호출 결과를 확인할 수 있습니다.

## 사용자와 권한

- 새 사용자는 홈페이지에서 직접 회원가입할 수 있습니다.
- 일반 사용자는 자기 자동화 작업만 조회, 실행, 공유할 수 있습니다.
- 관리자는 전체 사용자의 자동화 작업을 볼 수 있습니다.
- 데모 계정:
  - 관리자: `admin@example.com / password123`
  - 일반 사용자: `user@example.com / password123`

## 기술 스택

- Frontend: React + Vite
- Backend: FastAPI
- Database: PostgreSQL-ready SQLAlchemy 모델, 로컬 검증용 SQLite fallback
- Cache: Redis 기반 RAG 검색 결과 캐시
- AI/RAG: 게시글과 자동화 공유글 기반 유사 기록 검색 및 요약
- MCP: `/mcp/rpc` JSON-RPC endpoint
- Agent: `SyncPlannerAgent`, `ReviewRouteAgent`, `AutomationPlannerAgent`
- External API 대상: GitHub REST/CLI, Notion API/MCP, Google Calendar API, Figma API/MCP

## 구현 기능

- 회원가입 / 로그인
- 역할 기반 사용자 표시
- 게시글 생성, 조회, 삭제
- 댓글
- 태그
- 페이징과 검색
- 사용자별 자동화 작업 등록
- 사용자별 커스텀 연결 칸 추가/삭제
- 연결별 서비스 키, URL/ID, 요청 API, 토큰 변수명, 작업 방식, 템플릿 등록
- GitHub/Notion/Figma/Calendar 빠른 예시 URL 등록
- 사용자별 AI 제공자, AI 모델, AI API Base 등록
- 템플릿 프리셋 또는 커스텀 출력 템플릿 선택
- 사용자별 API Key 관리 전략 기록
- GitHub 이슈 템플릿, Notion 반영 템플릿, Figma 작업 템플릿 등록
- 자동화 작업 실행
- 자동화 실행 결과 게시판 공유
- 실제 API 실행 콘솔
- RAG 검색/요약
- MCP JSON-RPC 호출
- Agent 기반 도구 선택
- Redis 캐시
- PostgreSQL 전환 준비

## AI 기능이 사이트에 녹아든 방식

### RAG

게시글과 자동화 공유글을 지식 베이스로 사용합니다. 사용자가 질문하거나 Agent가 중복/유사성을 판단할 때 기존 게시글을 검색하고, 관련 근거와 요약을 반환합니다.

RAG는 Retrieval-Augmented Generation의 약자입니다. LLM이 기억만으로 답하는 대신, 먼저 우리 서비스의 게시글/자동화 결과에서 관련 기록을 검색하고 그 검색 결과를 근거로 답변하게 만드는 방식입니다. 이 프로젝트에서는 `backend/app/services.py`의 `similar_posts()`와 `rag_answer()`가 그 역할을 하며, `/api/ai/rag` API와 API 실행 콘솔의 `RAG` 버튼으로 확인할 수 있습니다.

관련 API:

- `POST /api/ai/rag`

### MCP

FastAPI가 MCP 스타일의 JSON-RPC endpoint를 제공합니다. 현재 `automation.describe`, `weather.lookup` 메서드가 있으며, 외부 시스템을 도구처럼 호출하는 구조를 과제 요구사항에 맞게 보여줍니다.

관련 API:

- `POST /mcp/rpc`

### AI Agent

자동화 작업의 source, destination, instruction, api_provider, 커스텀 연결 칸, AI 모델, 템플릿을 읽고 필요한 도구를 선택합니다. 커스텀 연결 칸이 있으면 그 목록을 우선 사용하고, 없을 때만 문장에 포함된 GitHub, Notion, Google Calendar, Figma, Board 같은 대상을 추론합니다. 무한 루프 방지를 위해 max tool calls, timeout, retry 제한을 결과에 포함합니다.

예시 변환:

- GitHub 이슈 생성 템플릿: `제목 / 본문 / 라벨 / 담당자 / 마감일`
- Notion DB 반영 템플릿: `업무명 / 상태 / GitHub 링크 / 요약 / 담당자 / 마감일 / 다음 액션`
- Figma 작업 템플릿: `섹션명 / 확인 기준 / 관련 게시글 / 담당자`
- Calendar 템플릿: `일정 제목 / 시작 / 종료 / 설명 / 링크`

관련 API:

- `POST /api/automations/{task_id}/run`
- `POST /api/integrations/hub/run`
- `POST /api/ai/agent/moderate`

### 변경 감지 실행

자동화는 매번 무조건 외부 API를 때리지 않습니다. 실행할 때 아래 감시 대상 값을 SHA-256 해시로 계산하고, 이전 실행의 해시와 같으면 `status: "skipped"`로 응답합니다.

감시 대상:

- source, destination, instruction, template
- api_provider, ai_agent
- GitHub repo/project URL
- Notion DB URL
- Figma file URL
- 템플릿 선택
- 커스텀 출력 템플릿
- 커스텀 연결 칸
- Calendar ID
- AI provider, AI model, AI API base
- 요청/일정 템플릿
- GitHub 이슈 템플릿
- Notion 반영 템플릿
- Figma 작업 템플릿

즉 지침, 대상 사이트, 커스텀 연결 칸, 템플릿, AI 모델 같은 값이 바뀐 경우에만 `status: "changed"`로 실제 실행 계획을 만들고 실행 기록을 저장합니다.

## API 실행 콘솔

홈페이지의 `API 실행 콘솔` 버튼은 실제 API를 호출합니다.

- `Health`: `GET /api/health`
- `RAG`: `POST /api/ai/rag`
- `MCP`: `POST /mcp/rpc`
- `Agent Hub`: `POST /api/integrations/hub/run`

응답은 우측 `API` 탭에 JSON으로 표시됩니다.

## 사용자별 외부 사이트 설정

자동화 등록 폼의 중심은 `커스텀 연결 칸`입니다. 사용자는 연결을 필요한 만큼 추가할 수 있고, Notion/Figma에 고정되지 않습니다.

연결 칸 입력값:

- 표시 이름: 화면에 보이는 이름, 예: `업무 DB`, `디자인 파일`, `Jira 보드`
- 서비스 키: agent가 사용할 식별자, 예: `notion`, `figma`, `jira`, `slack`, `internal_crm`
- URL/ID: API 대상 URL, DB ID, 파일 URL, 캘린더 ID 등
- 요청 API: `REST API`, `GraphQL`, `MCP`, `Google Calendar API`, `Figma MCP` 등
- 토큰 변수명: `NOTION_TOKEN`, `FIGMA_TOKEN`, `JIRA_TOKEN`처럼 실제 키를 찾을 이름
- 작업 방식: `create_issue`, `upsert_page`, `create_event`, `create_comment` 등
- 연결별 템플릿: 해당 서비스에 보낼 필드 양식

템플릿 선택:

- `GitHub 이슈 -> 업무 DB`
- `디자인 확인 -> 일정/피드백`
- `RAG 게시판 요약/추천`
- `커스텀 템플릿`

빠른 예시 입력값:

- GitHub Repo URL: `https://github.com/<owner>/<repo>`
- GitHub Project URL: `https://github.com/users/<owner>/projects/<number>`
- Notion DB URL: `https://www.notion.so/<workspace>/<database-id>`
- Figma File URL: `https://www.figma.com/design/<fileKey>/<fileName>`
- Google Calendar ID: 보통 `primary`, 공유 캘린더는 해당 calendar id
- AI 제공자: `OpenAI`, `Anthropic`, `Gemini`, `Vercel AI Gateway`, `사내 LLM Gateway` 등
- AI 모델: 예시 `gpt-4o-mini`, `gpt-4.1-mini`, `claude-sonnet-4`, `gemini-2.5-pro`
- AI API Base: OpenAI 호환 gateway 또는 사내 gateway URL
- API Key 관리: `.env`, 서버 비밀 저장소, 사용자별 encrypted credential store 등

보안상 실제 API Key 값을 게시판 작업 데이터에 직접 저장하지 않는 것을 전제로 합니다. 작업에는 “어떤 키 이름을 어디서 꺼내 쓸지” 전략과 토큰 변수명만 남기고, 실제 키는 `.env`나 운영 비밀 저장소에서 주입합니다.

## 아키텍처

```mermaid
flowchart LR
  User["사용자"] --> React["React UI"]
  React --> FastAPI["FastAPI"]
  FastAPI --> Auth["JWT Auth"]
  FastAPI --> DB["PostgreSQL / SQLite"]
  FastAPI --> Redis["Redis Cache"]
  FastAPI --> RAG["RAG Service"]
  FastAPI --> Agent["Automation Agent"]
  FastAPI --> MCP["MCP JSON-RPC"]
  Agent --> GitHub["GitHub API/CLI"]
  Agent --> Notion["Notion API/MCP"]
  Agent --> Calendar["Google Calendar API"]
  Agent --> Figma["Figma API/MCP"]
  Agent --> Board["게시판 공유"]
```

## 실행 방법

검증:

```powershell
npm run verify:fastapi
```

개발 서버:

```powershell
npm run dev
```

접속:

- UI: `http://127.0.0.1:3000`
- API Docs: `http://127.0.0.1:8000/docs`

같은 네트워크의 다른 사용자가 접속해야 하면 실행 중인 컴퓨터의 LAN IP를 사용합니다.

- UI: `http://<서버-LAN-IP>:3000`
- API Docs: `http://<서버-LAN-IP>:8000/docs`

프론트엔드는 별도 `VITE_API_BASE`가 없으면 현재 접속한 hostname의 8000 포트를 API 서버로 사용합니다. 예를 들어 사용자가 `http://192.168.0.10:3000`으로 접속하면 API도 `http://192.168.0.10:8000`으로 호출합니다.

시드 데이터 생성:

```powershell
npm run seed
```

PostgreSQL + Redis:

```powershell
docker compose up -d
$env:AI_BOARD_DATABASE_URL="postgresql://ai_board:ai_board@localhost:5432/ai_board"
$env:AI_BOARD_REDIS_URL="redis://localhost:6379/0"
npm run seed
npm run dev
```

## 실제 외부 연동 검증 기록

이미 실제로 검증한 항목:

- Figma 파일 생성 및 UI 레이아웃 추가: `https://www.figma.com/design/SAinYC2KXnsHP5puWxTR12`
- Notion 페이지 생성 및 GitHub 결과 업데이트: `https://app.notion.com/p/3777051c2f998169a87ad8131c2b055b`
- GitHub 레포 생성, commit, push, issue 생성:
  - Repo: `https://github.com/Wish-Upon-A-Star/ai-board-codex-live-test-20260606-161841`
  - Issue: `https://github.com/Wish-Upon-A-Star/ai-board-codex-live-test-20260606-161841/issues/1`

토큰 기반 live test:

```powershell
npm run test:live-integrations
```

이 명령은 `.env`에 실제 GitHub, Notion, Google Calendar, Figma 토큰이 있을 때 외부 서비스에 직접 변경을 생성합니다.

## 한계와 개선 아이디어

- 현재 자동화 실행은 계획/도구 선택과 게시판 공유까지 구현되어 있으며, 실제 주기 실행은 Celery, RQ, APScheduler 같은 워커를 붙이면 됩니다.
- Google Calendar는 OAuth access token이 있어야 실제 이벤트 생성까지 가능합니다.
- 운영 배포 시 refresh token, webhook signature verification, rate limit, audit log를 추가해야 합니다.
- PostgreSQL과 Redis는 Docker Compose로 준비되어 있고, 로컬 기본값은 SQLite fallback입니다.
