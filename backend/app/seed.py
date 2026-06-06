from __future__ import annotations

import json

from .db import SessionLocal, init_db
from .models import AutomationTask, Post, User
from .security import hash_password
from .services import get_or_create_tags


def apply_task_defaults(task: AutomationTask, values: dict) -> None:
    for key, value in values.items():
        setattr(task, key, value)


def seed() -> None:
    init_db()
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.email == "admin@example.com").first():
            db.add(User(email="admin@example.com", name="관리자", password_hash=hash_password("password123"), role="ADMIN"))
            db.add(User(email="user@example.com", name="사용자", password_hash=hash_password("password123"), role="USER"))
            db.commit()

        admin = db.query(User).filter(User.email == "admin@example.com").first()
        user = db.query(User).filter(User.email == "user@example.com").first()

        if db.query(Post).count() == 0 and admin:
            samples = [
                ("GitHub 칸반과 업무 DB 동기화", "이슈와 업무 DB를 연결하고 변경이 있을 때만 반영하는 자동화 예시입니다.", ["github", "notion"]),
                ("커스텀 API 연결", "사용자가 Notion/Figma 외에도 Jira, Slack, Sheets, 사내 API 칸을 직접 추가할 수 있습니다.", ["custom", "api"]),
                ("RAG 기반 게시판 검색", "게시판 글과 자동화 기록을 검색해 유사 글 추천과 요약 답변을 제공합니다.", ["rag", "search"]),
            ]
            for title, content, tags in samples:
                post = Post(title=title, content=content, summary=content, author_id=admin.id)
                post.tags = get_or_create_tags(db, tags)
                db.add(post)
            db.commit()

        if admin and user:
            defaults = [
                (
                    "GitHub 이슈 -> 업무 DB 동기화",
                    admin.id,
                    {
                        "source": "GitHub Issues",
                        "destination": "업무 DB",
                        "interval_minutes": 5,
                        "instruction": "새 이슈와 변경된 이슈만 읽고, 선택한 업무 DB 템플릿에 맞춰 상태와 다음 액션을 반영한다.",
                        "template": "업무명 / 상태 / 원본 링크 / 요약 / 담당자 / 다음 액션",
                        "api_provider": "GitHub REST API + 사용자 지정 업무 DB API",
                        "ai_agent": "SyncPlannerAgent",
                        "github_repo_url": "https://github.com/<owner>/<repo>",
                        "github_project_url": "https://github.com/users/<owner>/projects/<number>",
                        "notion_database_url": "",
                        "figma_file_url": "",
                        "calendar_id": "",
                        "ai_provider": "OpenAI",
                        "ai_model": "gpt-4o-mini",
                        "ai_api_base": "https://api.openai.com/v1",
                        "api_key_strategy": "각 사용자가 자기 토큰 변수명을 연결 칸에 지정하고 서버 비밀 저장소에서 주입한다.",
                        "request_template": "요청 제목: {title}\n요청 이유: {reason}\n담당자: {assignee}\n원본 링크: {source_url}",
                        "github_issue_template": "제목: {title}\n본문: {summary}\n라벨: {labels}\n담당자: {assignee}",
                        "notion_template": "",
                        "figma_template": "",
                        "template_preset": "github_notion",
                        "custom_template": "업무명: {title}\n상태: {status}\n원본 링크: {source_url}\n요약: {summary}\n다음 액션: {next_action}",
                        "custom_connections": json.dumps(
                            [
                                {
                                    "label": "GitHub 이슈",
                                    "service": "github",
                                    "url": "https://github.com/<owner>/<repo>",
                                    "api": "GitHub REST API",
                                    "auth_key_name": "GITHUB_TOKEN",
                                    "operation": "read_changed_issues",
                                    "template": "제목: {title}\n본문: {summary}\n라벨: {labels}",
                                },
                                {
                                    "label": "업무 DB",
                                    "service": "notion",
                                    "url": "사용자가 입력한 DB URL",
                                    "api": "Notion API 또는 커스텀 업무 DB API",
                                    "auth_key_name": "TASK_DB_TOKEN",
                                    "operation": "upsert_task",
                                    "template": "업무명: {title}\n상태: {status}\n원본 링크: {source_url}",
                                },
                            ],
                            ensure_ascii=False,
                        ),
                    },
                ),
                (
                    "디자인/일정 확인 큐",
                    user.id,
                    {
                        "source": "AI Board Posts",
                        "destination": "사용자 지정 검토 도구",
                        "interval_minutes": 15,
                        "instruction": "게시판 요청에서 디자인 확인, 일정, 담당자를 추출해 사용자가 추가한 연결 칸의 API로 보낸다.",
                        "template": "요청명 / 검토 도구 / 일정 / 담당자 / 확인 기준",
                        "api_provider": "Figma API + Google Calendar API + 커스텀 API",
                        "ai_agent": "ReviewRouteAgent",
                        "github_repo_url": "",
                        "github_project_url": "",
                        "notion_database_url": "",
                        "figma_file_url": "https://www.figma.com/design/<fileKey>/<fileName>",
                        "calendar_id": "primary",
                        "ai_provider": "OpenAI",
                        "ai_model": "gpt-4o-mini",
                        "ai_api_base": "https://api.openai.com/v1",
                        "api_key_strategy": "각 연결 칸의 토큰 변수명을 사용자별로 저장한다.",
                        "request_template": "일정 제목: {title}\n시작: {start}\n종료: {end}\n설명: {summary}",
                        "github_issue_template": "",
                        "notion_template": "",
                        "figma_template": "섹션명: {title}\n확인 기준: {checklist}\n관련 게시글: {post_url}",
                        "template_preset": "figma_calendar",
                        "custom_template": "요청명: {title}\n검토 대상: {target}\n확인 기준: {checklist}\n마감: {due_date}",
                        "custom_connections": json.dumps(
                            [
                                {
                                    "label": "디자인 파일",
                                    "service": "figma",
                                    "url": "https://www.figma.com/design/<fileKey>/<fileName>",
                                    "api": "Figma REST API 또는 Figma MCP",
                                    "auth_key_name": "FIGMA_TOKEN",
                                    "operation": "create_review_comment",
                                    "template": "섹션명: {title}\n확인 기준: {checklist}",
                                },
                                {
                                    "label": "일정",
                                    "service": "google_calendar",
                                    "url": "primary",
                                    "api": "Google Calendar API",
                                    "auth_key_name": "GOOGLE_CALENDAR_TOKEN",
                                    "operation": "create_event",
                                    "template": "일정 제목: {title}\n시작: {start}\n종료: {end}",
                                },
                            ],
                            ensure_ascii=False,
                        ),
                    },
                ),
            ]
            profile_defaults = [(admin, defaults[0][2]), (user, defaults[1][2])]
            for profile_user, values in profile_defaults:
                profile_user.profile_ai_provider = values["ai_provider"]
                profile_user.profile_ai_model = values["ai_model"]
                profile_user.profile_ai_api_base = values["ai_api_base"]
                profile_user.profile_api_key_strategy = values["api_key_strategy"]
                profile_user.profile_template_preset = values["template_preset"]
                profile_user.profile_custom_template = values["custom_template"]
                profile_user.profile_custom_connections = values["custom_connections"]
            for name, owner_id, values in defaults:
                task = db.query(AutomationTask).filter(AutomationTask.name == name).first()
                if not task:
                    task = AutomationTask(name=name, owner_id=owner_id, **values)
                    db.add(task)
                else:
                    task.owner_id = owner_id
                    apply_task_defaults(task, values)
            db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
