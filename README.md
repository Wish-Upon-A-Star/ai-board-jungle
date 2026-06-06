# AI Board

## 현재 구현 상태 요약

- React 프론트엔드, FastAPI 백엔드, PostgreSQL-ready SQLAlchemy 모델, Redis 캐시 옵션을 사용합니다.
- 사용자는 서버 DB에 자기 계정별 연동 프로필, 토큰, AI provider/model/API base, RAG 수집 범위, 자동화별 템플릿을 저장합니다.
- GitHub issues/commits/pull requests와 Notion database/pages는 사용자별 연동 프로필 토큰으로 수집되어 RAG 지식자료에 저장됩니다.
- Figma comment와 Google Calendar event는 live write API가 있으며 기본은 `dry_run=true`입니다.
- 실제 외부 쓰기(`dry_run=false`)는 UI와 API 모두 확인 문구 `WRITE LIVE`가 있어야 실행됩니다.
- 자동화는 수동 실행과 `POST /api/automations/scheduler/tick` 예약 tick을 모두 지원하고, 입력 변경이 없으면 외부 API 실행을 skip합니다.
- 통합 활동 로그는 `limit`, `offset`, `total`, `nextOffset`, `hasMore` 기반 페이지네이션과 UI 더보기를 지원합니다.
- 통합 활동 로그는 `dry_run=true/false` 필터와 `Real-write audit` 프리셋으로 실제 외부 쓰기만 감시할 수 있습니다.
- 활동 로그, RAG 지식자료, 자동화 실행 이력에는 owner/filter/sort 기준 복합 인덱스를 적용해 고용량 조회를 대비합니다.
- 자동화별 실행 이력은 `/api/automations/{task_id}/runs`에서 `limit`, `offset`, `total`, `nextOffset`, `hasMore`로 페이지네이션됩니다.

## 운영 Secret/KMS 설정

기본값은 로컬 암호화입니다.

```env
AI_BOARD_TOKEN_SECRET_PROVIDER="local"
AI_BOARD_TOKEN_ENCRYPTION_SECRET="replace-with-a-separate-long-random-secret"
```

운영 환경에서 Vault, KMS, 사내 secret service를 쓰려면 command provider를 사용할 수 있습니다. 서버가 토큰을 저장할 때 command에 JSON stdin을 보내고, command는 JSON stdout으로 보호된 값 또는 복원된 값을 반환합니다.

```env
AI_BOARD_TOKEN_SECRET_PROVIDER="command"
AI_BOARD_TOKEN_SECRET_COMMAND="python scripts/secret-adapter.sample.py"
```

Command stdin:

```json
{"action":"protect","value":"plain-token"}
```

Command stdout:

```json
{"value":"vault-or-kms-reference"}
```

`reveal` action은 저장된 reference를 다시 실제 API 토큰으로 복원해야 합니다. API 응답은 원문 토큰을 반환하지 않고 `hasToken`, `tokenPreview`, `tokenStorage`만 반환합니다. `tokenStorage` 값은 `encrypted`, `external`, `legacy`, `empty` 중 하나입니다.

샘플 어댑터는 [scripts/secret-adapter.sample.py](scripts/secret-adapter.sample.py)에 있습니다. 기본 구현은 로컬 파일 저장소 데모이며, 운영에서는 `protect_value()`와 `reveal_value()` 내부를 Vault/KMS SDK 호출로 교체하십시오.

React, FastAPI, PostgreSQL-ready SQLAlchemy, Redis 캐시를 기반으로 만든 AI 자동화 게시판입니다. 단순 게시판에 AI 버튼만 붙인 구조가 아니라, 사용자가 GitHub, Notion, Google Calendar, Figma뿐 아니라 Jira, Slack, Sheets, 사내 API 같은 임의의 외부 업무 흐름을 자동화 작업으로 등록하고 실행 결과를 게시판에 공유하는 방식으로 구성했습니다.

## 주요 사용 흐름

1. 사용자가 회원가입 또는 로그인합니다.
2. 자동화 작업에 `몇 분마다`, `어디에서`, `어디로`, `지침`, `사용 API`, `AI Agent`, `AI 모델`, `템플릿 선택`, `커스텀 출력 템플릿`, `API Key 관리 방식`을 입력합니다.
3. 사용자는 `커스텀 연결 칸`을 필요한 만큼 추가합니다. 각 칸에는 표시 이름, 서비스 키, URL/ID, 요청 API, 토큰 변수명, 작업 방식, 연결별 템플릿을 넣습니다.
4. 자주 쓰는 연결 칸, AI 모델, API base, 토큰 변수명, 커스텀 템플릿은 사용자와 함께 서버 DB에 `서버 저장값`으로 저장합니다.
5. 새 자동화를 만들 때마다 `서버 저장값 불러오기`로 저장된 설정을 가져오고, 자동화별로 필요한 부분만 바꿉니다.
6. GitHub/Notion/Figma/Calendar 입력은 빠른 예시용일 뿐이며 필수 대상이 아닙니다. 실제 우선 대상은 사용자가 추가한 커스텀 연결 칸입니다.
7. Agent가 지침과 연결 칸을 분석해 필요한 대상과 API를 선택합니다.
8. 사용자는 작업 카드의 `실행` 버튼으로 자동화 계획을 실행하고, `게시판 공유` 버튼으로 결과를 게시글로 남깁니다.
9. `API 실행 콘솔`에서 Health, RAG, MCP, Agent Hub 버튼을 눌러 실제 FastAPI API 호출 결과를 확인할 수 있습니다.

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
- 사용자별 서버 저장값 저장/불러오기
- 자동화별 서버 저장 설정 재사용
- 사용자별 연동 프로필 등록
- 자동화별 연동 프로필 선택 또는 커스텀 직접 입력
- GitHub issue, commit, pull request RAG 수집 대상 설정
- Notion database/page RAG 수집 대상 설정
- 사용자별 API token/API key 서버 저장 및 응답 마스킹
- 자동화별 AI provider/model/API base 선택
- 사용자별 RAG 지식자료 저장
- 텍스트 문서 내용 추출 저장
- 문서, 음성, 이미지, 영상, 표/엑셀, 기타 파일의 설명/작성 지침 저장
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

게시글, 자동화 공유글, 사용자별 서버 저장 지식자료를 지식 베이스로 사용합니다. 사용자가 질문하거나 Agent가 중복/유사성을 판단할 때 기존 게시글과 지식자료를 검색하고, 관련 근거와 요약을 반환합니다.

RAG는 Retrieval-Augmented Generation의 약자입니다. LLM이 기억만으로 답하는 대신, 먼저 우리 서비스의 게시글/자동화 결과/사용자 지식자료에서 관련 기록을 검색하고 그 검색 결과를 근거로 답변하게 만드는 방식입니다. 이 프로젝트에서는 `backend/app/services.py`의 `similar_posts()`, `similar_knowledge()`, `rag_answer()`가 그 역할을 하며, `/api/knowledge/rag` API와 API 실행 콘솔의 `RAG` 버튼으로 확인할 수 있습니다.

RAG에 넣을만한 자료:

- 게시판 운영 규칙, 금칙어, 모더레이션 기준
- GitHub 이슈 작성 규칙, 라벨/마일스톤/칸반 사용 규칙
- Notion 업무 DB 필드 설명과 상태 전환 규칙
- Figma 디자인 리뷰 체크리스트
- Google Calendar 일정 작성 규칙
- 회의록, 음성 녹취 요약, 수업/과제 지침
- PDF/문서의 핵심 내용, 표/엑셀의 주요 컬럼 설명
- 이미지 설명, 화면 캡처 설명, 디자인 QA 기준
- API 사용법, 사내 시스템 작업 절차, 실패 시 대응법

외부 시스템 RAG:

- GitHub: `issues`, `commits`, `pull_requests`를 연동 프로필의 RAG 수집 대상으로 설정할 수 있습니다.
- Notion: `notion_database`, `notion_pages`를 연동 프로필의 RAG 수집 대상으로 설정할 수 있습니다.
- 기타: Jira, Slack, GitLab, 사내 REST API 등은 `custom` 연동 프로필로 등록하고 대상 이름을 자유롭게 넣을 수 있습니다.
- 자동화 실행 결과에는 `externalRagSources`가 포함되어 어떤 외부 소스를 어떤 API와 토큰 상태로 읽을지 표시합니다.
- 실제 외부 fetch는 사용자가 저장한 연동 프로필의 `source_kind`, `base_url`, `api_provider`, `token_name/token_value`, `rag_targets`를 기준으로 붙이면 됩니다.
- GitHub/Notion은 `/api/integration-profiles/{profile_id}/collect`로 실제 수집기가 연결되어 있습니다. 토큰이 저장된 프로필이면 GitHub issues/commits/pull requests, Notion database/page를 읽어 `knowledge_sources`에 저장합니다.
- 수집 API는 `?limit=20&pages=2`처럼 페이지당 개수와 최대 페이지 수를 받을 수 있고, 쿼리를 생략하면 연동 프로필에 저장된 `collect_limit`, `collect_pages`를 사용합니다. GitHub는 REST `page/per_page`, Notion은 `next_cursor`를 따라가며 UI 버튼은 각 프로필에 저장된 범위를 그대로 실행합니다.
- 같은 사용자에게 이미 저장된 외부 URL과 소스 타입은 중복 저장하지 않고 `unchanged`와 `skippedDuplicates`로 반환합니다. 반복 자동화가 같은 항목을 계속 쌓지 않도록 변경분 중심으로 동작합니다.
- 연동 프로필 카드에는 최근 수집 상태, 읽은 항목 수, 새로 저장한 항목 수, 중복 건수, 경고 메시지, 수집 시간을 표시합니다.
- 토큰이 없는 프로필이면 수집을 중단하고 `warnings`에 필요한 토큰 정보를 반환합니다.
- 다른 사용자의 연동 프로필 ID를 자동화에 넣으면 403으로 차단합니다.

관련 API:

- `POST /api/ai/rag`
- `POST /api/knowledge/rag`
- `GET /api/knowledge`
- `POST /api/knowledge`
- `POST /api/knowledge/upload`
- `DELETE /api/knowledge/{source_id}`
- `GET /api/integration-profiles`
- `POST /api/integration-profiles`
- `DELETE /api/integration-profiles/{profile_id}`
- `POST /api/integration-profiles/{profile_id}/write`: Figma comment 또는 Google Calendar event live write를 실행합니다. 기본 `dry_run=true`는 실제 외부 변경 없이 요청 URL과 payload를 검증하고, 토큰/URL이 준비된 사용자가 `dry_run=false`로 호출하면 실제 API를 호출합니다.
- `GET /api/provider-readiness`: 사용자별 연동 프로필, 암호화 토큰, URL을 기준으로 GitHub/Notion/Figma/Google Calendar live write 준비 상태를 반환합니다.
- `GET /api/integration-activities`: 사용자별 연동 프로필 저장, 외부 RAG 수집, live write, 자동화 생성/실행/공유 활동 로그를 반환합니다. `provider`, `status`, `event_type`, `automation_task_id`, `integration_profile_id`, `limit` 쿼리로 필터링할 수 있습니다.

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
- `POST /api/automations/scheduler/tick`
- `POST /api/integrations/hub/run`
- `POST /api/ai/agent/moderate`
- `GET /api/profile/settings`
- `PUT /api/profile/settings`

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

Scheduler tick:

- `POST /api/automations/scheduler/tick` finds due ACTIVE automations by `last_run_at + interval_minutes`.
- Normal users run only their own due automations. Admin users can tick all due automations.
- Each scheduled run uses the same no-change guard as manual run. If watched input is unchanged, the run is recorded as `skipped`.
- In production, call this endpoint from cron, Windows Task Scheduler, systemd timer, Vercel Cron, or CI schedule.

- `Health`: `GET /api/health`
- `RAG`: `POST /api/ai/rag`
- `MCP`: `POST /mcp/rpc`
- `Agent Hub`: `POST /api/integrations/hub/run`

응답은 우측 `API` 탭에 JSON으로 표시됩니다.

## 사용자별 외부 사이트 설정

자동화 등록 폼의 중심은 `커스텀 연결 칸`입니다. 사용자는 연결을 필요한 만큼 추가할 수 있고, Notion/Figma에 고정되지 않습니다.

서버 저장값:

- `서버 저장값 불러오기`: 현재 로그인한 사용자의 저장된 연결 칸, AI 모델, API base, API Key 관리 전략, 커스텀 템플릿을 자동화 폼에 복사합니다.
- `현재 설정 서버 저장`: 현재 자동화 폼의 연결 칸과 AI/API/템플릿 설정을 `users` 테이블의 사용자별 서버 저장값으로 저장합니다.
- 저장된 서버 설정은 새 자동화를 만들 때마다 재사용할 수 있습니다.
- 자동화 작업은 서버 저장값을 복사해 생성되므로, 자동화별로 다른 연결/템플릿을 갖도록 수정할 수 있습니다.
- 실제 API Key 원문은 저장하지 않고 `NOTION_TOKEN`, `FIGMA_TOKEN`, `JIRA_TOKEN` 같은 토큰 변수명만 저장합니다.

연동 프로필:

- 사용자가 여러 개의 GitHub/Notion/커스텀 API 프로필을 등록할 수 있습니다.
- 각 프로필은 `종류`, `Base URL`, `요청 API`, `토큰 이름`, `토큰/API Key`, `AI 제공자`, `AI 모델`, `AI API Base`, `RAG가 볼 대상`, `Collect limit`, `Collect pages`, `프로필 템플릿`을 가집니다.
- 자동화 등록 화면에서 `저장된 연동 프로필`을 선택하면 해당 프로필의 API/AI/연결/RAG 설정이 자동화에 복사됩니다.
- 같은 사용자라도 자동화 A는 GitHub + gpt-4o-mini, 자동화 B는 Notion + 사내 모델처럼 다르게 선택할 수 있습니다.
- API 응답은 토큰 원문을 반환하지 않고 `hasToken`, `tokenPreview`, `tokenStorage`만 반환합니다.
- 새로 저장되는 `token_value`는 `enc:v1:` 형식으로 DB에 암호화 저장됩니다. 운영 환경에서는 `AI_BOARD_TOKEN_ENCRYPTION_SECRET`을 `AI_BOARD_JWT_SECRET`과 다른 긴 랜덤 값으로 설정하십시오.
- 기존 데모 DB의 평문 토큰은 읽기 호환을 위해 `tokenStorage: legacy`로 표시되며, 새로 저장하는 프로필부터 암호화됩니다.

RAG 지식자료:

- 직접 입력: 문서 내용, 회의 요약, 이미지 설명, 표의 핵심 값 등을 `직접 입력할 내용`에 작성합니다.
- 파일 업로드: 텍스트 파일은 서버가 내용을 읽어 RAG 검색 대상에 넣습니다.
- 음성/이미지/PDF/기타 바이너리: 파일명, MIME type, 사용자가 작성한 `어디에 어떻게 작성/사용할지` 지침을 RAG 근거로 저장합니다.
- 이후 OCR/STT 또는 PDF 파서가 필요하면 같은 `knowledge_sources.extracted_text` 필드에 추출 결과를 업데이트하면 됩니다.

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

Live write readiness:

- 연동 프로필 목록 상단의 `Live Write Readiness` 카드가 GitHub, Notion, Figma, Google Calendar별 live write 준비 여부를 표시합니다.
- Figma는 `source_kind=figma` 또는 custom connection `service=figma`, Figma file URL, `FIGMA_TOKEN` 토큰이 있는 프로필이면 ready입니다.
- Google Calendar는 `source_kind=google_calendar` 또는 custom connection `service=google_calendar`, calendar id, `GOOGLE_CALENDAR_TOKEN` 토큰이 있는 프로필이면 ready입니다.
- Figma/Google Calendar 프로필 카드의 `Live write check` 버튼은 `dry_run=true`로 실제 요청 payload를 확인합니다. 실제 변경은 같은 엔드포인트에 `dry_run=false`를 보내야 하며, 이때 사용자별로 저장된 암호화 토큰만 사용합니다.
- `Integration Activity Log`에는 profile save, RAG collect, live write, automation run/share 같은 작업 이력이 사용자별로 표시됩니다. provider/status/event/automation/profile 필터를 제공하며, 다른 사용자의 활동 로그는 조회되지 않습니다.

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
