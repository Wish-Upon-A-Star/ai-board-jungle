from __future__ import annotations

import re
import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from .collectors import extract_notion_id, parse_github_repo
from .models import IntegrationProfile
from .security import reveal_secret


def parse_figma_file_key(url_or_key: str) -> str:
    match = re.search(r"figma\.com/(?:file|design)/([A-Za-z0-9]+)", url_or_key)
    return match.group(1) if match else url_or_key.strip()


def profile_access_token(profile: IntegrationProfile) -> str:
    token = reveal_secret(profile.token_value)
    if not token:
        return ""
    try:
        payload = json.loads(token)
    except json.JSONDecodeError:
        return token
    if isinstance(payload, dict):
        return str(payload.get("access_token") or "")
    return token


def google_calendar_access_token(profile: IntegrationProfile) -> str:
    token = reveal_secret(profile.token_value)
    if not token:
        return ""
    try:
        payload = json.loads(token)
    except json.JSONDecodeError:
        return token
    if not isinstance(payload, dict):
        return token
    refresh_token = str(payload.get("refresh_token") or "")
    client_id = os.environ.get("AI_BOARD_GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.environ.get("AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    if refresh_token and client_id and client_secret:
        try:
            response = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
                timeout=15.0,
            )
            if response.is_success:
                refreshed = response.json()
                return str(refreshed.get("access_token") or payload.get("access_token") or "")
        except httpx.HTTPError:
            pass
    return str(payload.get("access_token") or "")


def safe_calendar_id(value: str) -> str:
    return value.strip() or "primary"


def write_github_issue(profile: IntegrationProfile, title: str, body: str, dry_run: bool = True, target_url: str | None = None) -> dict:
    token = profile_access_token(profile)
    repo = parse_github_repo(target_url or profile.base_url)
    if not token or not repo:
        return {"service": "github", "status": "blocked", "reason": "missing token or GitHub repository URL", "dryRun": dry_run}
    owner, name = repo
    url = f"https://api.github.com/repos/{owner}/{name}/issues"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {"title": title[:256], "body": body[:65000], "labels": ["ai-board", "automation"]}
    if dry_run:
        return {"service": "github", "status": "ready", "method": "POST", "url": url, "payload": payload, "dryRun": True}
    try:
        existing_response = httpx.get(
            url,
            headers=headers,
            params={"state": "open", "labels": "ai-board,automation", "per_page": 50},
            timeout=15.0,
        )
        if existing_response.is_success:
            existing_issues = existing_response.json()
            existing = next((issue for issue in existing_issues if issue.get("title") == payload["title"]), None)
            if existing:
                comment_url = existing.get("comments_url") or f"{url}/{existing.get('number')}/comments"
                comment_response = httpx.post(comment_url, headers=headers, json={"body": body[:65000]}, timeout=15.0)
                comment_data = (
                    comment_response.json()
                    if comment_response.headers.get("content-type", "").startswith("application/json")
                    else {"raw": comment_response.text}
                )
                if not comment_response.is_success:
                    return {"service": "github", "status": "failed", "code": comment_response.status_code, "response": comment_data, "dryRun": False, "mode": "comment"}
                return {
                    "service": "github",
                    "status": "updated",
                    "id": existing.get("number", ""),
                    "url": existing.get("html_url", ""),
                    "commentUrl": comment_data.get("html_url", ""),
                    "dryRun": False,
                    "mode": "comment",
                }
        response = httpx.post(url, headers=headers, json=payload, timeout=15.0)
    except httpx.HTTPError as exc:
        return {"service": "github", "status": "failed", "reason": str(exc), "dryRun": False}
    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
    if not response.is_success:
        return {"service": "github", "status": "failed", "code": response.status_code, "response": data, "dryRun": False}
    return {"service": "github", "status": "written", "id": data.get("number", ""), "url": data.get("html_url", ""), "dryRun": False}


def notion_text(content: str, limit: int = 1900) -> list[dict]:
    return [{"type": "text", "text": {"content": str(content or "")[:limit]}}]


def notion_table_row(field: str, value: str) -> dict:
    return {
        "object": "block",
        "type": "table_row",
        "table_row": {"cells": [notion_text(field, 400), notion_text(value, 1800)]},
    }


def notion_page_children(title: str, body: str) -> list[dict]:
    rows = [notion_table_row("Field", "Value"), notion_table_row("Title", title)]
    seen = {"title"}
    for line in str(body or "").splitlines():
        if ":" not in line:
            continue
        field, value = line.split(":", 1)
        field = field.strip().strip("-").strip()
        value = value.strip()
        key = field.lower()
        if not field or not value or key in seen or len(field) > 48:
            continue
        seen.add(key)
        rows.append(notion_table_row(field, value))
        if len(rows) >= 12:
            break
    if len(rows) <= 2:
        rows.append(notion_table_row("Body", body))
    return [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": notion_text(title, 200)},
        },
        {
            "object": "block",
            "type": "table",
            "table": {
                "table_width": 2,
                "has_column_header": True,
                "has_row_header": False,
                "children": rows,
            },
        },
    ]


def source_attr(source: object, name: str, default: str = "") -> str:
    if isinstance(source, dict):
        value = source.get(name, default)
    else:
        value = getattr(source, name, default)
    return str(value or "")


def source_context(source: object, index: int) -> dict[str, str]:
    title = source_attr(source, "title")
    source_type = source_attr(source, "source_type") or source_attr(source, "sourceType")
    url = source_attr(source, "file_name") or source_attr(source, "url")
    summary = source_attr(source, "extracted_text") or source_attr(source, "summary") or source_attr(source, "text")
    return {
        "index": str(index),
        "title": title,
        "summary": summary,
        "reason": summary,
        "source_url": url,
        "github_url": url,
        "url": url,
        "source_type": source_type,
        "status": "수집됨",
        "next_action": "요청 템플릿 기준으로 검토",
        "assignee": "",
        "due_date": "",
    }


def render_template(template: str, context: dict[str, str]) -> str:
    output = template or "{title}\n{summary}\n{source_url}"
    for key, value in context.items():
        output = output.replace("{" + key + "}", value)
    return output


def paragraph_block(text: str) -> dict:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {"rich_text": notion_text(text, 1900)},
    }


def append_notion_children(headers: dict, block_children_url: str, children: list[dict], timeout: float = 30.0) -> tuple[bool, dict]:
    results: list[dict] = []
    for index in range(0, len(children), 100):
        chunk = children[index : index + 100]
        response = httpx.patch(block_children_url, headers=headers, json={"children": chunk}, timeout=timeout)
        data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
        if not response.is_success:
            return False, {"code": response.status_code, "response": data, "chunkStart": index, "chunkSize": len(chunk)}
        results.append({"chunkStart": index, "chunkSize": len(chunk)})
    return True, {"chunks": results}


def notion_sources_template_children(title: str, sources: list[object], template: str) -> list[dict]:
    children = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": notion_text(title, 200)},
        },
        paragraph_block(f"총 {len(sources)}개 항목을 자동화 요청 템플릿으로 렌더링했습니다."),
    ]
    for index, source in enumerate(sources, start=1):
        context = source_context(source, index)
        children.append(
            {
                "object": "block",
                "type": "heading_3",
                "heading_3": {"rich_text": notion_text(f"{index}. {context['title']}", 200)},
            }
        )
        for line in render_template(template, context).strip().splitlines():
            children.append(paragraph_block(line))
        if index < len(sources):
            children.append({"object": "block", "type": "divider", "divider": {}})
    return children


def heading_2_block(text: str) -> dict:
    return {"object": "block", "type": "heading_2", "heading_2": {"rich_text": notion_text(text, 200)}}


def heading_3_block(text: str) -> dict:
    return {"object": "block", "type": "heading_3", "heading_3": {"rich_text": notion_text(text, 200)}}


def divider_block() -> dict:
    return {"object": "block", "type": "divider", "divider": {}}


def callout_block(text: str, emoji: str = "📌", children: list[dict] | None = None) -> dict:
    payload = {
        "rich_text": notion_text(text, 1800),
        "icon": {"type": "emoji", "emoji": emoji},
    }
    if children:
        payload["children"] = children
    return {"object": "block", "type": "callout", "callout": payload}


def column_block(children: list[dict]) -> dict:
    return {"object": "block", "type": "column", "column": {"children": children}}


def column_list_block(columns: list[list[dict]]) -> dict:
    return {"object": "block", "type": "column_list", "column_list": {"children": [column_block(column) for column in columns]}}


def toggle_block(text: str, children: list[dict]) -> dict:
    return {"object": "block", "type": "toggle", "toggle": {"rich_text": notion_text(text, 1800), "children": children}}


def markdown_table_rows(text: str) -> list[list[str]]:
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    table_lines = [line for line in lines if line.startswith("|") and line.endswith("|")]
    if len(table_lines) < 2:
        return []
    rows: list[list[str]] = []
    for line in table_lines:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells):
            continue
        rows.append(cells)
    if not rows:
        return []
    width = max(len(row) for row in rows)
    return [row + [""] * (width - len(row)) for row in rows]


def notion_table_block(rows: list[list[str]], header: bool = True) -> dict:
    width = max(1, max((len(row) for row in rows), default=1))
    normalized = [row + [""] * (width - len(row)) for row in rows]
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": width,
            "has_column_header": header,
            "has_row_header": False,
            "children": [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [notion_text(cell, 900) for cell in row]},
                }
                for row in normalized
            ],
        },
    }


def source_context(source: object, index: int) -> dict[str, str]:
    title = source_attr(source, "title")
    source_type = source_attr(source, "source_type") or source_attr(source, "sourceType")
    url = source_attr(source, "file_name") or source_attr(source, "url")
    summary = source_attr(source, "extracted_text") or source_attr(source, "summary") or source_attr(source, "text")
    return {
        "index": str(index),
        "title": title,
        "summary": summary,
        "reason": summary,
        "source_url": url,
        "github_url": url,
        "url": url,
        "source_type": source_type,
        "status": "수집됨",
        "next_action": "요청 템플릿 기준으로 검토",
        "assignee": "",
        "due_date": "",
    }


def commit_message_from_title(title: str) -> str:
    match = re.search(r"Commit\s+[0-9a-f]{7,40}:\s*(.+)$", title or "", re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return (title or "").strip()


def korean_commit_change_summary(message: str) -> str:
    normalized = " ".join((message or "").strip().split())
    exact = {
        "Fix Notion commit author summaries": "Notion 표의 커밋 요약에서 작성자명에 URL이 섞이던 문제를 수정했습니다.",
        "Improve Korean commit summaries": "GitHub 커밋을 Notion 표에 쓸 때 상태문이 아니라 실제 변경 내용을 한국어로 요약하도록 개선했습니다.",
        "Add Figma and Google Calendar OAuth login": "Figma와 Google Calendar를 OAuth 로그인으로 연결할 수 있도록 provider 설정, 로그인 버튼, 토큰 갱신 처리를 추가했습니다.",
        "Improve board readability and Notion table automation": "게시판 본문을 문단, 목록, 코드 블록 단위로 읽기 쉽게 만들고 Notion 자동화 결과를 실제 표 블록으로 작성하게 개선했습니다.",
        "Improve dashboard design and accessibility": "대시보드의 탭 구조, 정보 배치, 버튼 접근성, 시각 계층을 정리해 사용자가 기능을 찾기 쉽게 개선했습니다.",
        "Render Notion automation output from request templates": "자동화 요청 템플릿을 기준으로 Notion 출력 형식을 렌더링하도록 변경했습니다.",
        "Hydrate replayed Notion summaries": "Notion 재전송 시 저장된 수집 요약을 다시 채워 넣도록 보강했습니다.",
        "Clean obsolete summary assertions": "요약 테스트에 남아 있던 이전 assertion과 죽은 코드를 제거해 검증 로직을 정리했습니다.",
        "Describe cleanup commit summaries": "정리 커밋도 Notion에서 의미 있는 한국어 문장으로 표시되도록 커밋 요약 규칙을 보강했습니다.",
        "Load desktop OAuth credentials on live restart": "라이브 서버 재시작 시 바탕화면의 GitHub, Notion, Figma, Google OAuth 설정을 자동으로 읽도록 보강했습니다.",
        "Use Notion demo template page for reports": "302호 1팀 Notion 데모 페이지를 자동화 보고서 목적지로 사용하고, GitHub 변경사항을 해당 템플릿 표 양식에 맞춰 쓰도록 변경했습니다.",
        "Skip watched automations without source changes": "GitHub/Notion 감시 자동화가 새 커밋, 이슈, 페이지 변경을 수집하지 못한 경우 AI 모델 호출과 외부 쓰기를 건너뛰도록 변경했습니다.",
        "Clarify watched automation commit summaries": "변경 감시 자동화 관련 커밋이 Notion 표에서 포괄 문장으로 보이지 않도록 한국어 요약 규칙과 테스트를 보강했습니다.",
        "Clarify commit summary wording": "Notion 자동화 표의 커밋 요약 문장을 더 구체적으로 만들기 위해 요약 매핑과 표현 규칙을 정리했습니다.",
        "Filter automation generated GitHub issues": "AI Board 자동화가 자기 자신이 만든 GitHub 이슈와 댓글을 다시 입력으로 수집하지 않도록 루프 방지 필터를 추가했습니다.",
        "Describe automation loop filter summaries": "자동화 루프 방지 필터 관련 커밋이 Notion 표에서 구체적인 한국어 요약으로 보이도록 요약 규칙을 보강했습니다.",
    }
    if normalized in exact:
        return exact[normalized]

    patterns = [
        (r"^Fix\s+(.+)$", "{item} 문제를 수정했습니다."),
        (r"^Add\s+(.+)$", "{item} 기능을 추가했습니다."),
        (r"^Improve\s+(.+)$", "{item}을 개선했습니다."),
        (r"^Update\s+(.+)$", "{item}을 최신 요구사항에 맞게 갱신했습니다."),
        (r"^Refactor\s+(.+)$", "{item} 구조를 정리했습니다."),
        (r"^Clean\s+(.+)$", "{item}을 정리했습니다."),
        (r"^Describe\s+(.+)$", "{item} 설명을 보강했습니다."),
        (r"^Clarify\s+(.+)$", "{item} 문구를 더 명확하게 정리했습니다."),
        (r"^Filter\s+(.+)$", "{item}을 필터링하도록 변경했습니다."),
    ]
    readable_terms = {
        "notion": "Notion",
        "github": "GitHub",
        "commit": "커밋",
        "commits": "커밋",
        "summary": "요약",
        "summaries": "요약",
        "author": "작성자",
        "authors": "작성자",
        "oauth": "OAuth",
        "login": "로그인",
        "dashboard": "대시보드",
        "design": "디자인",
        "accessibility": "접근성",
        "board": "게시판",
        "readability": "가독성",
        "automation": "자동화",
        "automations": "자동화",
        "generated": "생성한",
        "table": "표",
        "tables": "표",
        "watched": "변경 감시",
        "without": "없을 때",
        "source": "원본 변경",
        "changes": "변경사항",
        "obsolete": "이전",
        "assertion": "assertion",
        "assertions": "assertion",
        "cleanup": "정리",
    }
    for pattern, sentence in patterns:
        match = re.match(pattern, normalized, re.IGNORECASE)
        if not match:
            continue
        item = match.group(1)
        words = [readable_terms.get(word.lower().strip(".,:/()[]"), word) for word in item.split()]
        return sentence.format(item=" ".join(words))
    if normalized:
        return f"커밋 메시지 '{normalized}'에 해당하는 변경을 반영했습니다."
    return "커밋 메시지가 비어 있어 변경 내용을 자동 요약하지 못했습니다."


def korean_summary_for_source(context: dict[str, str]) -> str:
    text = context.get("summary") or ""
    title = context.get("title") or ""
    source_type = (context.get("source_type") or "").lower()
    normalized = text.strip()
    metadata_only = bool(re.fullmatch(r"(author|sha|date|url|state|number|repository|branch):[\s\S]+", normalized, re.IGNORECASE))
    if normalized and not metadata_only and "author:" not in normalized.lower() and "sha:" not in normalized.lower():
        return normalized[:360]
    author_match = re.search(r"author:\s*([^\n]+?)(?:\s+(?:url|sha|date|state|number):|$)", text, re.IGNORECASE)
    sha_match = re.search(r"sha:\s*([0-9a-f]{7,40})", text, re.IGNORECASE)
    if "commit" in source_type or "commit" in title.lower():
        message = commit_message_from_title(title)
        author = author_match.group(1).strip() if author_match else "알 수 없음"
        sha = sha_match.group(1)[:12] if sha_match else ""
        details = []
        if author:
            details.append(f"작성자: {author}")
        if sha:
            details.append(f"커밋: {sha}")
        suffix = f" ({', '.join(details)})" if details else ""
        return f"{korean_commit_change_summary(message)}{suffix}"
    if "issue" in source_type or "issue" in title.lower():
        if normalized and not metadata_only:
            return normalized[:360]
        return f"GitHub 이슈 '{title}'가 수집되었습니다. 요구사항, 재현 조건, 후속 작업 필요 여부를 확인해야 합니다."
    if not text:
        return "요약 정보가 비어 있습니다. 원문 링크를 확인해야 합니다."
    return f"수집된 원문 요약: {text[:360]}"


def clean_table_header(header: list[str]) -> list[str]:
    default = ["번호", "유형", "제목", "한국어 요약", "위험도", "다음 조치", "링크"]
    joined = "".join(header)
    if not header or "??" in joined or len(joined.replace("?", "").strip()) <= 2:
        return default
    return header


def default_sources_table_rows(sources: list[object]) -> list[list[str]]:
    rows = [["번호", "유형", "제목", "한국어 요약", "위험도", "다음 조치", "링크"]]
    for index, source in enumerate(sources, start=1):
        context = source_context(source, index)
        source_type = context["source_type"] or "GitHub"
        lowered = f"{context['title']} {context['summary']}".lower()
        risk = "높음" if any(token in lowered for token in ["security", "auth", "token", "secret", "fail", "error", "보안", "실패"]) else "보통"
        rows.append(
            [
                str(index),
                source_type,
                context["title"] or "(제목 없음)",
                korean_summary_for_source(context),
                risk,
                context["next_action"],
                context["source_url"],
            ]
        )
    return rows


def source_table_value_for_header(header: str, context: dict[str, str], summary: str, risk: str) -> str:
    normalized = re.sub(r"\s+", "", header or "").lower()
    if normalized in {"번호", "no", "number", "#"}:
        return context.get("index", "")
    if normalized in {"유형", "타입", "type", "source", "sourcetype"}:
        return context.get("source_type") or "GitHub"
    if normalized in {"제목", "title", "이름", "name"}:
        return context.get("title") or "(제목 없음)"
    if normalized in {"한국어요약", "요약", "summary", "koreansummary"}:
        return summary
    if normalized in {"위험도", "risk", "risklevel"}:
        return risk
    if normalized in {"영향영역", "영향범위", "impact", "impactarea", "area"}:
        return "BOARD/PAGES/GANTT"
    if normalized in {"다음조치", "nextaction", "action"}:
        return context.get("next_action") or "요청 템플릿 기준으로 검토"
    if normalized in {"링크", "url", "link", "sourceurl"}:
        return context.get("source_url") or ""
    if normalized in {"작성자", "author", "assignee", "담당자"}:
        return context.get("assignee") or ""
    return context.get(header, "") or ""


def source_table_row_for_header(header: list[str], context: dict[str, str], risk: str) -> list[str]:
    summary = korean_summary_for_source(context)
    return [source_table_value_for_header(column, context, summary, risk) for column in header]


def notion_sources_template_children(title: str, sources: list[object], template: str) -> list[dict]:
    summary_text = f"총 {len(sources)}개 GitHub/Notion 변경사항을 자동화가 수집해 한국어로 정리했습니다."
    table_block: dict
    template_rows = markdown_table_rows(template)
    if template_rows:
        header = clean_table_header(template_rows[0])
        rows = [header]
        for index, source in enumerate(sources, start=1):
            context = source_context(source, index)
            lowered = f"{context['title']} {context['summary']}".lower()
            risk = "높음" if any(token in lowered for token in ["security", "auth", "token", "secret", "fail", "error", "보안", "실패"]) else "보통"
            rows.append(source_table_row_for_header(header, context, risk))
        table_block = notion_table_block(rows, header=True)
    else:
        table_block = notion_table_block(default_sources_table_rows(sources), header=True)

    detail_children: list[dict] = [
        callout_block("요청 템플릿 기준으로 생성된 자동화 보고입니다.", "🤖"),
        table_block,
    ]
    if template.strip() and not template_rows:
        detail_children.append(callout_block("자동화 요청 템플릿 상세 렌더링", "🧾"))
        for index, source in enumerate(sources, start=1):
            context = source_context(source, index)
            detail_children.append(callout_block(f"{index}. {context['title']}", "🔎"))
            for line in render_template(template, context).strip().splitlines():
                detail_children.append(paragraph_block(line))
            if index < len(sources):
                detail_children.append(divider_block())

    return [
        toggle_block(
            title,
            [
                column_list_block(
                    [
                        [
                            callout_block("자동화 보고", "🤖"),
                            paragraph_block(summary_text),
                        ],
                        [
                            callout_block("영향 영역", "📋"),
                            paragraph_block("BOARD / PAGES / GANTT CHART"),
                        ],
                    ]
                ),
                toggle_block("보고 표 / 요청 템플릿 렌더링", detail_children),
            ],
        )
    ]


def write_notion_sources_report(
    profile: IntegrationProfile,
    title: str,
    sources: list[object],
    template: str,
    dry_run: bool = True,
    target_url: str | None = None,
) -> dict:
    token = google_calendar_access_token(profile)
    target_id = extract_notion_id(target_url or profile.base_url)
    if not token or not target_id:
        return {"service": "notion", "status": "blocked", "reason": "missing token or Notion page/database URL", "dryRun": dry_run}
    children = notion_sources_template_children(title, sources, template)
    block_children_url = f"https://api.notion.com/v1/blocks/{target_id}/children"
    if dry_run:
        return {
            "service": "notion",
            "status": "ready",
            "method": "PATCH",
            "url": block_children_url,
            "payload": {"children": children},
            "dryRun": True,
            "target": "page",
            "format": "template-rendered-blocks",
            "template": template,
            "count": len(sources),
        }
    try:
        ok, append_result = append_notion_children(
            {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"},
            block_children_url,
            children,
        )
    except httpx.HTTPError as exc:
        return {"service": "notion", "status": "failed", "reason": str(exc), "dryRun": False, "target": "page"}
    if not ok:
        return {"service": "notion", "status": "failed", **append_result, "dryRun": False, "target": "page"}
    return {
        "service": "notion",
        "status": "written",
        "id": target_id,
        "url": f"https://www.notion.so/{target_id}",
        "dryRun": False,
        "target": "page",
        "format": "template-rendered-blocks",
        "template": template,
        "count": len(sources),
        "chunks": append_result.get("chunks", []),
    }


def write_notion_task(profile: IntegrationProfile, title: str, body: str, dry_run: bool = True, target_url: str | None = None) -> dict:
    token = profile_access_token(profile)
    target_id = extract_notion_id(target_url or profile.base_url)
    if not token or not target_id:
        return {"service": "notion", "status": "blocked", "reason": "missing token or Notion page/database URL", "dryRun": dry_run}
    headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
    database_url = f"https://api.notion.com/v1/databases/{target_id}"
    page_url = "https://api.notion.com/v1/pages"
    block_children_url = f"https://api.notion.com/v1/blocks/{target_id}/children"
    table_children = notion_page_children(title, body)
    if dry_run:
        return {
            "service": "notion",
            "status": "ready",
            "method": "POST",
            "url": page_url,
            "pageAppendUrl": block_children_url,
            "databaseUrl": database_url,
            "payload": {"parent": {"database_or_page_id": target_id}, "title": title[:200], "body": body[:1800], "pageFormat": "table"},
            "dryRun": True,
        }
    try:
        database_response = httpx.get(database_url, headers=headers, timeout=15.0)
    except httpx.HTTPError as exc:
        return {"service": "notion", "status": "failed", "reason": str(exc), "dryRun": False}
    if not database_response.is_success:
        try:
            response = httpx.patch(block_children_url, headers=headers, json={"children": table_children}, timeout=15.0)
        except httpx.HTTPError as exc:
            return {"service": "notion", "status": "failed", "reason": str(exc), "dryRun": False, "target": "page"}
        data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
        if not response.is_success:
            return {"service": "notion", "status": "failed", "code": response.status_code, "response": data, "dryRun": False, "target": "page"}
        return {"service": "notion", "status": "written", "id": target_id, "url": f"https://www.notion.so/{target_id}", "dryRun": False, "target": "page", "format": "table"}
    database = database_response.json()
    properties: dict = {}
    title_property = next((name for name, prop in database.get("properties", {}).items() if prop.get("type") == "title"), "Name")
    properties[title_property] = {"title": [{"text": {"content": title[:200]}}]}
    for name, prop in database.get("properties", {}).items():
        lowered = name.lower()
        prop_type = prop.get("type")
        if name == title_property:
            continue
        if prop_type == "rich_text" and any(key in lowered for key in ["summary", "next", "action", "content"]):
            properties[name] = {"rich_text": [{"text": {"content": body[:1800]}}]}
        if prop_type == "url" and any(key in lowered for key in ["github", "link", "url"]):
            match = re.search(r"https?://\S+", body)
            if match:
                properties[name] = {"url": match.group(0)[:2000]}
    payload = {"parent": {"database_id": target_id}, "properties": properties, "children": table_children}
    try:
        response = httpx.post(page_url, headers=headers, json=payload, timeout=15.0)
    except httpx.HTTPError as exc:
        return {"service": "notion", "status": "failed", "reason": str(exc), "dryRun": False}
    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
    if not response.is_success:
        return {"service": "notion", "status": "failed", "code": response.status_code, "response": data, "dryRun": False}
    return {"service": "notion", "status": "written", "id": data.get("id", ""), "url": data.get("url", ""), "dryRun": False, "format": "table"}

def write_figma_comment(profile: IntegrationProfile, title: str, body: str, dry_run: bool = True, target_url: str | None = None) -> dict:
    token = profile_access_token(profile)
    file_key = parse_figma_file_key(target_url or profile.base_url)
    message = f"{title}\n\n{body}".strip()
    payload = {"message": message, "client_meta": {"x": 0, "y": 0}}
    url = f"https://api.figma.com/v1/files/{file_key}/comments"
    if not token or not file_key:
        return {"service": "figma", "status": "blocked", "reason": "missing token or Figma file URL", "dryRun": dry_run}
    if dry_run:
        return {"service": "figma", "status": "ready", "method": "POST", "url": url, "payload": payload, "dryRun": True}
    try:
        response = httpx.post(url, headers={"X-Figma-Token": token, "Content-Type": "application/json"}, json=payload, timeout=15.0)
    except httpx.HTTPError as exc:
        return {"service": "figma", "status": "failed", "reason": str(exc), "dryRun": False}
    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
    if not response.is_success:
        return {"service": "figma", "status": "failed", "code": response.status_code, "response": data, "dryRun": False}
    comment_id = data.get("id", "")
    return {"service": "figma", "status": "written", "id": comment_id, "url": f"https://www.figma.com/file/{file_key}?comment-id={comment_id}", "dryRun": False}


def write_calendar_event(
    profile: IntegrationProfile,
    title: str,
    body: str,
    dry_run: bool = True,
    start_minutes_from_now: int = 15,
    duration_minutes: int = 30,
    target_url: str | None = None,
) -> dict:
    token = google_calendar_access_token(profile)
    calendar_id = safe_calendar_id(target_url or profile.base_url)
    start = datetime.now(timezone.utc) + timedelta(minutes=max(0, start_minutes_from_now))
    end = start + timedelta(minutes=max(5, duration_minutes))
    payload = {
        "summary": title,
        "description": body,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": end.isoformat()},
    }
    url = f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id, safe='')}/events"
    if not token or not calendar_id:
        return {"service": "google_calendar", "status": "blocked", "reason": "missing token or calendar id", "dryRun": dry_run}
    if dry_run:
        return {"service": "google_calendar", "status": "ready", "method": "POST", "url": url, "payload": payload, "dryRun": True}
    try:
        response = httpx.post(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, json=payload, timeout=15.0)
    except httpx.HTTPError as exc:
        return {"service": "google_calendar", "status": "failed", "reason": str(exc), "dryRun": False}
    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
    if not response.is_success:
        return {"service": "google_calendar", "status": "failed", "code": response.status_code, "response": data, "dryRun": False}
    return {"service": "google_calendar", "status": "written", "id": data.get("id", ""), "url": data.get("htmlLink", ""), "dryRun": False}


def execute_profile_write(
    profile: IntegrationProfile,
    title: str,
    body: str,
    dry_run: bool = True,
    start_minutes_from_now: int = 15,
    duration_minutes: int = 30,
) -> dict:
    service = profile.source_kind.lower()
    if service == "github":
        return write_github_issue(profile, title, body, dry_run)
    if service == "notion":
        return write_notion_task(profile, title, body, dry_run)
    if service == "figma":
        return write_figma_comment(profile, title, body, dry_run)
    if service == "google_calendar":
        return write_calendar_event(profile, title, body, dry_run, start_minutes_from_now, duration_minutes)
    try:
        custom_connections = json.loads(profile.custom_connections or "[]")
    except json.JSONDecodeError:
        custom_connections = []
    for connection in custom_connections:
        connection_service = str(connection.get("service", "")).lower()
        connection_url = str(connection.get("url", ""))
        if connection_service == "github":
            return write_github_issue(profile, title, body, dry_run, connection_url)
        if connection_service == "notion":
            return write_notion_task(profile, title, body, dry_run, connection_url)
        if connection_service == "figma":
            return write_figma_comment(profile, title, body, dry_run, connection_url)
        if connection_service == "google_calendar":
            return write_calendar_event(profile, title, body, dry_run, start_minutes_from_now, duration_minutes, connection_url)
    return {"service": service or "custom", "status": "unsupported", "reason": "live write is implemented for github, notion, figma, and google_calendar profiles", "dryRun": dry_run}
