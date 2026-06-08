from __future__ import annotations

import json
import os
from datetime import datetime

import httpx

os.environ.setdefault("AI_BOARD_DATABASE_URL", "postgresql://ai_board:ai_board@localhost:5432/ai_board")

from app.db import SessionLocal
from app.models import AutomationTask, IntegrationProfile
from app.security import reveal_secret


DEMO_PAGE_ID = "3797051c2f998094b2a5e5062d353881"
SOURCE_URL = "https://app.notion.com/p/302-1-4658f48f3d8182a48f4d8150b766747d"
DEMO_URL = DEMO_PAGE_ID
DEMO_PUBLIC_URL = f"https://app.notion.com/p/302-1-1-{DEMO_PAGE_ID}"


def rich(text: str, limit: int = 1900) -> list[dict]:
    return [{"type": "text", "text": {"content": str(text)[:limit]}}]


def block(kind: str, text: str = "") -> dict:
    if kind == "divider":
        return {"object": "block", "type": "divider", "divider": {}}
    return {"object": "block", "type": kind, kind: {"rich_text": rich(text, 200 if kind.startswith("heading") else 1900)}}


def table(rows: list[list[str]]) -> dict:
    width = max(len(row) for row in rows)
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": width,
            "has_column_header": True,
            "has_row_header": False,
            "children": [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [rich(cell, 900) for cell in row + [""] * (width - len(row))]},
                }
                for row in rows
            ],
        },
    }


def code(text: str) -> dict:
    return {"object": "block", "type": "code", "code": {"rich_text": rich(text, 1900), "language": "plain text"}}


def collect_children(headers: dict) -> list[dict]:
    children: list[dict] = []
    cursor = None
    while True:
        params = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        response = httpx.get(
            f"https://api.notion.com/v1/blocks/{DEMO_PAGE_ID}/children",
            headers=headers,
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        children.extend(data.get("results", []))
        if not data.get("has_more"):
            return children
        cursor = data.get("next_cursor")


def archive_children(headers: dict) -> dict:
    archived = 0
    failed: list[dict] = []
    for child in collect_children(headers):
        response = httpx.patch(
            f"https://api.notion.com/v1/blocks/{child['id']}",
            headers=headers,
            json={"archived": True},
            timeout=30,
        )
        if response.is_success:
            archived += 1
        else:
            failed.append({"id": child["id"], "type": child.get("type"), "status": response.status_code, "body": response.text[:300]})
    return {"archived": archived, "failed": failed}


def append_children(headers: dict, children: list[dict]) -> None:
    for index in range(0, len(children), 100):
        response = httpx.patch(
            f"https://api.notion.com/v1/blocks/{DEMO_PAGE_ID}/children",
            headers=headers,
            json={"children": children[index : index + 100]},
            timeout=30,
        )
        response.raise_for_status()


def main() -> None:
    session = SessionLocal()
    try:
        profile = session.query(IntegrationProfile).filter(IntegrationProfile.id == 8).first()
        if not profile:
            raise RuntimeError("Notion integration profile id=8 not found.")
        token = reveal_secret(profile.token_value)
        headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}

        archive_result = archive_children(headers)
        children = [
            block("heading_1", "302호 1팀 나만무 프로젝트 (시범 도입용)"),
            block("quote", f"원본 템플릿 임시 복사본입니다. 원본 링크: {SOURCE_URL}"),
            block("heading_2", "기본 링크"),
            table(
                [
                    ["항목", "내용", "상태"],
                    ["팀 미팅 일정", "매일 오전 10시 & 오후 8시", "사용"],
                    ["구글 드라이브 링크", "https://drive.google.com/drive/folders/1mIj_DWr7H0EPCzoIk_XijSm13FdYlQ8q?usp=sharing", "연결"],
                    ["팀 레포지토리 링크", "아직 없음", "입력 필요"],
                    ["개인 과제 레포지토리 링크", "개인 과제 레포지토리 링크를 추가해주세요.", "입력 필요"],
                    ["피그마 링크", "아직 없음", "입력 필요"],
                ]
            ),
            block("heading_2", "PAGES"),
            block("bulleted_list_item", "서비스 소개"),
            block("bulleted_list_item", "회의록"),
            block("bulleted_list_item", "멤버"),
            block("bulleted_list_item", "컨벤션"),
            block("bulleted_list_item", "팀 규칙"),
            block("bulleted_list_item", "문서"),
            block("heading_2", "BOARD"),
            table([["상태", "개수"], ["Not started", "3"], ["In progress", "0"], ["Done", "0"]]),
            block("heading_2", "GANTT CHART"),
            block(
                "paragraph",
                "원본 템플릿의 간트차트/캘린더 뷰는 Notion 데이터베이스 뷰라 API 복제가 제한됩니다. 데모에서는 아래 자동화 보고 영역에 GitHub/Notion 변경사항을 계속 누적합니다.",
            ),
            block("heading_2", "AI Board 자동화 영역"),
            block(
                "paragraph",
                "이 영역부터 AI Board 자동화가 GitHub 이슈, 커밋, Notion 변경 요청을 읽고 결과를 한국어 보고서 또는 GitHub 이슈로 생성합니다.",
            ),
            block("heading_3", "GitHub 이슈 생성 템플릿"),
            code(
                "제목: [AI Board] {title}\n"
                "본문:\n"
                "- 요약: {summary}\n"
                "- 원본 링크: {source_url}\n"
                "- 처리 기준: 이 Notion 데모 템플릿의 BOARD/PAGES/GANTT 맥락에 맞춰 업무 이슈로 정리\n"
                "라벨: ai-board, automation"
            ),
            block("heading_3", "GitHub 변경사항 Notion 보고 템플릿"),
            table(
                [
                    ["번호", "유형", "제목", "한국어 요약", "영향 영역", "다음 조치", "링크"],
                    ["{index}", "{source_type}", "{title}", "{summary}", "BOARD/PAGES/GANTT", "요청 템플릿 기준으로 검토", "{source_url}"],
                ]
            ),
            block("heading_3", "Notion 변경사항 GitHub 반영 템플릿"),
            code(
                "Notion에서 추가/수정된 요청을 읽고 필요한 경우 GitHub 이슈로 등록합니다.\n"
                "이슈 제목: [Notion 요청] {title}\n"
                "본문: {summary}\n"
                "링크: {source_url}"
            ),
            block("divider"),
            block("paragraph", f"교체 시각: {datetime.now().isoformat(timespec='seconds')}"),
        ]
        append_children(headers, children)

        task = session.get(AutomationTask, 4)
        task_updated = False
        if task:
            notion_template = "| 번호 | 유형 | 제목 | 한국어 요약 | 영향 영역 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|"
            task.instruction = "데모 Notion 템플릿을 기준으로 GitHub 최신 커밋과 이슈를 읽어 한국어 보고서로 정리하고, Notion 변경 요청은 GitHub 이슈로 등록합니다."
            task.request_template = notion_template
            task.notion_template = notion_template
            task.github_issue_template = (
                "제목: [AI Board] {title}\n"
                "본문:\n"
                "- 요약: {summary}\n"
                "- 원본 링크: {source_url}\n"
                "- 처리 기준: 데모 Notion 템플릿의 BOARD/PAGES/GANTT 맥락에 맞춰 업무 이슈로 정리\n"
                "라벨: ai-board, automation"
            )
            task.template = notion_template
            task.custom_template = notion_template
            task.notion_database_url = DEMO_URL
            connections = json.loads(task.custom_connections or "[]")
            for connection in connections:
                if str(connection.get("service", "")).lower() == "notion":
                    connection["url"] = DEMO_URL
                    connection["label"] = "302호 1팀 나만무 데모 페이지"
                    connection["template"] = notion_template
                    connection["operation"] = "append_template_report"
            task.custom_connections = json.dumps(connections, ensure_ascii=False)
            task.last_input_hash = "force-demo-template-replaced-utf8"
            task_updated = True
            session.commit()

        print(json.dumps({"archive": archive_result, "appended": len(children), "task4Updated": task_updated}, ensure_ascii=False, indent=2))
    finally:
        session.close()


if __name__ == "__main__":
    main()
