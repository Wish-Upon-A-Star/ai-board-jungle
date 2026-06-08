from __future__ import annotations

import re
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from .collectors import extract_notion_id, parse_github_repo
from .models import IntegrationProfile
from .security import reveal_secret


def parse_figma_file_key(url_or_key: str) -> str:
    match = re.search(r"figma\.com/(?:file|design)/([A-Za-z0-9]+)", url_or_key)
    return match.group(1) if match else url_or_key.strip()


def safe_calendar_id(value: str) -> str:
    return value.strip() or "primary"


def write_github_issue(profile: IntegrationProfile, title: str, body: str, dry_run: bool = True, target_url: str | None = None) -> dict:
    token = reveal_secret(profile.token_value)
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


def korean_summary_for_source(context: dict[str, str]) -> str:
    text = context.get("summary") or ""
    title = context.get("title") or ""
    source_type = (context.get("source_type") or "").lower()
    normalized = text.strip()
    metadata_only = bool(re.fullmatch(r"(author|sha|date|url|state|number|repository|branch):[\s\S]+", normalized, re.IGNORECASE))
    if normalized and not metadata_only and "author:" not in normalized.lower() and "sha:" not in normalized.lower():
        return normalized[:360]
    author_match = re.search(r"author:\s*([^\n]+)", text, re.IGNORECASE)
    sha_match = re.search(r"sha:\s*([0-9a-f]{7,40})", text, re.IGNORECASE)
    if "commit" in source_type or "commit" in title.lower():
        message = title
        commit_match = re.search(r"Commit\s+[0-9a-f]{7,40}:\s*(.+)$", title)
        if commit_match:
            message = commit_match.group(1)
        author = author_match.group(1).strip() if author_match else "알 수 없음"
        sha = sha_match.group(1)[:12] if sha_match else ""
        suffix = f" 커밋({sha})" if sha else " 커밋"
        return f"{author}가 '{message}' 변경을 포함한{suffix}을 푸시했습니다. 변경 범위와 자동화 영향도를 확인해야 합니다."
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


def notion_sources_template_children(title: str, sources: list[object], template: str) -> list[dict]:
    children = [
        heading_2_block(title),
        paragraph_block(f"총 {len(sources)}개 GitHub 변경사항을 자동화가 수집해 한국어로 정리했습니다."),
    ]
    template_rows = markdown_table_rows(template)
    if template_rows:
        header = clean_table_header(template_rows[0])
        rows = [header]
        for index, source in enumerate(sources, start=1):
            context = source_context(source, index)
            rows.append(
                [
                    context.get("index", str(index)),
                    context.get("source_type") or "GitHub",
                    context.get("title") or "(제목 없음)",
                    korean_summary_for_source(context),
                    "보통",
                    context.get("next_action") or "검토",
                    context.get("source_url") or "",
                ][: len(header)]
            )
        children.append(notion_table_block(rows, header=True))
        return children
    children.append(notion_table_block(default_sources_table_rows(sources), header=True))
    if not template.strip():
        return children
    children.append(paragraph_block("아래는 자동화 요청 템플릿을 각 항목에 적용한 상세 내용입니다."))
    for index, source in enumerate(sources, start=1):
        context = source_context(source, index)
        children.append(heading_3_block(f"{index}. {context['title']}"))
        for line in render_template(template, context).strip().splitlines():
            children.append(paragraph_block(line))
        if index < len(sources):
            children.append(divider_block())
    return children


def write_notion_sources_report(
    profile: IntegrationProfile,
    title: str,
    sources: list[object],
    template: str,
    dry_run: bool = True,
    target_url: str | None = None,
) -> dict:
    token = reveal_secret(profile.token_value)
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
    token = reveal_secret(profile.token_value)
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
    token = reveal_secret(profile.token_value)
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
    token = reveal_secret(profile.token_value)
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
