from __future__ import annotations

import json
import os

import httpx

os.environ.setdefault("AI_BOARD_DATABASE_URL", "postgresql://ai_board:ai_board@localhost:5432/ai_board")

from app.db import SessionLocal
from app.models import AutomationTask, IntegrationProfile
from app.security import reveal_secret


DEMO_PAGE_ID = "3797051c2f998094b2a5e5062d353881"


def create_kanban_database(headers: dict) -> dict:
    payload = {
        "parent": {"type": "page_id", "page_id": DEMO_PAGE_ID},
        "title": [{"type": "text", "text": {"content": "AI Board 자동화 칸반"}}],
        "properties": {
            "title": {"title": {}},
            "상태": {
                "select": {
                    "options": [
                        {"name": "Not started", "color": "gray"},
                        {"name": "In progress", "color": "blue"},
                        {"name": "Done", "color": "green"},
                        {"name": "Blocked", "color": "red"},
                    ]
                }
            },
            "유형": {
                "select": {
                    "options": [
                        {"name": "github_commit", "color": "purple"},
                        {"name": "github_issue", "color": "yellow"},
                        {"name": "notion_change", "color": "orange"},
                        {"name": "automation_report", "color": "blue"},
                    ]
                }
            },
            "한국어 요약": {"rich_text": {}},
            "영향 영역": {
                "multi_select": {
                    "options": [
                        {"name": "BOARD", "color": "blue"},
                        {"name": "PAGES", "color": "green"},
                        {"name": "GANTT", "color": "purple"},
                    ]
                }
            },
            "다음 조치": {"rich_text": {}},
            "링크": {"url": {}},
            "자동화 실행": {"number": {"format": "number"}},
        },
    }
    response = httpx.post("https://api.notion.com/v1/databases", headers=headers, json=payload, timeout=30)
    response.raise_for_status()
    return response.json()


def update_ai_board_targets(session: SessionLocal, database_id: str) -> None:
    notion_template = "KANBAN_DB: title / 상태 / 유형 / 한국어 요약 / 영향 영역 / 다음 조치 / 링크"
    task = session.get(AutomationTask, 4)
    if task:
        task.notion_database_url = database_id
        task.notion_template = notion_template
        task.request_template = notion_template
        task.template = notion_template
        task.custom_template = notion_template
        task.instruction = (
            "GitHub 최신 커밋과 이슈를 읽어 Notion AI Board 자동화 칸반 DB에 카드로 등록하고, "
            "상태 속성으로 Not started/In progress/Done 보드 흐름을 관리합니다."
        )
        connections = json.loads(task.custom_connections or "[]")
        for connection in connections:
            if str(connection.get("service", "")).lower() == "notion":
                connection["label"] = "AI Board 자동화 칸반 DB"
                connection["url"] = database_id
                connection["operation"] = "upsert_kanban_cards"
                connection["template"] = notion_template
        task.custom_connections = json.dumps(connections, ensure_ascii=False)
        task.last_input_hash = "force-kanban-database-target"

    profile = session.get(IntegrationProfile, 8)
    if profile:
        profile.base_url = database_id
        profile.custom_connections = json.dumps(
            [
                {
                    "label": "AI Board 자동화 칸반 DB",
                    "service": "notion",
                    "url": database_id,
                    "api": "Notion API / MCP OAuth",
                    "auth_key_name": "NOTION_OAUTH",
                    "operation": "upsert_kanban_cards",
                    "template": notion_template,
                }
            ],
            ensure_ascii=False,
        )


def main() -> None:
    session = SessionLocal()
    try:
        profile = session.get(IntegrationProfile, 8)
        if not profile:
            raise RuntimeError("Notion integration profile id=8 not found.")
        token = reveal_secret(profile.token_value)
        headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
        database = create_kanban_database(headers)
        database_id = database["id"].replace("-", "")
        update_ai_board_targets(session, database_id)
        session.commit()
        print(json.dumps({"databaseId": database_id, "url": database.get("url"), "properties": list(database.get("properties", {}).keys())}, ensure_ascii=False, indent=2))
    finally:
        session.close()


if __name__ == "__main__":
    main()
