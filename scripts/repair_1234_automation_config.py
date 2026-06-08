from __future__ import annotations

import json

from backend.app.db import SessionLocal
from backend.app.models import AutomationTask, IntegrationProfile, User


USER_EMAIL = "1234@example.com"
GITHUB_URL = "https://github.com/Wish-Upon-A-Star/ai-board-jungle"
NOTION_URL = "https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8"


def main() -> None:
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == USER_EMAIL).first()
        if not user:
            raise SystemExit(f"missing user: {USER_EMAIL}")
        github_profile = (
            db.query(IntegrationProfile)
            .filter(IntegrationProfile.owner_id == user.id, IntegrationProfile.source_kind == "github")
            .order_by(IntegrationProfile.id.desc())
            .first()
        )
        notion_profile = (
            db.query(IntegrationProfile)
            .filter(IntegrationProfile.owner_id == user.id, IntegrationProfile.source_kind == "notion")
            .order_by(IntegrationProfile.id.desc())
            .first()
        )
        task = (
            db.query(AutomationTask)
            .filter(AutomationTask.owner_id == user.id)
            .order_by(AutomationTask.id.desc())
            .first()
        )
        if not github_profile or not notion_profile or not task:
            raise SystemExit("missing profile or task")

        github_profile.base_url = GITHUB_URL
        github_profile.custom_connections = json.dumps(
            [
                {
                    "label": "우리 GitHub 저장소",
                    "service": "github",
                    "url": GITHUB_URL,
                    "api": "GitHub REST API / MCP OAuth",
                    "auth_key_name": "GITHUB_OAUTH",
                    "operation": "latest_commits_and_issues_to_notion_report",
                    "template": "최신 커밋과 이슈를 한국어 표로 요약합니다.",
                }
            ],
            ensure_ascii=False,
        )
        notion_profile.base_url = NOTION_URL
        notion_profile.custom_connections = json.dumps(
            [
                {
                    "label": "AI Board GitHub Automation Demo",
                    "service": "notion",
                    "url": NOTION_URL,
                    "api": "Notion API / MCP OAuth",
                    "auth_key_name": "NOTION_OAUTH",
                    "operation": "append_korean_status_table",
                    "template": "GitHub 변경사항을 한국어 표와 체크리스트로 정리합니다.",
                }
            ],
            ensure_ascii=False,
        )
        task.integration_profile_id = github_profile.id
        task.github_repo_url = GITHUB_URL
        task.notion_database_url = NOTION_URL
        task.source = "GitHub MCP OAuth: Wish-Upon-A-Star/ai-board-jungle"
        task.destination = "Notion MCP OAuth: AI Board GitHub Automation Demo"
        task.instruction = (
            "우리 GitHub 저장소의 최신 커밋과 이슈 변경사항을 수집하고, "
            "데모 Notion 페이지에 한국어 표 형식으로 자동 정리한다. "
            "Notion 변경사항이 있으면 최근 히스토리에 반영하고 후속 GitHub 작업 후보를 남긴다."
        )
        task.template = (
            "## GitHub → Notion 자동화 리포트\n"
            "| 구분 | 제목 | 작성자 | 날짜 | 요약 | 링크 |\n"
            "|---|---|---|---|---|---|\n"
            "{items}\n\n"
            "### 다음 확인 사항\n"
            "{risks}"
        )
        task.custom_connections = json.dumps(
            [
                {
                    "label": "우리 GitHub 저장소",
                    "service": "github",
                    "url": GITHUB_URL,
                    "api": "GitHub REST API / MCP OAuth",
                    "auth_key_name": "GITHUB_OAUTH",
                    "operation": "latest_commits_and_issues_to_notion_report",
                    "template": "최신 커밋 5개와 최근 이슈 변경사항을 한국어 표로 요약합니다.",
                },
                {
                    "label": "AI Board GitHub Automation Demo",
                    "service": "notion",
                    "url": NOTION_URL,
                    "api": "Notion API / MCP OAuth",
                    "auth_key_name": "NOTION_OAUTH",
                    "operation": "append_korean_status_table",
                    "template": "GitHub 변경사항을 한국어 표와 체크리스트로 정리합니다.",
                },
            ],
            ensure_ascii=False,
        )
        db.commit()
        print(
            json.dumps(
                {
                    "userId": user.id,
                    "taskId": task.id,
                    "githubProfileId": github_profile.id,
                    "notionProfileId": notion_profile.id,
                    "status": "repaired",
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
