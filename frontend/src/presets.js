export const defaultAutomation = {
  name: "GitHub 이슈를 Notion 업무로 동기화",
  integration_profile_id: "",
  source: "GitHub Issues",
  destination: "Notion Tasks DB",
  interval_minutes: 5,
  instruction: "새 이슈와 변경된 이슈를 수집해 상태, 링크, 요약, 다음 액션을 Notion에 반영합니다.",
  template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  api_provider: "GitHub REST API + Notion API",
  ai_agent: "SyncPlannerAgent",
  github_repo_url: "https://github.com/<owner>/<repo>",
  github_project_url: "https://github.com/users/<owner>/projects/<number>",
  notion_database_url: "https://www.notion.so/<workspace>/<database-id>",
  figma_file_url: "",
  calendar_id: "primary",
  ai_provider: "OpenAI",
  ai_model: "gpt-4o-mini",
  ai_api_base: "https://api.openai.com/v1",
  api_key_strategy: "사용자별 연동 프로필의 토큰을 서버에 저장하고 자동화 실행 때 선택된 프로필에서 불러옵니다.",
  request_template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  github_issue_template: "제목: {title}\n본문: {summary}\n라벨: ai-board, automation\n담당자: {assignee}",
  notion_template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  figma_template: "섹션명: {title}\n확인 기준: {checklist}\n관련 게시글: {post_url}",
  template_preset: "github_notion",
  custom_template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  custom_connections: [
    {
      label: "GitHub 변경사항 수집",
      service: "github",
      url: "https://github.com/<owner>/<repo>",
      api: "GitHub REST API",
      auth_key_name: "GITHUB_TOKEN",
      operation: "rag_collect_issues_commits_prs",
      template: "제목: {title}\n요약: {summary}\n링크: {url}",
    },
    {
      label: "Notion 자동화 리포트",
      service: "notion",
      url: "https://www.notion.so/<workspace>/<page-or-database-id>",
      api: "Notion API",
      auth_key_name: "NOTION_TOKEN",
      operation: "append_korean_status_table",
      template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    },
  ],
};

export const figmaCalendarPreset = {
  ...defaultAutomation,
  name: "게시판 요청을 Calendar/Figma 검토로 변환",
  source: "AI Board Posts",
  destination: "Google Calendar + Figma Review",
  interval_minutes: 15,
  instruction: "게시글 요청에서 디자인 확인 항목과 마감일을 추출해 Calendar 일정과 Figma 코멘트 초안을 만듭니다.",
  template: "요청명 / 검토 도구 / 일정 / 담당자 / 확인 기준",
  api_provider: "Google Calendar API + Figma API",
  ai_agent: "ReviewRouteAgent",
  github_repo_url: "",
  github_project_url: "",
  notion_database_url: "",
  figma_file_url: "https://www.figma.com/design/<fileKey>/<fileName>",
  template_preset: "figma_calendar",
  custom_connections: [
    { label: "Figma 파일", service: "figma", url: "https://www.figma.com/design/<fileKey>/<fileName>", api: "Figma REST API", auth_key_name: "FIGMA_TOKEN", operation: "create_review_comment", template: "섹션명: {title}\n확인 기준: {checklist}" },
    { label: "Google Calendar", service: "google_calendar", url: "primary", api: "Google Calendar API", auth_key_name: "GOOGLE_CALENDAR_TOKEN", operation: "create_event", template: "일정 제목: {title}\n시작: {start}\n종료: {end}" },
  ],
};

export const customPreset = {
  ...defaultAutomation,
  name: "커스텀 사이트/API 자동화",
  source: "사용자 입력 소스",
  destination: "사용자 입력 대상",
  instruction: "연결 목록의 변경사항을 감지하고 선택한 템플릿에 맞춰 필요한 외부 API에 반영합니다.",
  template: "원본 / 변경 내용 / 대상 API / 결과 / 다음 액션",
  api_provider: "사용자 지정 API",
  ai_agent: "CustomWorkflowAgent",
  template_preset: "custom",
  custom_connections: [
    { label: "커스텀 연결", service: "custom", url: "", api: "Custom REST API", auth_key_name: "CUSTOM_API_KEY", operation: "custom_action", template: "필드명: {value}\n링크: {source_url}\n다음 액션: {next_action}" },
  ],
};

export const mcpGithubToNotionPreset = {
  ...defaultAutomation,
  name: "MCP GitHub 최신 변경사항을 Notion으로 정리",
  source: "GitHub commits/issues via MCP",
  destination: "Notion Korean table report via MCP",
  interval_minutes: 10,
  instruction: "사용자 소유 MCP GitHub 프로필로 최근 커밋과 이슈를 읽고, 사용자 소유 Notion 프로필로 한국어 표 리포트를 작성합니다. 표에는 유형, 제목, 요약, 위험도, 다음 조치, 링크를 포함합니다.",
  template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
  api_provider: "GitHub MCP + Notion MCP",
  ai_agent: "McpCommitReporterAgent",
  template_preset: "mcp_github_to_notion",
  api_key_strategy: "사용자별 MCP OAuth 프로필을 사용합니다. 프로필이 없으면 MCP / Profiles 탭에서 GitHub와 Notion을 먼저 로그인합니다.",
  rag_targets: ["commits", "issues", "pull_requests"],
  custom_connections: [
    { label: "GitHub MCP 변경사항", service: "github", url: "https://github.com/<owner>/<repo>", api: "GitHub MCP", auth_key_name: "GITHUB_MCP_TOKEN", operation: "read_latest_commits_and_issues", template: "최근 변경사항: {commit_list}" },
    { label: "Notion MCP 표 리포트", service: "notion", url: "https://www.notion.so/<workspace>/<page-or-database-id>", api: "Notion MCP", auth_key_name: "NOTION_MCP_TOKEN", operation: "append_korean_status_table", template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|" },
  ],
};

export const mcpNotionToGithubPreset = {
  ...defaultAutomation,
  name: "MCP Notion 변경사항을 GitHub 이슈로 등록",
  source: "Notion changes since last run via MCP",
  destination: "GitHub issue via MCP",
  interval_minutes: 10,
  instruction: "사용자 소유 MCP Notion 프로필로 마지막 실행 이후 변경사항을 읽고, 개발 조치가 필요하면 사용자 소유 GitHub 프로필로 이슈를 생성하거나 업데이트합니다.",
  template: "## Notion 변경 히스토리\n- 변경 내용:\n- 결정 사항:\n- 미해결 문제:\n- GitHub 조치:",
  api_provider: "Notion MCP + GitHub MCP",
  ai_agent: "McpNotionHistoryIssueAgent",
  template_preset: "mcp_notion_to_github",
  api_key_strategy: "사용자별 MCP OAuth 프로필을 사용합니다. Notion과 GitHub 프로필이 모두 필요합니다.",
  rag_targets: ["notion_pages", "notion_database"],
  custom_connections: [
    { label: "Notion MCP 변경 히스토리", service: "notion", url: "https://www.notion.so/<workspace>/<page-or-database-id>", api: "Notion MCP", auth_key_name: "NOTION_MCP_TOKEN", operation: "read_changes_since_last_run", template: "마지막 실행 이후 Notion 변경사항: {notion_changes}" },
    { label: "GitHub MCP 이슈", service: "github", url: "https://github.com/<owner>/<repo>", api: "GitHub MCP", auth_key_name: "GITHUB_MCP_TOKEN", operation: "issue_create_or_update", template: "Issue title: {title}\nIssue body: {korean_history}" },
  ],
};

export const defaultKnowledge = {
  title: "운영 자동화 지침",
  source_type: "document",
  instruction: "이 자료를 자동화 실행 지침과 RAG 응답 근거로 사용합니다.",
  extracted_text: "GitHub 이슈에 bug 라벨이 있으면 Notion 업무 상태를 확인 필요로 작성합니다.",
  tags: "automation,rag",
  file: null,
};

export const defaultIntegration = {
  name: "GitHub RAG 소스",
  source_kind: "github",
  base_url: "https://github.com/<owner>/<repo>",
  api_provider: "GitHub REST API",
  token_name: "GITHUB_TOKEN",
  token_value: "",
  auth_type: "api_key",
  mcp_server_url: "",
  mcp_auth_subject: "",
  mcp_scopes: "",
  ai_provider: "OpenAI",
  ai_model: "gpt-4o-mini",
  ai_api_base: "https://api.openai.com/v1",
  rag_targets: "issues,commits,pull_requests",
  collect_limit: 20,
  collect_pages: 2,
  custom_connections: [
    { label: "GitHub 저장소", service: "github", url: "https://github.com/<owner>/<repo>", api: "GitHub REST API", auth_key_name: "GITHUB_TOKEN", operation: "rag_collect_issues_commits_prs", template: "제목: {title}\n요약: {summary}\n링크: {url}" },
  ],
  custom_template: "출처: {source}\n제목: {title}\n요약: {summary}\n링크: {url}",
};

export const integrationConnectionPresets = {
  github: { label: "GitHub 저장소", service: "github", url: "https://github.com/<owner>/<repo>", api: "GitHub REST API", auth_key_name: "GITHUB_TOKEN", operation: "rag_collect_issues_commits_prs", template: "제목: {title}\n요약: {summary}\n링크: {url}" },
  notion: { label: "Notion 표 리포트", service: "notion", url: "https://www.notion.so/<workspace>/<page-or-database-id>", api: "Notion API", auth_key_name: "NOTION_TOKEN", operation: "append_korean_status_table", template: "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|" },
  figma: { label: "Figma 파일", service: "figma", url: "https://www.figma.com/design/<fileKey>/<fileName>", api: "Figma REST API", auth_key_name: "FIGMA_TOKEN", operation: "create_review_comment", template: "섹션명: {title}\n확인 기준: {checklist}" },
  google_calendar: { label: "Google Calendar", service: "google_calendar", url: "primary", api: "Google Calendar API", auth_key_name: "GOOGLE_CALENDAR_TOKEN", operation: "create_event", template: "일정 제목: {title}\n시작: {start}\n종료: {end}" },
  custom: { label: "커스텀 연결", service: "custom", url: "", api: "Custom REST API", auth_key_name: "CUSTOM_API_KEY", operation: "custom_action", template: "필드명: {value}\n링크: {source_url}\n다음 액션: {next_action}" },
};

export const automationPresets = [defaultAutomation, mcpGithubToNotionPreset, mcpNotionToGithubPreset, figmaCalendarPreset, customPreset];
