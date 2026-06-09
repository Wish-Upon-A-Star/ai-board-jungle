const TEAM_GITHUB_REPO = "https://github.com/Wish-Upon-A-Star/ai-board-jungle";
const TEAM_NOTION_PAGE = "https://app.notion.com/p/302-1-1-3797051c2f998094b2a5e5062d353881";
const TEAM_NOTION_BOARD_DB = "4487051c2f9983488ed9018bbe475822";
const TEAM_NOTION_GANTT_DB = "35f7051c2f9982d6a3bf813799fc400b";

const aiDefaults = {
  ai_provider: "OpenAI",
  ai_model: "gpt-4o-mini",
  ai_api_base: "https://api.openai.com/v1",
  api_key_strategy: "사용자별 OAuth/API 프로필에 저장된 토큰을 사용합니다. 없으면 MCP/Profile 탭에서 먼저 로그인합니다.",
};

export const defaultAutomation = {
  name: "GitHub 변경사항을 Notion BOARD로 정리",
  integration_profile_id: "",
  source: "GitHub commits/issues/pull requests",
  destination: "Notion 템플릿 BOARD",
  interval_minutes: 10,
  instruction:
    "팀 GitHub 저장소의 최신 커밋, 이슈, PR을 읽고 현재 Notion 템플릿의 BOARD 섹션에 카드로 정리합니다. 원본 페이지 디자인은 유지하고 BOARD 데이터베이스에만 기록합니다.",
  template:
    "| 번호 | 유형 | 제목 | 한국어 요약 | 상태 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  api_provider: "GitHub REST/MCP + Notion API/MCP",
  ai_agent: "GithubToNotionBoardAgent",
  github_repo_url: TEAM_GITHUB_REPO,
  github_project_url: "",
  notion_database_url: TEAM_NOTION_PAGE,
  figma_file_url: "",
  calendar_id: "primary",
  ...aiDefaults,
  request_template:
    "| 번호 | 유형 | 제목 | 한국어 요약 | 상태 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  github_issue_template: "제목: {title}\n본문: {summary}\n라벨: ai-board, automation\n링크: {source_url}",
  notion_template:
    "| 번호 | 유형 | 제목 | 한국어 요약 | 상태 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  figma_template: "섹션명: {title}\n확인 기준: {checklist}\n관련 링크: {source_url}",
  template_preset: "github_notion",
  custom_template:
    "| 번호 | 유형 | 제목 | 한국어 요약 | 상태 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  custom_connections: [
    {
      label: "GitHub 저장소 변경 수집",
      service: "github",
      url: TEAM_GITHUB_REPO,
      api: "GitHub REST API / MCP OAuth",
      auth_key_name: "GITHUB_OAUTH",
      operation: "rag_collect_issues_commits_prs",
      template: "제목: {title}\n요약: {summary}\n링크: {url}",
    },
    {
      label: "Notion 템플릿 BOARD 카드",
      service: "notion",
      url: TEAM_NOTION_PAGE,
      api: "Notion API / MCP OAuth",
      auth_key_name: "NOTION_OAUTH",
      operation: "write_existing_page_board_cards",
      template: "제목: {title}\n요약: {summary}\n링크: {source_url}\n기존 템플릿의 BOARD 데이터베이스에 카드로 기록",
    },
  ],
};

export const teamNotionBoardToGithubPreset = {
  ...defaultAutomation,
  name: "Notion BOARD 요청을 GitHub 이슈로 등록",
  source: "Notion BOARD cards",
  destination: "GitHub issues",
  interval_minutes: 10,
  instruction:
    "현재 Notion 템플릿의 BOARD 카드 중 GitHub 조치가 필요한 항목을 읽고 GitHub 이슈로 생성하거나 기존 이슈를 업데이트합니다. GitHub 링크가 이미 있으면 중복 생성을 피합니다.",
  template:
    "## Notion BOARD 변경 요청\n- 제목: {title}\n- 요약: {summary}\n- 상태: {status}\n- 원본 Notion 링크: {source_url}\n- GitHub 조치:",
  api_provider: "Notion API/MCP + GitHub REST/MCP",
  ai_agent: "NotionBoardIssueAgent",
  github_repo_url: TEAM_GITHUB_REPO,
  notion_database_url: TEAM_NOTION_BOARD_DB,
  template_preset: "team_notion_board_to_github",
  custom_template: "Notion 카드: {title}\n요약: {summary}\n상태: {status}\n링크: {source_url}",
  request_template: "Notion 카드: {title}\n요약: {summary}\n상태: {status}\n링크: {source_url}",
  custom_connections: [
    {
      label: "Notion BOARD 변경 수집",
      service: "notion",
      url: TEAM_NOTION_BOARD_DB,
      api: "Notion API / MCP OAuth",
      auth_key_name: "NOTION_OAUTH",
      operation: "read_board_cards_since_last_run",
      template: "카드 제목: {title}\n요약: {summary}\n상태: {status}\n링크: {source_url}",
    },
    {
      label: "GitHub 이슈 생성/업데이트",
      service: "github",
      url: TEAM_GITHUB_REPO,
      api: "GitHub REST API / MCP OAuth",
      auth_key_name: "GITHUB_OAUTH",
      operation: "issue_create_or_update",
      template: "제목: [Notion] {title}\n본문: {summary}\n원본: {source_url}\n라벨: ai-board, notion-request",
    },
  ],
};

export const teamNotionGanttToCalendarPreset = {
  ...defaultAutomation,
  name: "Notion GANTT 일정을 Google Calendar로 반영",
  source: "Notion GANTT database",
  destination: "Google Calendar events",
  interval_minutes: 30,
  instruction:
    "현재 Notion 템플릿의 GANTT CHART 데이터베이스에서 날짜가 있는 작업을 읽고 Google Calendar 이벤트로 생성합니다. 제목은 GANTT의 이름, 기간은 날짜 속성, 설명은 Notion 링크와 상태를 사용합니다.",
  template: "GANTT 이름: {title}\n날짜: {date}\n상태: {status}\nNotion 링크: {source_url}",
  api_provider: "Notion API/MCP + Google Calendar API",
  ai_agent: "NotionGanttCalendarAgent",
  github_repo_url: "",
  notion_database_url: TEAM_NOTION_GANTT_DB,
  calendar_id: "primary",
  template_preset: "team_notion_gantt_to_calendar",
  custom_template: "일정 제목: {title}\n날짜: {date}\n상태: {status}\n링크: {source_url}",
  request_template: "일정 제목: {title}\n날짜: {date}\n상태: {status}\n링크: {source_url}",
  custom_connections: [
    {
      label: "Notion GANTT 수집",
      service: "notion",
      url: TEAM_NOTION_GANTT_DB,
      api: "Notion API / MCP OAuth",
      auth_key_name: "NOTION_OAUTH",
      operation: "read_gantt_rows_with_dates",
      template: "이름: {title}\n날짜: {date}\n상태: {status}\n링크: {source_url}",
    },
    {
      label: "Google Calendar 이벤트",
      service: "google_calendar",
      url: "primary",
      api: "Google Calendar API / OAuth",
      auth_key_name: "GOOGLE_CALENDAR_OAUTH",
      operation: "create_events_from_notion_gantt",
      template: "일정 제목: {title}\n시작/종료: {date}\n설명: {summary}",
    },
  ],
};

export const figmaCalendarPreset = {
  ...defaultAutomation,
  name: "Figma 검토 요청을 Google Calendar에 등록",
  source: "AI Board posts",
  destination: "Figma comments + Google Calendar",
  interval_minutes: 15,
  instruction:
    "게시글이나 요청에서 디자인 검토 항목과 마감일을 추출해 Figma 코멘트와 Google Calendar 일정으로 반영합니다.",
  template: "요청명 / 검토 도구 / 일정 / 담당자 / 확인 기준",
  api_provider: "Figma API + Google Calendar API",
  ai_agent: "ReviewRouteAgent",
  github_repo_url: "",
  notion_database_url: "",
  figma_file_url: "https://www.figma.com/design/<fileKey>/<fileName>",
  template_preset: "figma_calendar",
  custom_connections: [
    {
      label: "Figma 파일",
      service: "figma",
      url: "https://www.figma.com/design/<fileKey>/<fileName>",
      api: "Figma REST API / OAuth",
      auth_key_name: "FIGMA_OAUTH",
      operation: "create_review_comment",
      template: "섹션명: {title}\n확인 기준: {checklist}",
    },
    {
      label: "Google Calendar",
      service: "google_calendar",
      url: "primary",
      api: "Google Calendar API / OAuth",
      auth_key_name: "GOOGLE_CALENDAR_OAUTH",
      operation: "create_event",
      template: "일정 제목: {title}\n시작: {start}\n종료: {end}",
    },
  ],
};

export const customPreset = {
  ...defaultAutomation,
  name: "커스텀 API 자동화",
  source: "사용자 입력 소스",
  destination: "사용자 입력 대상",
  instruction: "연결 목록의 변경사항을 감지하고 선택한 템플릿에 맞춰 필요한 API로 반영합니다.",
  template: "원본 / 변경 내용 / 대상 API / 결과 / 다음 액션",
  api_provider: "사용자 지정 API",
  ai_agent: "CustomWorkflowAgent",
  template_preset: "custom",
  custom_connections: [
    {
      label: "커스텀 연결",
      service: "custom",
      url: "",
      api: "Custom REST API",
      auth_key_name: "CUSTOM_API_KEY",
      operation: "custom_action",
      template: "필드명: {value}\n링크: {source_url}\n다음 액션: {next_action}",
    },
  ],
};

export const mcpGithubToNotionPreset = defaultAutomation;
export const mcpNotionToGithubPreset = teamNotionBoardToGithubPreset;

export const defaultKnowledge = {
  title: "운영 자동화 지침",
  source_type: "document",
  instruction: "이 자료를 자동화 실행 지침과 RAG 응답 근거로 사용합니다.",
  extracted_text:
    "GitHub 변경사항은 Notion BOARD에 카드로 정리하고, Notion BOARD의 요청은 GitHub 이슈로 등록하며, Notion GANTT의 날짜 작업은 Google Calendar 이벤트로 반영합니다.",
  tags: "automation,rag,notion,github,calendar",
  file: null,
};

export const defaultIntegration = {
  name: "GitHub RAG 소스",
  source_kind: "github",
  base_url: TEAM_GITHUB_REPO,
  api_provider: "GitHub REST API / MCP OAuth",
  token_name: "GITHUB_TOKEN",
  token_value: "",
  auth_type: "oauth",
  mcp_server_url: "mcp://github",
  mcp_auth_subject: "",
  mcp_scopes: "repo,read:user",
  ai_provider: "OpenAI",
  ai_model: "gpt-4o-mini",
  ai_api_base: "https://api.openai.com/v1",
  rag_targets: "issues,commits,pull_requests",
  collect_limit: 20,
  collect_pages: 2,
  custom_connections: [
    {
      label: "GitHub 저장소",
      service: "github",
      url: TEAM_GITHUB_REPO,
      api: "GitHub REST API / MCP OAuth",
      auth_key_name: "GITHUB_OAUTH",
      operation: "rag_collect_issues_commits_prs",
      template: "제목: {title}\n요약: {summary}\n링크: {url}",
    },
  ],
  custom_template: "출처: {source}\n제목: {title}\n요약: {summary}\n링크: {url}",
};

export const integrationConnectionPresets = {
  github: {
    label: "GitHub 저장소",
    service: "github",
    url: TEAM_GITHUB_REPO,
    api: "GitHub REST API / MCP OAuth",
    auth_key_name: "GITHUB_OAUTH",
    operation: "rag_collect_issues_commits_prs",
    template: "제목: {title}\n요약: {summary}\n링크: {url}",
  },
  notion: {
    label: "Notion 템플릿 BOARD",
    service: "notion",
    url: TEAM_NOTION_PAGE,
    api: "Notion API / MCP OAuth",
    auth_key_name: "NOTION_OAUTH",
    operation: "write_existing_page_board_cards",
    template: "제목: {title}\n요약: {summary}\n링크: {source_url}\n기존 템플릿 BOARD DB에 카드 생성",
  },
  figma: {
    label: "Figma 파일",
    service: "figma",
    url: "https://www.figma.com/design/<fileKey>/<fileName>",
    api: "Figma REST API / OAuth",
    auth_key_name: "FIGMA_OAUTH",
    operation: "create_review_comment",
    template: "섹션명: {title}\n확인 기준: {checklist}",
  },
  google_calendar: {
    label: "Google Calendar",
    service: "google_calendar",
    url: "primary",
    api: "Google Calendar API / OAuth",
    auth_key_name: "GOOGLE_CALENDAR_OAUTH",
    operation: "create_event",
    template: "일정 제목: {title}\n시작: {start}\n종료: {end}",
  },
  custom: {
    label: "커스텀 연결",
    service: "custom",
    url: "",
    api: "Custom REST API",
    auth_key_name: "CUSTOM_API_KEY",
    operation: "custom_action",
    template: "필드명: {value}\n링크: {source_url}\n다음 액션: {next_action}",
  },
};

export const automationPresets = [
  defaultAutomation,
  teamNotionBoardToGithubPreset,
  teamNotionGanttToCalendarPreset,
  figmaCalendarPreset,
  customPreset,
];
