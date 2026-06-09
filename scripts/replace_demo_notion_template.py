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
SOURCE_URL = "https://app.notion.com/p/302-1-2-3797051c2f998088994ee86e76ec7e35"
DEMO_URL = DEMO_PAGE_ID
DEMO_PUBLIC_URL = f"https://app.notion.com/p/302-1-1-{DEMO_PAGE_ID}"


def rich(text: str, limit: int = 1900) -> list[dict]:
    return [{"type": "text", "text": {"content": str(text)[:limit]}}]


def block(kind: str, text: str = "") -> dict:
    if kind == "divider":
        return {"object": "block", "type": "divider", "divider": {}}
    return {"object": "block", "type": kind, kind: {"rich_text": rich(text, 200 if kind.startswith("heading") else 1900)}}


def paragraph(text: str = "") -> dict:
    return block("paragraph", text)


def bullet(text: str) -> dict:
    return block("bulleted_list_item", text)


def heading(level: int, text: str) -> dict:
    return block(f"heading_{level}", text)


def callout(text: str, emoji: str = "📌", children: list[dict] | None = None) -> dict:
    payload = {
        "rich_text": rich(text, 1900),
        "icon": {"type": "emoji", "emoji": emoji},
    }
    if children:
        payload["children"] = children
    return {"object": "block", "type": "callout", "callout": payload}


def column(children: list[dict]) -> dict:
    return {"object": "block", "type": "column", "column": {"children": children}}


def column_list(columns: list[list[dict]]) -> dict:
    return {"object": "block", "type": "column_list", "column_list": {"children": [column(items) for items in columns]}}


def toggle(text: str, children: list[dict]) -> dict:
    return {"object": "block", "type": "toggle", "toggle": {"rich_text": rich(text, 1900), "children": children}}


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


def update_page_title(headers: dict, title: str) -> None:
    page = httpx.get(f"https://api.notion.com/v1/pages/{DEMO_PAGE_ID}", headers=headers, timeout=30)
    page.raise_for_status()
    title_key = None
    for key, prop in page.json().get("properties", {}).items():
        if prop.get("type") == "title":
            title_key = key
            break
    if not title_key:
        return
    response = httpx.patch(
        f"https://api.notion.com/v1/pages/{DEMO_PAGE_ID}",
        headers=headers,
        json={"properties": {title_key: {"title": rich(title, 200)}}},
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
        update_page_title(headers, "302호 1팀 나만무 프로젝트 (시범 도입용)")
        children = [
            block("divider"),
            column_list(
                [
                    [
                        callout("팀 미팅 일정", "🗓️"),
                        bullet("매일 오전 10시 & 오후 8시"),
                        callout("구글 드라이브 링크", "📁"),
                        bullet("바로가기: https://drive.google.com/drive/folders/1mIj_DWr7H0EPCzoIk_XijSm13FdYlQ8q?usp=sharing"),
                    ],
                    [
                        callout("팀 레포지토리 링크 ↗️ (아직 없음)", "💻"),
                        callout("개인 과제 레포지토리 링크를 추가해주세요!", "🔗"),
                        callout("피그마 링크 ↗️ (아직 없음)", "🎨"),
                        paragraph(""),
                    ],
                ]
            ),
            callout("원본 Notion 데이터베이스 뷰는 API로 신규 생성할 수 없어 아래 BOARD/GANTT 표와 자동화 로그로 대체합니다. 기준 템플릿: " + SOURCE_URL, "ℹ️"),
            heading(2, "PAGES"),
            column_list(
                [
                    [callout("서비스 소개", "🧭"), callout("회의록", "📝")],
                    [callout("멤버", "👥"), callout("컨벤션", "📐")],
                    [callout("팀 규칙", "✅"), callout("문서", "📚")],
                ]
            ),
            block("divider"),
            heading(2, "BOARD"),
            callout("원본의 BOARD 데이터베이스 뷰 대체", "📋"),
            table([["상태", "업무", "설명"], ["Not started", "3", "원본 템플릿 기본 대기 업무"], ["In progress", "0", "진행 중 업무"], ["Done", "0", "완료 업무"]]),
            block("divider"),
            heading(2, "GANTT CHART"),
            callout("원본의 GANTT 데이터베이스 뷰 대체", "📅"),
            table([["항목", "시작", "종료", "상태"], ["프로젝트 일정", "미정", "미정", "계획 필요"]]),
            block("divider"),
            toggle(
                "gitHub 연동하기",
                [
                    callout("GitHub -> Notion", "🔁"),
                    paragraph("최신 커밋과 이슈를 읽어 아래 AI Board 자동화 로그에 한국어 표로 작성합니다."),
                    callout("Notion -> GitHub", "📮"),
                    paragraph("Notion 변경 요청을 감지하면 GitHub 이슈로 등록하도록 자동화 연결을 유지합니다."),
                ],
            ),
            toggle(
                "숨김페이지",
                [
                    callout("팀 규칙", "✅", [bullet("돌아가면서 회의록 작성"), bullet("공지 확인 후 12시간 내 답장"), bullet("공부하다 모르는 내용은 공유")]),
                    callout("서비스 소개", "🧭", [paragraph("서비스 소개 초안과 기획 내용을 정리하는 공간입니다.")]),
                    callout("회의록", "📝", [paragraph("회의록 작성 순서와 회의 기록을 관리합니다.")]),
                    callout("멤버", "👥", [paragraph("팀원 정보와 역할을 관리합니다.")]),
                    callout("문서", "📚", [bullet("API 명세"), bullet("프로젝트 제안서"), bullet("시스템 요구사항 명세서"), bullet("프로젝트 최종 보고서")]),
                    callout("컨벤션", "📐", [paragraph("코드/커밋/브랜치 컨벤션을 관리합니다.")]),
                ],
            ),
            block("divider"),
            heading(2, "AI Board 자동화 로그"),
            paragraph("아래 영역만 자동화가 GitHub/Notion 변경사항을 읽고 씁니다. 위 템플릿 영역은 원본형 구조를 유지합니다."),
            heading(3, "GitHub 이슈 생성 템플릿"),
            code(
                "제목: [AI Board] {title}\n"
                "본문:\n"
                "- 요약: {summary}\n"
                "- 원본 링크: {source_url}\n"
                "- 처리 기준: 이 Notion 데모 템플릿의 BOARD/PAGES/GANTT 맥락에 맞춰 업무 이슈로 정리\n"
                "라벨: ai-board, automation"
            ),
            heading(3, "GitHub 변경사항 Notion 보고 템플릿"),
            table(
                [
                    ["번호", "유형", "제목", "한국어 요약", "영향 영역", "다음 조치", "링크"],
                    ["{index}", "{source_type}", "{title}", "{summary}", "BOARD/PAGES/GANTT", "요청 템플릿 기준으로 검토", "{source_url}"],
                ]
            ),
            heading(3, "Notion 변경사항 GitHub 반영 템플릿"),
            code(
                "Notion에서 추가/수정된 요청을 읽고 필요한 경우 GitHub 이슈로 등록합니다.\n"
                "이슈 제목: [Notion 요청] {title}\n"
                "본문: {summary}\n"
                "링크: {source_url}"
            ),
            block("divider"),
            paragraph(f"템플릿 재구성 시각: {datetime.now().isoformat(timespec='seconds')}"),
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
