from __future__ import annotations

import re
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from .collectors import parse_github_repo
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
    payload = {"title": title[:256], "body": body[:65000], "labels": ["ai-board", "automation"]}
    if dry_run:
        return {"service": "github", "status": "ready", "method": "POST", "url": url, "payload": payload, "dryRun": True}
    try:
        response = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            json=payload,
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        return {"service": "github", "status": "failed", "reason": str(exc), "dryRun": False}
    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
    if not response.is_success:
        return {"service": "github", "status": "failed", "code": response.status_code, "response": data, "dryRun": False}
    return {"service": "github", "status": "written", "id": data.get("number", ""), "url": data.get("html_url", ""), "dryRun": False}


def notion_database_id(url_or_id: str) -> str:
    compact = url_or_id.replace("-", "")
    match = re.search(r"([0-9a-fA-F]{32})", compact)
    return match.group(1) if match else url_or_id.strip()


def write_notion_task(profile: IntegrationProfile, title: str, body: str, dry_run: bool = True, target_url: str | None = None) -> dict:
    token = reveal_secret(profile.token_value)
    database_id = notion_database_id(target_url or profile.base_url)
    if not token or not database_id:
        return {"service": "notion", "status": "blocked", "reason": "missing token or Notion database URL", "dryRun": dry_run}
    headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
    database_url = f"https://api.notion.com/v1/databases/{database_id}"
    page_url = "https://api.notion.com/v1/pages"
    if dry_run:
        return {
            "service": "notion",
            "status": "ready",
            "method": "POST",
            "url": page_url,
            "databaseUrl": database_url,
            "payload": {"parent": {"database_id": database_id}, "title": title[:200], "body": body[:1800]},
            "dryRun": True,
        }
    try:
        database_response = httpx.get(database_url, headers=headers, timeout=15.0)
    except httpx.HTTPError as exc:
        return {"service": "notion", "status": "failed", "reason": str(exc), "dryRun": False}
    if not database_response.is_success:
        data = database_response.json() if database_response.headers.get("content-type", "").startswith("application/json") else {"raw": database_response.text}
        return {"service": "notion", "status": "failed", "code": database_response.status_code, "response": data, "dryRun": False}
    database = database_response.json()
    properties: dict = {}
    title_property = next((name for name, prop in database.get("properties", {}).items() if prop.get("type") == "title"), "Name")
    properties[title_property] = {"title": [{"text": {"content": title[:200]}}]}
    for name, prop in database.get("properties", {}).items():
        lowered = name.lower()
        prop_type = prop.get("type")
        if name == title_property:
            continue
        if prop_type == "rich_text" and any(key in lowered for key in ["summary", "요약", "next", "action", "내용"]):
            properties[name] = {"rich_text": [{"text": {"content": body[:1800]}}]}
        if prop_type == "url" and any(key in lowered for key in ["github", "link", "url", "링크"]):
            match = re.search(r"https?://\S+", body)
            if match:
                properties[name] = {"url": match.group(0)[:2000]}
    payload = {
        "parent": {"database_id": database_id},
        "properties": properties,
        "children": [
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": [{"type": "text", "text": {"content": body[:1800]}}]},
            }
        ],
    }
    try:
        response = httpx.post(page_url, headers=headers, json=payload, timeout=15.0)
    except httpx.HTTPError as exc:
        return {"service": "notion", "status": "failed", "reason": str(exc), "dryRun": False}
    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text}
    if not response.is_success:
        return {"service": "notion", "status": "failed", "code": response.status_code, "response": data, "dryRun": False}
    return {"service": "notion", "status": "written", "id": data.get("id", ""), "url": data.get("url", ""), "dryRun": False}


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
