export const defaultAutomation = {
  name: "GitHub 이슈를 Notion 업무로 동기화",
  integration_profile_id: "",
  source: "GitHub Issues",
  destination: "Notion Tasks DB",
  interval_minutes: 5,
  instruction: "새 이슈와 변경된 이슈를 요약하고 상태, 링크, 다음 액션을 Notion에 반영한다.",
  template: "업무명 / 상태 / GitHub 링크 / 요약 / 다음 액션",
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
  api_key_strategy: "사용자별 연동 프로필의 토큰을 서버에 저장하고 자동화 실행 시 선택한 프로필에서 불러온다.",
  request_template: "요청 제목: {title}\n요청 이유: {reason}\n담당자: {assignee}\n마감일: {due_date}\n관련 링크: {source_url}",
  github_issue_template: "제목: {title}\n본문: {summary}\n라벨: {labels}\n담당자: {assignee}",
  notion_template: "업무명: {title}\n상태: {status}\nGitHub 링크: {github_url}\n요약: {summary}\n다음 액션: {next_action}",
  figma_template: "섹션명: {title}\n확인 기준: {checklist}\n관련 게시글: {post_url}",
  template_preset: "github_notion",
  custom_template: "업무명: {title}\n상태: {status}\n원본 링크: {source_url}\n요약: {summary}\n다음 액션: {next_action}",
  custom_connections: [
    { label: "GitHub 이슈", service: "github", url: "https://github.com/<owner>/<repo>", api: "GitHub REST API", auth_key_name: "GITHUB_TOKEN", operation: "changed_issues_to_tasks", template: "제목: {title}\n본문: {summary}\n라벨: {labels}" },
    { label: "Notion 업무 DB", service: "notion", url: "https://www.notion.so/<workspace>/<database-id>", api: "Notion API", auth_key_name: "NOTION_TOKEN", operation: "upsert_task_page", template: "업무명: {title}\n상태: {status}\n요약: {summary}" },
  ],
};

export const figmaCalendarPreset = {
  ...defaultAutomation,
  name: "게시판 요청을 Calendar/Figma 검토로 변환",
  source: "AI Board Posts",
  destination: "Google Calendar + Figma Review",
  interval_minutes: 15,
  instruction: "게시글 요청에서 디자인 확인 항목과 마감일을 추출해 Calendar 일정과 Figma 코멘트 초안을 만든다.",
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
  name: "커스텀 사이트 API 자동화",
  source: "사용자 입력 소스",
  destination: "사용자 입력 대상",
  instruction: "연결 목록의 변경사항을 감지하고 선택한 템플릿에 맞춰 필요한 사이트 API에 반영한다.",
  template: "원본 / 변경 내용 / 대상 API / 결과 / 다음 액션",
  api_provider: "사용자 지정 API",
  ai_agent: "CustomWorkflowAgent",
  template_preset: "custom",
  custom_connections: [
    { label: "커스텀 연결", service: "custom", url: "", api: "Custom REST API", auth_key_name: "CUSTOM_API_KEY", operation: "custom_action", template: "필드명: {value}\n링크: {source_url}\n다음 액션: {next_action}" },
  ],
};

export const defaultKnowledge = {
  title: "운영 자동화 지침",
  source_type: "document",
  instruction: "이 자료를 자동화 실행 지침과 RAG 답변 근거로 사용한다.",
  extracted_text: "GitHub 이슈가 bug 라벨이면 Notion 업무 상태를 확인 필요로 작성한다.",
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
  ai_provider: "OpenAI",
  ai_model: "gpt-4o-mini",
  ai_api_base: "https://api.openai.com/v1",
  rag_targets: "issues,commits,pull_requests",
  collect_limit: 20,
  collect_pages: 2,
  custom_template: "출처: {source}\n제목: {title}\n요약: {summary}\n링크: {url}",
};

export const automationPresets = [defaultAutomation, figmaCalendarPreset, customPreset];
