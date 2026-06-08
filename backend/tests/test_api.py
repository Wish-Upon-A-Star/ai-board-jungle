from __future__ import annotations

import os
import json
import subprocess
import sys
import hashlib
import hmac
from urllib.parse import parse_qs, urlparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ["AI_BOARD_DATABASE_URL"] = "sqlite:///:memory:"
os.environ["AI_BOARD_ALLOW_SQLITE_TEST_DB"] = "1"

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.collectors import CollectedItem, extract_notion_id, parse_github_repo
from app.config import settings
from app.db import SessionLocal, engine, init_db
import app.main as main_module
from app.main import app
from app.models import AutomationRun, AutomationTask, IntegrationProfile, KnowledgeSource
from app.live_writers import korean_summary_for_source, notion_sources_template_children, write_calendar_event, write_github_issue, write_notion_sources_report, write_notion_task
from app.security import reveal_secret


def test_health_recovers_after_startup_database_error(monkeypatch):
    calls = {"init": 0}

    def fake_init_db():
        calls["init"] += 1

    monkeypatch.setattr(main_module, "database_reachable", lambda: (True, ""))
    monkeypatch.setattr(main_module, "init_db", fake_init_db)
    monkeypatch.setattr(main_module, "check_db", lambda: {"ok": True, "url": "postgresql+psycopg"})

    with TestClient(app) as client:
        main_module.STARTUP_DB_ERROR = "PostgreSQL is not reachable at localhost:5432"
        health = client.get("/api/health")

    assert health.status_code == 200
    assert health.json()["database"]["ok"] is True
    assert calls["init"] >= 1
    assert main_module.STARTUP_DB_ERROR == ""


def test_sqlite_runtime_requires_explicit_test_flag():
    env = {
        **os.environ,
        "PYTHONPATH": "backend",
        "AI_BOARD_DATABASE_URL": "sqlite:///:memory:",
    }
    env.pop("AI_BOARD_ALLOW_SQLITE_TEST_DB", None)
    result = subprocess.run(
        [sys.executable, "-c", "import app.db"],
        text=True,
        capture_output=True,
        env=env,
    )
    assert result.returncode != 0
    assert "SQLite is disabled for AI Board runtime" in result.stderr


def test_parse_github_repo_accepts_https_and_ssh_urls():
    assert parse_github_repo("https://github.com/acme/private-repo") == ("acme", "private-repo")
    assert parse_github_repo("https://www.github.com/acme/private-repo") == ("acme", "private-repo")
    assert parse_github_repo("https://github.com/acme/private-repo.git/") == ("acme", "private-repo")
    assert parse_github_repo("git@github.com:acme/private-repo.git") == ("acme", "private-repo")
    assert parse_github_repo("https://gitlab.com/acme/private-repo") is None


def test_github_issue_writer_uses_shared_repo_parser_for_ssh_urls():
    profile = IntegrationProfile(
        owner_id=1,
        name="SSH GitHub writer",
        source_kind="github",
        base_url="git@github.com:acme/private-repo.git",
        token_value="plain-token-for-dry-run",
    )
    write = write_github_issue(profile, "Check SSH parser", "Dry-run only.", dry_run=True)
    assert write["status"] == "ready"
    assert write["url"] == "https://api.github.com/repos/acme/private-repo/issues"
    assert "plain-token-for-dry-run" not in str(write)


def test_github_issue_writer_comments_on_existing_automation_issue(monkeypatch):
    calls = []

    class Response:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data
            self.headers = {"content-type": "application/json"}
            self.is_success = 200 <= status_code < 300
            self.text = json.dumps(data)

        def json(self):
            return self._data

    def fake_get(url, headers=None, params=None, timeout=15.0):
        calls.append(("GET", url, params))
        return Response(
            200,
            [
                {
                    "number": 12,
                    "title": "[AI Board] Existing task",
                    "html_url": "https://github.com/acme/repo/issues/12",
                    "comments_url": "https://api.github.com/repos/acme/repo/issues/12/comments",
                }
            ],
        )

    def fake_post(url, headers=None, json=None, timeout=15.0):
        calls.append(("POST", url, json))
        return Response(201, {"html_url": "https://github.com/acme/repo/issues/12#issuecomment-1"})

    monkeypatch.setattr("app.live_writers.httpx.get", fake_get)
    monkeypatch.setattr("app.live_writers.httpx.post", fake_post)
    profile = IntegrationProfile(
        owner_id=1,
        name="GitHub writer",
        source_kind="github",
        base_url="https://github.com/acme/repo",
        token_value="plain-token",
    )
    write = write_github_issue(profile, "[AI Board] Existing task", "Updated automation result", dry_run=False)
    assert write["status"] == "updated"
    assert write["id"] == 12
    assert write["mode"] == "comment"
    assert calls[0] == ("GET", "https://api.github.com/repos/acme/repo/issues", {"state": "open", "labels": "ai-board,automation", "per_page": 50})
    assert calls[1][0] == "POST"
    assert calls[1][1] == "https://api.github.com/repos/acme/repo/issues/12/comments"
    assert calls[1][2]["body"] == "Updated automation result"


def test_oauth_status_lists_all_login_providers(monkeypatch):
    monkeypatch.delenv("AI_BOARD_FIGMA_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET", raising=False)
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "oauth-providers@example.com", "name": "OAuth Providers", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        status = client.get("/api/oauth/status", headers=headers)
    assert status.status_code == 200
    providers = {item["provider"]: item for item in status.json()["providers"]}
    assert {"github", "notion", "figma", "google_calendar"} <= set(providers)
    assert providers["figma"]["missing"] == ["AI_BOARD_FIGMA_OAUTH_CLIENT_ID", "AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET"]


def test_figma_oauth_start_builds_authorize_url(monkeypatch):
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_ID", "figma-client")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET", "figma-secret")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "figma-oauth@example.com", "name": "Figma OAuth", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        response = client.get("/api/oauth/figma/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorizeUrl"])
    params = parse_qs(parsed.query)
    assert parsed.scheme == "https"
    assert parsed.netloc == "www.figma.com"
    assert parsed.path == "/oauth"
    assert params["client_id"] == ["figma-client"]
    assert params["response_type"] == ["code"]
    assert params["scope"] == ["file_read file_write"]
    assert data["redirectUri"].endswith("/api/oauth/figma/callback")


def test_google_calendar_oauth_start_requests_offline_calendar_access(monkeypatch):
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_ID", "google-client")
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET", "google-secret")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "google-oauth@example.com", "name": "Google OAuth", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        response = client.get("/api/oauth/google_calendar/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorizeUrl"])
    params = parse_qs(parsed.query)
    assert parsed.netloc == "accounts.google.com"
    assert parsed.path == "/o/oauth2/v2/auth"
    assert params["client_id"] == ["google-client"]
    assert params["response_type"] == ["code"]
    assert params["access_type"] == ["offline"]
    assert params["include_granted_scopes"] == ["true"]
    assert params["prompt"] == ["consent"]
    assert "https://www.googleapis.com/auth/calendar.events" in params["scope"][0]
    assert data["redirectUri"].endswith("/api/oauth/google_calendar/callback")


def test_notion_task_writer_uses_shared_id_parser_for_dashed_ids():
    profile = IntegrationProfile(
        owner_id=1,
        name="Dashed Notion writer",
        source_kind="notion",
        base_url="12345678-90ab-cdef-1234-567890abcdef",
        token_value="plain-notion-token-for-dry-run",
    )
    write = write_notion_task(profile, "Check Notion parser", "Dry-run only.", dry_run=True)
    assert write["status"] == "ready"
    assert write["databaseUrl"] == "https://api.notion.com/v1/databases/1234567890abcdef1234567890abcdef"
    assert write["payload"]["parent"]["database_or_page_id"] == "1234567890abcdef1234567890abcdef"
    assert "plain-notion-token-for-dry-run" not in str(write)


def test_extract_notion_id_prefers_last_id_when_slug_contains_hex_prefix():
    assert (
        extract_notion_id("https://app.notion.com/p/302-1-1-3797051c2f998094b2a5e5062d353881")
        == "3797051c2f998094b2a5e5062d353881"
    )


def test_calendar_writer_refreshes_google_oauth_token(monkeypatch):
    calls = []

    class Response:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data
            self.headers = {"content-type": "application/json"}
            self.is_success = 200 <= status_code < 300
            self.text = json.dumps(data)

        def json(self):
            return self._data

    def fake_post(url, headers=None, data=None, json=None, timeout=15.0):
        calls.append((url, headers, data, json))
        if url == "https://oauth2.googleapis.com/token":
            return Response(200, {"access_token": "fresh-google-token"})
        return Response(200, {"id": "event-1", "htmlLink": "https://calendar.google.com/event?eid=1"})

    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_ID", "google-client")
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET", "google-secret")
    monkeypatch.setattr("app.live_writers.httpx.post", fake_post)
    profile = IntegrationProfile(
        owner_id=1,
        name="Google Calendar OAuth",
        source_kind="google_calendar",
        base_url="primary",
        token_value=json.dumps({"access_token": "expired-token", "refresh_token": "refresh-token"}),
    )
    write = write_calendar_event(profile, "Review", "Body", dry_run=False)
    assert write["status"] == "written"
    assert calls[0][0] == "https://oauth2.googleapis.com/token"
    assert calls[0][2]["grant_type"] == "refresh_token"
    assert calls[1][1]["Authorization"] == "Bearer fresh-google-token"


def test_notion_task_writer_appends_to_plain_page(monkeypatch):
    calls = []

    class Response:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data
            self.headers = {"content-type": "application/json"}
            self.is_success = 200 <= status_code < 300
            self.text = json.dumps(data)

        def json(self):
            return self._data

    def fake_get(url, headers=None, timeout=15.0):
        calls.append(("GET", url, None))
        return Response(404, {"object": "error", "message": "not a database"})

    def fake_patch(url, headers=None, json=None, timeout=15.0):
        calls.append(("PATCH", url, json))
        return Response(200, {"results": []})

    monkeypatch.setattr("app.live_writers.httpx.get", fake_get)
    monkeypatch.setattr("app.live_writers.httpx.patch", fake_patch)
    profile = IntegrationProfile(
        owner_id=1,
        name="Notion Page Writer",
        source_kind="notion",
        base_url="https://www.notion.so/workspace/Demo-3797051c2f9981b4bad3fe6545622eb8",
        token_value="plain-notion-page-token",
    )
    write = write_notion_task(profile, "Webhook commit summary", "Commit body", dry_run=False)
    assert write["status"] == "written"
    assert write["target"] == "page"
    assert calls[0][0] == "GET"
    assert calls[1][0] == "PATCH"
    assert calls[1][1] == "https://api.notion.com/v1/blocks/3797051c2f9981b4bad3fe6545622eb8/children"
    assert calls[1][2]["children"][0]["heading_2"]["rich_text"][0]["text"]["content"] == "Webhook commit summary"
    assert calls[1][2]["children"][1]["type"] == "table"
    table = calls[1][2]["children"][1]["table"]
    assert table["table_width"] == 2
    assert table["has_column_header"] is True
    assert table["children"][0]["table_row"]["cells"][0][0]["text"]["content"] == "Field"
    assert table["children"][1]["table_row"]["cells"][0][0]["text"]["content"] == "Title"


def test_notion_sources_report_writer_uses_request_template(monkeypatch):
    calls = []

    class Response:
        status_code = 200
        headers = {"content-type": "application/json"}
        is_success = True
        text = "{}"

        def json(self):
            return {"results": []}

    def fake_patch(url, headers=None, json=None, timeout=30.0):
        calls.append((url, json))
        return Response()

    monkeypatch.setattr("app.live_writers.httpx.patch", fake_patch)
    profile = IntegrationProfile(
        owner_id=1,
        name="Notion Korean Table",
        source_kind="notion",
        base_url="https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8",
        token_value="plain-notion-page-token",
    )
    write = write_notion_sources_report(
        profile,
        "GitHub 변경사항 요청 템플릿",
        [
            {
                "title": "Fix OAuth callback",
                "sourceType": "github_commit",
                "url": "https://github.com/acme/repo/commit/1",
                "summary": "OAuth 콜백을 수정했습니다.",
            }
        ],
        "요청 제목: {title}\n요청 이유: {reason}\n관련 링크: {source_url}",
        dry_run=False,
    )
    assert write["status"] == "written"
    assert write["format"] == "template-rendered-blocks"
    blocks = calls[0][1]["children"]
    rendered_text = "\n".join(
        "".join(part["text"]["content"] for part in block.get(block["type"], {}).get("rich_text", []))
        for block in blocks
        if block["type"] in {"paragraph", "heading_3"}
    )
    assert "요청 제목: Fix OAuth callback" in rendered_text
    assert "요청 이유: OAuth 콜백을 수정했습니다." in rendered_text
    assert "관련 링크: https://github.com/acme/repo/commit/1" in rendered_text


def test_notion_sources_report_writer_chunks_large_template_payload(monkeypatch):
    calls = []

    class Response:
        status_code = 200
        headers = {"content-type": "application/json"}
        is_success = True
        text = "{}"

        def json(self):
            return {"results": []}

    def fake_patch(url, headers=None, json=None, timeout=30.0):
        calls.append(json)
        return Response()

    monkeypatch.setattr("app.live_writers.httpx.patch", fake_patch)
    profile = IntegrationProfile(
        owner_id=1,
        name="Chunked Notion",
        source_kind="notion",
        base_url="https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8",
        token_value="plain-notion-page-token",
    )
    sources = [{"title": f"Issue {index}", "sourceType": "github_issue", "url": f"https://example.test/{index}", "summary": "line"} for index in range(43)]
    write = write_notion_sources_report(profile, "Chunked template", sources, "요청 제목: {title}\n요약: {summary}\n링크: {source_url}", dry_run=False)
    assert write["status"] == "written"
    assert len(calls) > 1
    assert all(len(call["children"]) <= 100 for call in calls)
    assert sum(len(call["children"]) for call in calls) > 100


def test_notion_sources_report_uses_real_table_for_markdown_table_template():
    blocks = notion_sources_template_children(
        "GitHub 변경사항 자동 요약",
        [
            {
                "title": "Improve dashboard design",
                "sourceType": "github_commit",
                "url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle/commit/bd2bc8b",
                "summary": "대시보드 디자인과 접근성을 개선했습니다.",
            }
        ],
        "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    )
    table = next(block for block in blocks if block["type"] == "table")
    rows = table["table"]["children"]
    assert table["table"]["table_width"] == 7
    assert table["table"]["has_column_header"] is True
    assert rows[0]["table_row"]["cells"][0][0]["text"]["content"] == "번호"
    assert rows[1]["table_row"]["cells"][2][0]["text"]["content"] == "Improve dashboard design"
    assert "대시보드 디자인" in rows[1]["table_row"]["cells"][3][0]["text"]["content"]


def test_notion_sources_report_commit_summary_keeps_author_clean():
    blocks = notion_sources_template_children(
        "GitHub 변경사항 자동 요약",
        [
            {
                "title": "[GitHub MCP OAuth profile] Commit 1b483cd3d1c8: Fix Notion commit author summaries",
                "sourceType": "github_commit",
                "url": "https://github.com/acme/repo/commit/1b483cd3d1c8",
                "summary": "Fix Notion commit author summaries sha: 1b483cd3d1c8 author: Wish-Upon-A-Star url: https://github.com/acme/repo/commit/1b483cd3d1c8",
            }
        ],
        "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    )
    table = next(block for block in blocks if block["type"] == "table")
    summary = table["table"]["children"][1]["table_row"]["cells"][3][0]["text"]["content"]
    assert "Notion 표의 커밋 요약에서 작성자명에 URL이 섞이던 문제를 수정했습니다." in summary
    assert "Wish-Upon-A-Star url:" not in summary
    assert "변경 범위와 자동화 영향도를 확인해야 합니다" not in summary
    assert "작성자: Wish-Upon-A-Star" in summary
    assert "커밋: 1b483cd3d1c8" in summary


def test_notion_sources_report_commit_summary_describes_oauth_login_change():
    blocks = notion_sources_template_children(
        "GitHub 변경사항 자동 요약",
        [
            {
                "title": "[GitHub MCP OAuth profile] Commit fd54e5cda123: Add Figma and Google Calendar OAuth login",
                "sourceType": "github_commit",
                "url": "https://github.com/acme/repo/commit/fd54e5cda123",
                "summary": "Add Figma and Google Calendar OAuth login sha: fd54e5cda123 author: Codex",
            }
        ],
        "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    )
    table = next(block for block in blocks if block["type"] == "table")
    summary = table["table"]["children"][1]["table_row"]["cells"][3][0]["text"]["content"]
    assert "Figma와 Google Calendar를 OAuth 로그인으로 연결" in summary
    assert "확인해야 합니다" not in summary


def test_notion_sources_report_commit_summary_describes_cleanup_change():
    blocks = notion_sources_template_children(
        "GitHub 변경사항 자동 요약",
        [
            {
                "title": "[GitHub MCP OAuth profile] Commit 20a380ba809d: Clean obsolete summary assertions",
                "sourceType": "github_commit",
                "url": "https://github.com/acme/repo/commit/20a380ba809d",
                "summary": "Clean obsolete summary assertions sha: 20a380ba809d author: Wish-Upon-A-Star",
            }
        ],
        "| 번호 | 유형 | 제목 | 한국어 요약 | 위험도 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    )
    table = next(block for block in blocks if block["type"] == "table")
    summary = table["table"]["children"][1]["table_row"]["cells"][3][0]["text"]["content"]
    assert "요약 테스트에 남아 있던 이전 assertion과 죽은 코드를 제거" in summary
    assert "커밋 메시지 '" not in summary
    assert "확인해야 합니다" not in summary


def test_notion_sources_report_maps_table_values_by_header_name():
    blocks = notion_sources_template_children(
        "302호 1팀 GitHub 변경사항",
        [
            {
                "title": "[GitHub MCP OAuth profile] Commit a5cbba993caa: Load desktop OAuth credentials on live restart",
                "sourceType": "github_commit",
                "url": "https://github.com/acme/repo/commit/a5cbba993caa",
                "summary": "Load desktop OAuth credentials on live restart sha: a5cbba993caa author: Wish-Upon-A-Star",
            }
        ],
        "| 번호 | 유형 | 제목 | 한국어 요약 | 영향 영역 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    )
    table = next(block for block in blocks if block["type"] == "table")
    row = table["table"]["children"][1]["table_row"]["cells"]
    values = [cell[0]["text"]["content"] for cell in row]
    assert values[3].startswith("라이브 서버 재시작 시 바탕화면의 GitHub, Notion, Figma, Google OAuth 설정")
    assert values[4] == "BOARD/PAGES/GANTT"
    assert values[5] == "요청 템플릿 기준으로 검토"
    assert values[4] != "보통"


def test_notion_sources_report_describes_demo_template_page_change():
    blocks = notion_sources_template_children(
        "302호 1팀 GitHub 변경사항",
        [
            {
                "title": "[GitHub MCP OAuth profile] Commit ae64a7d7cf40: Use Notion demo template page for reports",
                "sourceType": "github_commit",
                "url": "https://github.com/acme/repo/commit/ae64a7d7cf40",
                "summary": "Use Notion demo template page for reports sha: ae64a7d7cf40 author: Wish-Upon-A-Star",
            }
        ],
        "| 번호 | 유형 | 제목 | 한국어 요약 | 영향 영역 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    )
    table = next(block for block in blocks if block["type"] == "table")
    summary = table["table"]["children"][1]["table_row"]["cells"][3][0]["text"]["content"]
    assert "302호 1팀 Notion 데모 페이지를 자동화 보고서 목적지로 사용" in summary
    assert "커밋 메시지 '" not in summary


def test_replay_notion_hydrates_legacy_collected_summary(monkeypatch):
    captured = []

    def fake_write_notion_sources_report(profile, title, sources, template, dry_run=True, target_url=None):
        captured.append({"title": title, "sources": sources, "template": template, "dryRun": dry_run})
        return {"service": "notion", "status": "written", "format": "template-rendered-blocks", "count": len(sources), "dryRun": dry_run}

    monkeypatch.setattr("app.main.write_notion_sources_report", fake_write_notion_sources_report)
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "replay-summary@example.com", "name": "Replay Summary", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        github = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Replay GitHub",
                "source_kind": "github",
                "base_url": "https://github.com/acme/replay",
                "api_provider": "GitHub REST API",
                "token_name": "GITHUB_TOKEN",
                "token_value": "github_token",
                "rag_targets": ["issues"],
            },
        ).json()["profile"]
        client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Replay Notion",
                "source_kind": "notion",
                "base_url": "1234567890abcdef1234567890abcdef",
                "api_provider": "Notion API",
                "token_name": "NOTION_TOKEN",
                "token_value": "notion_token",
                "rag_targets": [],
            },
        )
        task = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Replay legacy run",
                "integration_profile_id": github["id"],
                "source": "GitHub",
                "destination": "Notion",
                "interval_minutes": 5,
                "instruction": "Replay collected items.",
                "template": "table",
                "api_provider": "GitHub REST API + Notion API",
                "ai_agent": "ReplayAgent",
                "custom_connections": [
                    {
                        "label": "Notion page",
                        "service": "notion",
                        "url": "1234567890abcdef1234567890abcdef",
                        "api": "Notion API",
                        "auth_key_name": "NOTION_TOKEN",
                        "operation": "append_korean_status_table",
                        "template": "summary",
                    }
                ],
            },
        ).json()["task"]
        with SessionLocal() as db:
            source = KnowledgeSource(
                owner_id=register.json()["user"]["id"],
                title="Legacy issue",
                source_type="github_issue",
                file_name="https://github.com/acme/replay/issues/1",
                extracted_text="레거시 실행에는 없던 상세 요약입니다.",
                tags_json="[]",
            )
            db.add(source)
            db.flush()
            run = AutomationRun(
                task_id=task["id"],
                owner_id=register.json()["user"]["id"],
                result=json.dumps({"collected": [{"id": source.id, "title": source.title, "sourceType": source.source_type, "url": source.file_name}]}, ensure_ascii=False),
            )
            db.add(run)
            db.commit()
            run_id = run.id
        replay = client.post(f"/api/automations/{task['id']}/runs/{run_id}/replay-notion", headers=headers)
        assert replay.status_code == 200
        assert replay.json()["run"]["result"]["liveWrites"][0]["format"] == "template-rendered-blocks"
        assert captured[0]["sources"][0]["summary"] == "레거시 실행에는 없던 상세 요약입니다."
        assert "요청 제목" in captured[0]["template"] or captured[0]["template"] == "table"


def test_mcp_auth_profile_is_user_owned_and_redacted():
    with TestClient(app) as client:
        first = client.post(
            "/api/auth/register",
            json={"email": "mcp-owner@example.com", "name": "MCP Owner", "password": "password123"},
        )
        second = client.post(
            "/api/auth/register",
            json={"email": "mcp-other@example.com", "name": "MCP Other", "password": "password123"},
        )
        first_headers = {"Authorization": f"Bearer {first.json()['token']}"}
        second_headers = {"Authorization": f"Bearer {second.json()['token']}"}

        created = client.post(
            "/api/integration-profiles",
            headers=first_headers,
            json={
                "name": "Owner Notion MCP",
                "source_kind": "notion",
                "base_url": "https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8",
                "api_provider": "Notion MCP Connector",
                "token_name": "NOTION_MCP_ACCESS_TOKEN",
                "token_value": "mcp_secret_value",
                "auth_type": "mcp_oauth",
                "mcp_server_url": "https://mcp.notion.com",
                "mcp_auth_subject": "mcp-owner@example.com",
                "mcp_scopes": ["notion.page.read", "notion.page.write"],
                "rag_targets": ["notion_pages"],
            },
        )
        assert created.status_code == 200
        profile = created.json()["profile"]
        assert profile["authType"] == "mcp_oauth"
        assert profile["mcpServerUrl"] == "https://mcp.notion.com"
        assert profile["mcpAuthSubject"] == "mcp-owner@example.com"
        assert profile["mcpScopes"] == ["notion.page.read", "notion.page.write"]
        assert profile["hasToken"] is True
        assert "mcp_secret_value" not in str(profile)

        first_profiles = client.get("/api/integration-profiles", headers=first_headers).json()["profiles"]
        assert any(item["id"] == profile["id"] and item["authType"] == "mcp_oauth" for item in first_profiles)
        second_profiles = client.get("/api/integration-profiles", headers=second_headers).json()["profiles"]
        assert all(item["id"] != profile["id"] for item in second_profiles)


def test_mcp_oauth_start_reports_missing_server_config(monkeypatch):
    for key in (
        "AI_BOARD_GITHUB_OAUTH_CLIENT_ID",
        "AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET",
        "AI_BOARD_NOTION_OAUTH_CLIENT_ID",
        "AI_BOARD_NOTION_OAUTH_CLIENT_SECRET",
    ):
        monkeypatch.delenv(key, raising=False)
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "oauth-missing@example.com", "name": "OAuth Missing", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        response = client.get("/api/oauth/github/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is False
    assert data["setupUrl"] == "https://github.com/settings/developers"
    assert "AI_BOARD_GITHUB_OAUTH_CLIENT_ID" in data["missing"]
    assert "AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET" in data["missing"]
    assert data["redirectUri"].endswith("/api/oauth/github/callback")


def test_mcp_oauth_start_builds_provider_authorize_url(monkeypatch):
    monkeypatch.setenv("AI_BOARD_PUBLIC_BASE_URL", "https://board.example.test")
    monkeypatch.setenv("AI_BOARD_GITHUB_OAUTH_CLIENT_ID", "github-client")
    monkeypatch.setenv("AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET", "github-secret")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "oauth-ready@example.com", "name": "OAuth Ready", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        response = client.get("/api/oauth/github/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorizeUrl"])
    params = parse_qs(parsed.query)
    assert parsed.netloc == "github.com"
    assert parsed.path == "/login/oauth/authorize"
    assert params["client_id"] == ["github-client"]
    assert params["redirect_uri"] == ["https://board.example.test/api/oauth/github/callback"]
    assert "repo read:user user:email" in params["scope"]
    assert params["state"][0].count(".") == 1


def test_full_fastapi_flow(monkeypatch):
    def fake_collect(profile, limit=20, pages=2):
        assert limit == 12
        assert pages == 3
        return [
            CollectedItem(
                title="Mock issue from GitHub",
                source_type="github_issue",
                url="https://github.com/acme/private-repo/issues/1",
                text="Mock issue body for design review and Notion task sync",
                tags=["github", "issue"],
            )
        ], []

    monkeypatch.setattr("app.main.collect_profile_items", fake_collect)

    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["database"]["ok"] is True

        register = client.post(
            "/api/auth/register",
            json={"email": "a@example.com", "name": "Tester", "password": "password123"},
        )
        assert register.status_code == 200
        token = register.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        profile = client.put(
            "/api/profile/settings",
            headers=headers,
            json={
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "api_key_strategy": "Use per-user secret store variables.",
                "template_preset": "custom",
                "custom_template": "title: {title}\nstatus: {status}",
                "custom_connections": [
                    {
                        "label": "Profile Task DB",
                        "service": "notion",
                        "url": "https://www.notion.so/workspace/profile-db",
                        "api": "Notion API",
                        "auth_key_name": "PROFILE_NOTION_TOKEN",
                        "operation": "upsert_task_page",
                        "template": "title: {title}",
                    }
                ],
            },
        )
        assert profile.status_code == 200
        saved_profile = client.get("/api/profile/settings", headers=headers).json()["profileSettings"]
        assert saved_profile["aiModel"] == "gpt-4o-mini"
        assert saved_profile["customConnections"][0]["auth_key_name"] == "PROFILE_NOTION_TOKEN"

        integration_profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "GitHub private RAG",
                "source_kind": "github",
                "base_url": "https://github.com/acme/private-repo",
                "api_provider": "GitHub REST API",
                "token_name": "GITHUB_TOKEN",
                "token_value": "ghp_secret_value",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": ["issues", "commits", "pull_requests"],
                "collect_limit": 12,
                "collect_pages": 3,
                "custom_template": "source: {source}\nsummary: {summary}",
                "custom_connections": [
                    {
                        "label": "Private GitHub",
                        "service": "github",
                        "url": "https://github.com/acme/private-repo",
                        "api": "GitHub REST API",
                        "auth_key_name": "GITHUB_TOKEN",
                        "operation": "rag_collect_issues_commits_prs",
                        "template": "title: {title}\nurl: {url}",
                    }
                ],
            },
        )
        assert integration_profile.status_code == 200
        profile_json = integration_profile.json()["profile"]
        activities = client.get("/api/integration-activities", headers=headers)
        assert activities.status_code == 200
        assert activities.json()["activities"][0]["eventType"] == "integration_profile.created"
        assert "ghp_secret_value" not in str(activities.json())
        assert profile_json["hasToken"] is True
        assert profile_json["tokenStorage"] == "encrypted"
        assert "ghp_secret_value" not in str(profile_json)
        assert "pull_requests" in profile_json["ragTargets"]
        assert profile_json["collectLimit"] == 12
        assert profile_json["collectPages"] == 3
        with SessionLocal() as db:
            stored_profile = db.get(IntegrationProfile, profile_json["id"])
            assert stored_profile is not None
            assert stored_profile.token_value.startswith("enc:v1:")
            assert "ghp_secret_value" not in stored_profile.token_value
            assert reveal_secret(stored_profile.token_value) == "ghp_secret_value"
        readiness = client.get("/api/provider-readiness", headers=headers)
        assert readiness.status_code == 200
        readiness_by_key = {item["key"]: item for item in readiness.json()["providers"]}
        assert readiness_by_key["github"]["ready"] is True
        assert readiness_by_key["figma"]["ready"] is False
        notion_profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Notion task writer",
                "source_kind": "notion",
                "base_url": "1234567890abcdef1234567890abcdef",
                "api_provider": "Notion API",
                "token_name": "NOTION_TOKEN",
                "token_value": "notion_secret_value",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": ["notion_database"],
                "custom_connections": [
                    {
                        "label": "Notion task DB",
                        "service": "notion",
                        "url": "1234567890abcdef1234567890abcdef",
                        "api": "Notion API",
                        "auth_key_name": "NOTION_TOKEN",
                        "operation": "upsert_task_page",
                        "template": "title: {title}",
                    }
                ],
            },
        )
        assert notion_profile.status_code == 200

        figma_profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Figma review writer",
                "source_kind": "figma",
                "base_url": "https://www.figma.com/design/abc123/Demo",
                "api_provider": "Figma REST API",
                "token_name": "FIGMA_TOKEN",
                "token_value": "figma_secret_value",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": [],
                "custom_template": "comment: {summary}",
                "custom_connections": [],
            },
        )
        assert figma_profile.status_code == 200
        readiness_by_key = {item["key"]: item for item in client.get("/api/provider-readiness", headers=headers).json()["providers"]}
        assert readiness_by_key["figma"]["ready"] is True
        assert readiness_by_key["figma"]["profiles"][0]["tokenStorage"] == "encrypted"
        figma_write = client.post(
            f"/api/integration-profiles/{figma_profile.json()['profile']['id']}/write",
            headers=headers,
            json={"title": "Figma check", "body": "Create review comment dry-run.", "dry_run": True},
        )
        assert figma_write.status_code == 200
        assert figma_write.json()["write"]["status"] == "ready"
        assert figma_write.json()["write"]["service"] == "figma"
        assert "figma_secret_value" not in str(figma_write.json())
        blocked_live_write = client.post(
            f"/api/integration-profiles/{figma_profile.json()['profile']['id']}/write",
            headers=headers,
            json={"title": "Blocked live write", "body": "Missing confirmation.", "dry_run": False},
        )
        assert blocked_live_write.status_code == 400
        assert "WRITE LIVE" in blocked_live_write.json()["detail"]

        calendar_profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Calendar writer",
                "source_kind": "google_calendar",
                "base_url": "team@example.com",
                "api_provider": "Google Calendar API",
                "token_name": "GOOGLE_CALENDAR_TOKEN",
                "token_value": "calendar_secret_value",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": [],
                "custom_template": "event: {title}",
                "custom_connections": [],
            },
        )
        assert calendar_profile.status_code == 200
        calendar_write = client.post(
            f"/api/integration-profiles/{calendar_profile.json()['profile']['id']}/write",
            headers=headers,
            json={"title": "Calendar check", "body": "Create event dry-run.", "dry_run": True, "start_minutes_from_now": 20, "duration_minutes": 40},
        )
        assert calendar_write.status_code == 200
        assert calendar_write.json()["write"]["status"] == "ready"
        assert calendar_write.json()["write"]["service"] == "google_calendar"
        assert "team%40example.com" in calendar_write.json()["write"]["url"]
        assert "calendar_secret_value" not in str(calendar_write.json())

        custom_writer = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Custom Figma connection",
                "source_kind": "custom",
                "base_url": "",
                "api_provider": "Custom API",
                "token_name": "FIGMA_TOKEN",
                "token_value": "custom_figma_secret",
                "rag_targets": [],
                "custom_connections": [
                    {
                        "label": "Design file",
                        "service": "figma",
                        "url": "https://www.figma.com/design/customKey/Demo",
                        "api": "Figma REST API",
                        "auth_key_name": "FIGMA_TOKEN",
                        "operation": "create_review_comment",
                        "template": "comment: {summary}",
                    }
                ],
            },
        )
        assert custom_writer.status_code == 200
        readiness_by_key = {item["key"]: item for item in client.get("/api/provider-readiness", headers=headers).json()["providers"]}
        assert any(item["id"] == custom_writer.json()["profile"]["id"] and item["hasUrl"] for item in readiness_by_key["figma"]["profiles"])
        custom_write = client.post(
            f"/api/integration-profiles/{custom_writer.json()['profile']['id']}/write",
            headers=headers,
            json={"title": "Custom Figma check", "body": "Use custom connection URL.", "dry_run": True},
        )
        assert custom_write.status_code == 200
        assert custom_write.json()["write"]["service"] == "figma"
        assert "customKey" in custom_write.json()["write"]["url"]
        assert "custom_figma_secret" not in str(custom_write.json())

        collected = client.post(f"/api/integration-profiles/{profile_json['id']}/collect", headers=headers)
        assert collected.status_code == 200
        assert collected.json()["status"] == "collected"
        assert collected.json()["request"] == {"limit": 12, "pages": 3}
        assert collected.json()["saved"][0]["sourceType"] == "github_issue"
        profiles_after_collect = client.get("/api/integration-profiles", headers=headers).json()["profiles"]
        after_collect_profile = next(item for item in profiles_after_collect if item["id"] == profile_json["id"])
        assert after_collect_profile["lastCollect"]["status"] == "collected"
        assert after_collect_profile["lastCollect"]["saved"] == 1
        collected_again = client.post(f"/api/integration-profiles/{profile_json['id']}/collect", headers=headers)
        assert collected_again.status_code == 200
        assert collected_again.json()["status"] == "unchanged"
        assert collected_again.json()["skippedDuplicates"] == 1
        profiles_after_duplicate = client.get("/api/integration-profiles", headers=headers).json()["profiles"]
        after_duplicate_profile = next(item for item in profiles_after_duplicate if item["id"] == profile_json["id"])
        assert after_duplicate_profile["lastCollect"]["status"] == "unchanged"
        assert after_duplicate_profile["lastCollect"]["skippedDuplicates"] == 1
        activities_after_collect = client.get("/api/integration-activities", headers=headers).json()["activities"]
        assert any(item["eventType"] == "integration_profile.collect" and item["status"] == "unchanged" for item in activities_after_collect)
        assert any(item["eventType"] == "integration_profile.write" and item["provider"] == "figma" for item in activities_after_collect)
        assert any(item["eventType"] == "integration_profile.write" and item["provider"] == "google_calendar" for item in activities_after_collect)

        knowledge = client.post(
            "/api/knowledge",
            headers=headers,
            json={
                "title": "Audio meeting automation guide",
                "source_type": "audio",
                "instruction": "Use this transcript summary when writing Notion task actions.",
                "extracted_text": "When the meeting says design review, create a Figma checklist and a calendar event.",
                "tags": ["audio", "figma", "calendar"],
            },
        )
        assert knowledge.status_code == 200
        source_types = {source["sourceType"] for source in client.get("/api/knowledge", headers=headers).json()["sources"]}
        assert {"audio", "github_issue"} <= source_types
        user_rag = client.post("/api/knowledge/rag", headers=headers, json={"question": "design review Figma calendar"}).json()
        assert "Audio meeting automation guide" in user_rag["sources"]

        created = client.post(
            "/api/posts",
            headers=headers,
            json={
                "title": "GitHub Notion Calendar Figma integration",
                "content": "Connect operational automation instructions to the board.",
                "tags": ["github", "notion"],
            },
        )
        assert created.status_code == 200
        post_id = created.json()["post"]["id"]

        post_page = client.get("/api/posts?q=GitHub&limit=1&offset=0").json()
        assert post_page["total"] >= 1
        assert post_page["limit"] == 1
        assert post_page["offset"] == 0
        assert post_page["nextOffset"] == len(post_page["posts"])
        assert "hasMore" in post_page
        assert client.post(f"/api/posts/{post_id}/comments", headers=headers, json={"content": "checked"}).status_code == 200
        assert client.post("/api/ai/rag", json={"question": "GitHub Notion integration"}).status_code == 200

        automation = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Sync GitHub issues to Notion",
                "integration_profile_id": profile_json["id"],
                "source": "GitHub Issues",
                "destination": "Notion Tasks",
                "interval_minutes": 3,
                "instruction": "Summarize issue changes and reflect them in Notion tasks.",
                "template": "title / status / link / summary",
                "api_provider": "GitHub REST API + Notion API",
                "ai_agent": "SyncPlannerAgent",
                "template_preset": "custom",
                "custom_template": "title: {title}\nstatus: {status}\nlink: {source_url}",
                "custom_connections": [
                    {
                        "label": "Task DB",
                        "service": "notion",
                        "url": "https://www.notion.so/workspace/database-id",
                        "api": "Notion API",
                        "auth_key_name": "NOTION_TOKEN",
                        "operation": "upsert_task_page",
                        "template": "title: {title}\nstatus: {status}",
                    }
                ],
            },
        )
        assert automation.status_code == 200
        task_id = automation.json()["task"]["id"]
        activities_after_create = client.get("/api/integration-activities", headers=headers).json()["activities"]
        assert any(item["eventType"] == "automation.created" and item["automationTaskId"] == task_id for item in activities_after_create)
        assert automation.json()["task"]["integrationProfile"]["sourceKind"] == "github"
        assert [item["service"] for item in automation.json()["task"]["customConnections"]] == ["github", "notion"]
        assert client.get("/api/automations", headers=headers).json()["tasks"]
        written = []
        notion_tables = []

        def fake_execute_profile_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
            written.append({"service": profile.source_kind, "title": title, "body": body, "dryRun": dry_run})
            return {"service": profile.source_kind, "status": "written", "url": f"https://example.test/{profile.source_kind}", "dryRun": dry_run}

        def fake_write_notion_sources_report(profile, title, sources, template, dry_run=True, target_url=None):
            notion_tables.append({"service": profile.source_kind, "title": title, "sources": sources, "template": template, "dryRun": dry_run, "targetUrl": target_url})
            return {
                "service": "notion",
                "status": "written",
                "url": "https://example.test/notion",
                "dryRun": dry_run,
                "format": "template-rendered-blocks",
                "count": len(sources),
            }

        monkeypatch.setattr("app.main.execute_profile_write", fake_execute_profile_write)
        monkeypatch.setattr("app.main.write_notion_sources_report", fake_write_notion_sources_report)
        first_run = client.post(f"/api/automations/{task_id}/run", headers=headers)
        assert first_run.status_code == 200
        assert first_run.json()["run"]["result"]["status"] == "changed"
        assert first_run.json()["run"]["result"]["scheduled"] is False
        assert first_run.json()["run"]["result"]["targets"][0]["target"] == "github"
        assert first_run.json()["run"]["result"]["targets"][0]["operation"] == "rag_collect_issues_commits_prs"
        assert {"issues", "commits", "pull_requests"} <= {item["target"] for item in first_run.json()["run"]["result"]["externalRagSources"]}
        assert first_run.json()["run"]["result"]["liveWrites"][0]["service"] == "notion"
        assert first_run.json()["run"]["result"]["liveWrites"][0]["status"] == "written"
        assert notion_tables and notion_tables[0]["service"] == "notion"
        assert notion_tables[0]["dryRun"] is False
        assert notion_tables[0]["sources"][0]["title"] == "Mock issue from GitHub"
        second_run = client.post(f"/api/automations/{task_id}/run", headers=headers)
        assert second_run.status_code == 200
        assert second_run.json()["run"]["result"]["status"] == "skipped"
        assert second_run.json()["run"]["result"]["scheduled"] is False
        run_history = client.get(f"/api/automations/{task_id}/runs?limit=1&offset=0", headers=headers).json()
        assert run_history["task"]["id"] == task_id
        assert run_history["limit"] == 1
        assert run_history["offset"] == 0
        assert run_history["total"] == 1
        assert run_history["runs"][0]["taskId"] == task_id
        assert run_history["hasMore"] is False
        assert client.post(f"/api/automations/{task_id}/share", headers=headers).status_code == 200
        run_activities = client.get("/api/integration-activities", headers=headers).json()["activities"]
        assert any(item["eventType"] == "automation.run" and item["status"] == "changed" for item in run_activities)
        assert any(item["eventType"] == "automation.run" and item["status"] == "skipped" for item in run_activities)
        assert any(item["eventType"] == "automation.live_write" and item["provider"] == "notion" for item in run_activities)
        assert any(item["eventType"] == "automation.shared" for item in run_activities)
        changed_runs = client.get("/api/integration-activities?event_type=automation.run&status=changed", headers=headers).json()["activities"]
        assert changed_runs
        assert all(item["eventType"] == "automation.run" and item["status"] == "changed" for item in changed_runs)
        provider_writes = client.get("/api/integration-activities?provider=figma&event_type=integration_profile.write", headers=headers).json()["activities"]
        assert provider_writes
        assert all(item["provider"] == "figma" and item["eventType"] == "integration_profile.write" for item in provider_writes)
        dry_run_writes = client.get("/api/integration-activities?event_type=integration_profile.write&dry_run=true", headers=headers).json()["activities"]
        assert dry_run_writes
        assert all(item["details"]["dryRun"] is True for item in dry_run_writes)
        live_write_audit = client.get("/api/integration-activities?event_type=integration_profile.write&dry_run=false", headers=headers).json()["activities"]
        assert live_write_audit == []
        task_filtered = client.get(f"/api/integration-activities?automation_task_id={task_id}", headers=headers).json()["activities"]
        assert task_filtered
        assert all(item["automationTaskId"] == task_id for item in task_filtered)
        profile_filtered = client.get(f"/api/integration-activities?integration_profile_id={profile_json['id']}&limit=2", headers=headers).json()["activities"]
        assert 1 <= len(profile_filtered) <= 2
        assert all(item["integrationProfileId"] == profile_json["id"] for item in profile_filtered)
        first_activity_page = client.get("/api/integration-activities?limit=1&offset=0", headers=headers).json()
        assert first_activity_page["limit"] == 1
        assert first_activity_page["offset"] == 0
        assert first_activity_page["total"] >= len(run_activities)
        assert first_activity_page["nextOffset"] == 1
        assert first_activity_page["hasMore"] is True
        second_activity_page = client.get("/api/integration-activities?limit=1&offset=1", headers=headers).json()
        assert second_activity_page["offset"] == 1
        assert second_activity_page["activities"][0]["id"] != first_activity_page["activities"][0]["id"]

        scheduled = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Scheduled due task",
                "source": "Board",
                "destination": "Notion",
                "interval_minutes": 1,
                "instruction": "Run when scheduler sees this task due.",
                "template": "title / summary",
                "api_provider": "FastAPI scheduler",
                "ai_agent": "SchedulerAgent",
            },
        )
        assert scheduled.status_code == 200
        scheduled_task_id = scheduled.json()["task"]["id"]
        first_tick = client.post("/api/automations/scheduler/tick?limit=5", headers=headers)
        assert first_tick.status_code == 200
        assert any(item["taskId"] == scheduled_task_id and item["status"] == "changed" for item in first_tick.json()["results"])
        latest_scheduled_run = next(
            item for item in client.get("/api/automations", headers=headers).json()["tasks"] if item["id"] == scheduled_task_id
        )["lastResult"]
        assert '"scheduled": true' in latest_scheduled_run
        with SessionLocal() as db:
            scheduled_task = db.get(AutomationTask, scheduled_task_id)
            assert scheduled_task is not None
            scheduled_task.last_run_at = datetime.now(timezone.utc) - timedelta(minutes=5)
            db.commit()
        second_tick = client.post("/api/automations/scheduler/tick?limit=5", headers=headers)
        assert second_tick.status_code == 200
        assert any(item["taskId"] == scheduled_task_id and item["status"] == "skipped" for item in second_tick.json()["results"])
        assert client.delete(f"/api/automations/{task_id}", headers=headers).status_code == 200

        hub = client.post(
            "/api/integrations/hub/run",
            json={"instruction": "Read GitHub kanban and connect Google Calendar and Figma too"},
        )
        assert hub.status_code == 200
        targets = {item["target"] for item in hub.json()["actions"]}
        assert {"github", "google_calendar", "figma"} <= targets


def test_regular_user_only_sees_own_automations():
    with TestClient(app) as client:
        admin = client.post("/api/auth/register", json={"email": "admin2@example.com", "name": "Admin", "password": "password123"})
        user = client.post("/api/auth/register", json={"email": "user2@example.com", "name": "User", "password": "password123"})
        admin_headers = {"Authorization": f"Bearer {admin.json()['token']}"}
        user_headers = {"Authorization": f"Bearer {user.json()['token']}"}

        admin_profile = client.post(
            "/api/integration-profiles",
            headers=admin_headers,
            json={
                "name": "Admin Notion",
                "source_kind": "notion",
                "base_url": "https://www.notion.so/private-db",
                "api_provider": "Notion API",
                "token_name": "ADMIN_NOTION_TOKEN",
                "token_value": "secret",
                "rag_targets": ["notion_database", "notion_pages"],
            },
        )
        assert admin_profile.status_code == 200

        admin_task = client.post(
            "/api/automations",
            headers=admin_headers,
            json={
                "name": "Admin GitHub task",
                "source": "GitHub Issues",
                "destination": "Notion Tasks",
                "interval_minutes": 5,
                "instruction": "Sync admin GitHub issues to Notion.",
                "template": "title / link",
                "api_provider": "GitHub REST API + Notion API",
                "ai_agent": "SyncPlannerAgent",
            },
        )
        user_task = client.post(
            "/api/automations",
            headers=user_headers,
            json={
                "name": "User Calendar task",
                "source": "AI Board Posts",
                "destination": "Google Calendar",
                "interval_minutes": 10,
                "instruction": "Create calendar items for my posts.",
                "template": "title / due date",
                "api_provider": "FastAPI + Google Calendar API",
                "ai_agent": "ReviewRouteAgent",
            },
        )
        assert admin_task.status_code == 200
        assert user_task.status_code == 200

        visible_to_user = client.get("/api/automations", headers=user_headers).json()["tasks"]
        assert [task["name"] for task in visible_to_user] == ["User Calendar task"]
        user_tick = client.post("/api/automations/scheduler/tick", headers=user_headers)
        assert user_tick.status_code == 200
        assert user_tick.json()["results"]
        assert {item["taskId"] for item in user_tick.json()["results"]} == {user_task.json()["task"]["id"]}
        user_activities = client.get("/api/integration-activities", headers=user_headers).json()["activities"]
        assert user_activities
        assert all(activity["ownerId"] == user.json()["user"]["id"] for activity in user_activities)
        assert not any(activity["summary"].endswith("Admin GitHub task") for activity in user_activities)

        forbidden = client.post(f"/api/automations/{admin_task.json()['task']['id']}/run", headers=user_headers)
        assert forbidden.status_code == 403
        forbidden_runs = client.get(f"/api/automations/{admin_task.json()['task']['id']}/runs", headers=user_headers)
        assert forbidden_runs.status_code == 403

        forbidden_profile_use = client.post(
            "/api/automations",
            headers=user_headers,
            json={
                "name": "Steal admin profile",
                "integration_profile_id": admin_profile.json()["profile"]["id"],
                "source": "Notion",
                "destination": "Board",
                "interval_minutes": 5,
                "instruction": "Try using admin profile.",
                "template": "title / link",
                "api_provider": "Notion API",
                "ai_agent": "SyncPlannerAgent",
            },
        )
        assert forbidden_profile_use.status_code == 403


def test_selected_profile_custom_connections_are_part_of_skip_fingerprint():
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "profile-skip@example.com", "name": "Profile Skip", "password": "password123"},
        )
        assert register.status_code == 200
        headers = {"Authorization": f"Bearer {register.json()['token']}"}

        profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Profile owned custom workflow",
                "source_kind": "custom",
                "base_url": "https://api.example.com/tasks",
                "api_provider": "Custom REST API",
                "token_name": "CUSTOM_API_KEY",
                "token_value": "custom-secret",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": ["custom_records"],
                "custom_template": "profile-title: {title}",
                "custom_connections": [
                    {
                        "label": "Profile Custom Endpoint",
                        "service": "custom",
                        "url": "https://api.example.com/tasks",
                        "api": "Custom REST API",
                        "auth_key_name": "CUSTOM_API_KEY",
                        "operation": "upsert_task",
                        "template": "title: {title}\nstatus: {status}",
                    }
                ],
            },
        )
        assert profile.status_code == 200
        profile_id = profile.json()["profile"]["id"]

        automation = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Profile connection skip guard",
                "integration_profile_id": profile_id,
                "source": "Custom source",
                "destination": "Custom target",
                "interval_minutes": 5,
                "instruction": "Use the selected profile connection and skip unchanged reruns.",
                "template": "title / status",
                "api_provider": "Custom REST API",
                "ai_agent": "CustomWorkflowAgent",
                "template_preset": "custom",
                "custom_connections": [
                    {
                        "label": "Ignored form connection",
                        "service": "notion",
                        "url": "https://www.notion.so/workspace/db",
                        "api": "Notion API",
                        "auth_key_name": "NOTION_TOKEN",
                        "operation": "upsert_task_page",
                        "template": "title: {title}",
                    }
                ],
            },
        )
        assert automation.status_code == 200
        task = automation.json()["task"]
        assert task["integrationProfile"]["id"] == profile_id
        assert task["customConnections"][0]["service"] == "custom"
        assert task["customConnections"][0]["operation"] == "upsert_task"

        first_run = client.post(f"/api/automations/{task['id']}/run", headers=headers)
        assert first_run.status_code == 200
        assert first_run.json()["run"]["result"]["status"] == "changed"
        assert first_run.json()["run"]["result"]["targets"][0]["target"] == "custom"
        assert first_run.json()["run"]["result"]["targets"][0]["operation"] == "upsert_task"

        second_run = client.post(f"/api/automations/{task['id']}/run", headers=headers)
        assert second_run.status_code == 200
        assert second_run.json()["run"]["result"]["status"] == "skipped"
        assert second_run.json()["run"]["id"] is None

        with SessionLocal() as db:
            stored_task = db.get(AutomationTask, task["id"])
            assert stored_task is not None
            connections = json.loads(stored_task.custom_connections)
            connections[0]["operation"] = "upsert_task_v2"
            stored_task.custom_connections = json.dumps(connections, ensure_ascii=False)
            db.commit()

        third_run = client.post(f"/api/automations/{task['id']}/run", headers=headers)
        assert third_run.status_code == 200
        assert third_run.json()["run"]["result"]["status"] == "changed"
        assert third_run.json()["run"]["result"]["targets"][0]["operation"] == "upsert_task_v2"


def test_automation_no_data_skips_ai_policy_and_live_writes(monkeypatch):
    monkeypatch.setattr("app.main.collect_profile_items", lambda profile, limit=20, pages=2: ([], []))

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "nodata@example.com", "name": "No Data User", "password": "password123"},
        )
        assert register.status_code == 200
        headers = {"Authorization": f"Bearer {register.json()['token']}"}

        profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "No data GitHub profile",
                "source_kind": "github",
                "base_url": "https://github.com/example/repo",
                "api_provider": "GitHub API",
                "token_name": "GITHUB_TOKEN",
                "token_value": "secret",
                "rag_targets": ["commits"],
            },
        )
        assert profile.status_code == 200
        profile_id = profile.json()["profile"]["id"]

        automation = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "No data automation",
                "integration_profile_id": profile_id,
                "source": "GitHub",
                "destination": "Notion",
                "interval_minutes": 10,
                "instruction": "Write only when a real source change exists.",
                "template": "요청 템플릿에 맞춰 정리",
                "api_provider": "GitHub + Notion",
                "ai_agent": "TemplateAgent",
                "custom_connections": [
                    {
                        "label": "Notion report",
                        "service": "notion",
                        "url": "3797051c2f998094b2a5e5062d353881",
                        "api": "Notion API",
                        "auth_key_name": "NOTION_TOKEN",
                        "operation": "append_template_report",
                        "template": "요청 템플릿 유지",
                    }
                ],
            },
        )
        assert automation.status_code == 200
        task_id = automation.json()["task"]["id"]

        run = client.post(f"/api/automations/{task_id}/run", headers=headers)
        assert run.status_code == 200
        result = run.json()["run"]["result"]
        assert result["status"] == "no-data"
        assert result["liveWrites"] == []
        assert "no collected source items" in result["aiCallPolicy"]


def test_watched_automation_commit_summary_is_specific_korean():
    summary = korean_summary_for_source(
        {
            "source_type": "github_commit",
            "title": "[GitHub MCP OAuth profile] Commit 691ffe4e01e7: Skip watched automations without source changes",
            "summary": "author: Wish-Upon-A-Star sha: 691ffe4e01e76fbb13d7d1d89cfa52628d395ad9",
        }
    )
    assert "새 커밋, 이슈, 페이지 변경" in summary
    assert "AI 모델 호출과 외부 쓰기를 건너뛰도록" in summary
    clarified = korean_summary_for_source(
        {
            "source_type": "github_commit",
            "title": "[GitHub MCP OAuth profile] Commit b0c8a0c4ac05: Clarify watched automation commit summaries",
            "summary": "author: Wish-Upon-A-Star sha: b0c8a0c4ac051a3982d6b8d97b0584359ca77bd9",
        }
    )
    assert "포괄 문장으로 보이지 않도록" in clarified


def test_ai_board_generated_issue_is_filtered_from_automation_inputs():
    items, filtered = main_module.filter_automation_loop_sources(
        [
            CollectedItem(
                title="[AI Board] GitHub 이슈를 Notion 업무로 동기화",
                source_type="github_issue",
                url="https://github.com/Wish-Upon-A-Star/ai-board-jungle/issues/6",
                text="Automation: GitHub 이슈를 Notion 업무로 동기화\nRoute: GitHub -> Notion",
                tags=["github", "issue", "ai-board", "automation"],
            ),
            CollectedItem(
                title="사용자 요청 이슈",
                source_type="github_issue",
                url="https://github.com/Wish-Upon-A-Star/ai-board-jungle/issues/9",
                text="사용자가 직접 만든 변경 요청",
                tags=["github", "issue"],
            ),
        ]
    )
    assert filtered == 1
    assert [item.title for item in items] == ["사용자 요청 이슈"]


def test_custom_connection_validation_rejects_incomplete_entries():
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "validation@example.com", "name": "Validation User", "password": "password123"},
        )
        assert register.status_code == 200
        headers = {"Authorization": f"Bearer {register.json()['token']}"}

        invalid_connection = {
            "label": "Broken target",
            "service": "notion",
            "url": "https://www.notion.so/workspace/db",
            "api": "",
            "auth_key_name": " ",
            "operation": "",
            "template": "title: {title}",
        }
        expected_missing = "api, auth_key_name, operation"

        profile_settings = client.put(
            "/api/profile/settings",
            headers=headers,
            json={
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "api_key_strategy": "Use private user token references.",
                "template_preset": "custom",
                "custom_template": "title: {title}",
                "custom_connections": [invalid_connection],
            },
        )
        assert profile_settings.status_code == 422
        assert expected_missing in str(profile_settings.json())

        integration_profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Broken integration profile",
                "source_kind": "custom",
                "base_url": "",
                "api_provider": "Custom API",
                "token_name": "CUSTOM_API_KEY",
                "token_value": "secret",
                "rag_targets": [],
                "custom_template": "title: {title}",
                "custom_connections": [invalid_connection],
            },
        )
        assert integration_profile.status_code == 422
        assert expected_missing in str(integration_profile.json())

        automation = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Broken automation",
                "source": "Custom source",
                "destination": "Custom target",
                "interval_minutes": 5,
                "instruction": "Reject incomplete custom connection metadata.",
                "template": "title / action",
                "api_provider": "Custom API",
                "ai_agent": "CustomWorkflowAgent",
                "custom_connections": [invalid_connection],
            },
        )
        assert automation.status_code == 422
        assert expected_missing in str(automation.json())


def test_command_secret_provider_stores_external_references(monkeypatch, tmp_path):
    script = tmp_path / "secret_command.py"
    script.write_text(
        "\n".join(
            [
                "import base64, json, sys",
                "payload = json.loads(sys.stdin.read())",
                "if payload['action'] == 'protect':",
                "    value = 'vault:' + base64.urlsafe_b64encode(payload['value'].encode()).decode()",
                "elif payload['action'] == 'reveal':",
                "    value = base64.urlsafe_b64decode(payload['value'].removeprefix('vault:').encode()).decode()",
                "else:",
                "    raise SystemExit(2)",
                "print(json.dumps({'value': value}))",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("AI_BOARD_TOKEN_SECRET_PROVIDER", "command")
    monkeypatch.setenv("AI_BOARD_TOKEN_SECRET_COMMAND", f'"{sys.executable}" "{script}"')
    settings.cache_clear()
    try:
        with TestClient(app) as client:
            register = client.post(
                "/api/auth/register",
                json={"email": "vault@example.com", "name": "Vault User", "password": "password123"},
            )
            assert register.status_code == 200
            headers = {"Authorization": f"Bearer {register.json()['token']}"}
            created = client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Vault GitHub",
                    "source_kind": "github",
                    "base_url": "https://github.com/acme/private-repo",
                    "api_provider": "GitHub REST API",
                    "token_name": "GITHUB_TOKEN",
                    "token_value": "vault_secret_value",
                    "rag_targets": ["issues"],
                },
            )
            assert created.status_code == 200
            profile = created.json()["profile"]
            assert profile["tokenStorage"] == "external"
            assert profile["hasToken"] is True
            assert "vault_secret_value" not in str(profile)
            readiness = client.get("/api/provider-readiness", headers=headers)
            assert readiness.status_code == 200
            readiness_by_key = {item["key"]: item for item in readiness.json()["providers"]}
            assert readiness_by_key["github"]["ready"] is True
            assert readiness_by_key["github"]["profiles"][0]["tokenStorage"] == "external"
            assert "vault_secret_value" not in str(readiness.json())
            with SessionLocal() as db:
                stored = db.get(IntegrationProfile, profile["id"])
                assert stored is not None
                assert stored.token_value.startswith("cmd:v1:")
                assert "vault_secret_value" not in stored.token_value
                assert reveal_secret(stored.token_value) == "vault_secret_value"
    finally:
        monkeypatch.setenv("AI_BOARD_TOKEN_SECRET_PROVIDER", "local")
        monkeypatch.delenv("AI_BOARD_TOKEN_SECRET_COMMAND", raising=False)
        settings.cache_clear()


def test_sample_secret_adapter_roundtrip(tmp_path):
    adapter = Path("scripts/secret-adapter.sample.py")
    store = tmp_path / "adapter-store.json"
    env = {
        **os.environ,
        "AI_BOARD_SECRET_ADAPTER_STORE": str(store),
        "AI_BOARD_SECRET_ADAPTER_MASTER_KEY": "test-master-key",
    }
    protected = subprocess.run(
        [sys.executable, str(adapter)],
        input=json.dumps({"action": "protect", "value": "sample_secret_value"}),
        text=True,
        capture_output=True,
        env=env,
        check=True,
    )
    reference = json.loads(protected.stdout)["value"]
    assert reference.startswith("ai-board/")
    assert "sample_secret_value" not in store.read_text(encoding="utf-8")
    revealed = subprocess.run(
        [sys.executable, str(adapter)],
        input=json.dumps({"action": "reveal", "value": reference}),
        text=True,
        capture_output=True,
        env=env,
        check=True,
    )
    assert json.loads(revealed.stdout)["value"] == "sample_secret_value"


def test_rag_degrades_when_redis_handshake_is_malformed(monkeypatch):
    class BrokenRedis:
        def ping(self):
            raise AttributeError("'list' object has no attribute 'get'")

    monkeypatch.setattr("app.cache.Redis.from_url", lambda *args, **kwargs: BrokenRedis())

    with TestClient(app) as client:
        response = client.post("/api/ai/rag", json={"question": "GitHub Notion integration"})

    assert response.status_code == 200
    assert "answer" in response.json()


def test_github_webhook_signature_triggers_matching_automation(monkeypatch):
    monkeypatch.setenv("AI_BOARD_GITHUB_WEBHOOK_SECRET", "hook-secret")
    settings.cache_clear()
    writes = []
    notion_tables = []

    def fake_collect(profile, limit=20, pages=2):
        return [
            CollectedItem(
                title="Webhook commit",
                source_type="github_commit",
                url="https://github.com/acme/hooked/commit/abc",
                text="Webhook-triggered commit body",
                tags=["github", "commit"],
            )
        ], []

    monkeypatch.setattr("app.main.collect_profile_items", fake_collect)
    def fake_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
        writes.append({"service": profile.source_kind, "title": title, "body": body, "dryRun": dry_run})
        return {
            "service": profile.source_kind,
            "status": "written",
            "url": f"https://example.test/{profile.source_kind}",
            "dryRun": dry_run,
        }

    monkeypatch.setattr("app.main.execute_profile_write", fake_write)

    def fake_write_notion_sources_report(profile, title, sources, template, dry_run=True, target_url=None):
        notion_tables.append({
            "service": profile.source_kind,
            "title": title,
            "sources": [{"title": source.title, "text": source.extracted_text, "url": source.file_name} for source in sources],
            "template": template,
            "dryRun": dry_run,
            "targetUrl": target_url,
        })
        return {"service": "notion", "status": "written", "url": "https://example.test/notion", "dryRun": dry_run, "format": "template-rendered-blocks", "count": len(sources)}

    monkeypatch.setattr("app.main.write_notion_sources_report", fake_write_notion_sources_report)
    try:
        with TestClient(app) as client:
            register = client.post(
                "/api/auth/register",
                json={"email": "webhook@example.com", "name": "Webhook User", "password": "password123"},
            )
            headers = {"Authorization": f"Bearer {register.json()['token']}"}
            github = client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Hooked GitHub",
                    "source_kind": "github",
                    "base_url": "git@github.com:acme/hooked.git",
                    "api_provider": "GitHub REST API",
                    "token_name": "GITHUB_TOKEN",
                    "token_value": "github_hook_token",
                    "rag_targets": ["commits"],
                    "custom_connections": [
                        {
                            "label": "GitHub repo",
                            "service": "github",
                            "url": "https://github.com/acme/hooked",
                            "api": "GitHub REST API",
                            "auth_key_name": "GITHUB_TOKEN",
                            "operation": "rag_collect_issues_commits_prs",
                            "template": "commit: {title}",
                        }
                    ],
                },
            ).json()["profile"]
            client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Webhook Notion",
                    "source_kind": "notion",
                    "base_url": "1234567890abcdef1234567890abcdef",
                    "api_provider": "Notion API",
                    "token_name": "NOTION_TOKEN",
                    "token_value": "notion_hook_token",
                    "rag_targets": [],
                },
            )
            task = client.post(
                "/api/automations",
                headers=headers,
                json={
                    "name": "Webhook sync",
                    "integration_profile_id": github["id"],
                    "source": "GitHub Commits",
                    "destination": "Notion Tasks",
                    "interval_minutes": 5,
                    "instruction": "When GitHub changes arrive, write a Notion task.",
                    "template": "commit / link / next action",
                    "api_provider": "GitHub REST API + Notion API",
                    "ai_agent": "WebhookAgent",
                    "github_repo_url": "",
                    "custom_connections": [
                        {
                            "label": "Notion task DB",
                            "service": "notion",
                            "url": "1234567890abcdef1234567890abcdef",
                            "api": "Notion API",
                            "auth_key_name": "NOTION_TOKEN",
                            "operation": "upsert_task_page",
                            "template": "title: {title}",
                        }
                    ],
                },
            ).json()["task"]
            payload = json.dumps({"repository": {"full_name": "ACME/Hooked", "ssh_url": "git@github.com:ACME/Hooked.git"}}).encode()
            bad = client.post("/api/webhooks/github", content=payload, headers={"X-Hub-Signature-256": "sha256=bad"})
            assert bad.status_code == 401
            signature = "sha256=" + hmac.new(b"hook-secret", payload, hashlib.sha256).hexdigest()
            triggered = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={"X-Hub-Signature-256": signature, "X-GitHub-Event": "push"},
            )
            assert triggered.status_code == 200
            data = triggered.json()
            assert data["matched"] == 1
            assert data["repos"] == ["git@github.com:ACME/Hooked.git", "https://github.com/ACME/Hooked"]
            assert data["triggered"][0]["taskId"] == task["id"]
            assert data["triggered"][0]["status"] == "changed"
            assert notion_tables
            assert notion_tables[0]["service"] == "notion"
            assert "요청 템플릿" in notion_tables[0]["title"]
            assert notion_tables[0]["sources"][0]["title"] == "[Hooked GitHub] Webhook commit"
            activities = client.get("/api/integration-activities?event_type=automation.live_write", headers=headers).json()["activities"]
            assert any(item["provider"] == "notion" and item["status"] == "written" for item in activities)
    finally:
        monkeypatch.delenv("AI_BOARD_GITHUB_WEBHOOK_SECRET", raising=False)
        settings.cache_clear()


def test_github_webhook_commits_are_written_to_notion_without_collector(monkeypatch):
    monkeypatch.setenv("AI_BOARD_GITHUB_WEBHOOK_SECRET", "hook-secret")
    settings.cache_clear()
    writes = []
    notion_tables = []

    def no_live_collect(profile, limit=20, pages=2):
        return [], ["collector should not be required for webhook commit payloads"]

    def fake_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
        writes.append({"service": profile.source_kind, "title": title, "body": body, "dryRun": dry_run})
        return {
            "service": profile.source_kind,
            "status": "written",
            "id": "page-write",
            "url": "https://www.notion.so/3797051c2f9981b4bad3fe6545622eb8",
            "dryRun": dry_run,
            "target": "page",
        }

    monkeypatch.setattr("app.main.collect_profile_items", no_live_collect)
    monkeypatch.setattr("app.main.execute_profile_write", fake_write)

    def fake_write_notion_sources_report(profile, title, sources, template, dry_run=True, target_url=None):
        notion_tables.append({
            "service": profile.source_kind,
            "title": title,
            "sources": [{"title": source.title, "text": source.extracted_text, "url": source.file_name} for source in sources],
            "template": template,
            "dryRun": dry_run,
            "targetUrl": target_url,
        })
        return {"service": "notion", "status": "written", "url": "https://example.test/notion", "dryRun": dry_run, "format": "template-rendered-blocks", "count": len(sources)}

    monkeypatch.setattr("app.main.write_notion_sources_report", fake_write_notion_sources_report)
    try:
        with TestClient(app) as client:
            register = client.post(
                "/api/auth/register",
                json={"email": "webhook-commit-page@example.com", "name": "Webhook Commit User", "password": "password123"},
            )
            headers = {"Authorization": f"Bearer {register.json()['token']}"}
            github = client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Webhook Payload GitHub",
                    "source_kind": "github",
                    "base_url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
                    "api_provider": "GitHub REST API",
                    "token_name": "GITHUB_TOKEN",
                    "token_value": "github_hook_token",
                    "rag_targets": ["commits"],
                },
            ).json()["profile"]
            client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Small Demo Notion Page",
                    "source_kind": "notion",
                    "base_url": "https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8",
                    "api_provider": "Notion API",
                    "token_name": "NOTION_TOKEN",
                    "token_value": "notion_page_token",
                    "rag_targets": ["notion_pages"],
                },
            )
            task = client.post(
                "/api/automations",
                headers=headers,
                json={
                    "name": "GitHub commits to small Notion page",
                    "integration_profile_id": github["id"],
                    "source": "GitHub Push",
                    "destination": "Small Notion Page",
                    "interval_minutes": 5,
                    "instruction": "When GitHub pushes arrive, append commit summaries to the small Notion demo page.",
                    "template": "commit / author / link / next action",
                    "api_provider": "GitHub webhook + Notion API",
                    "ai_agent": "WebhookCommitAgent",
                    "custom_connections": [
                        {
                            "label": "Small Notion demo page",
                            "service": "notion",
                            "url": "https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8",
                            "api": "Notion API",
                            "auth_key_name": "NOTION_TOKEN",
                            "operation": "append_page_update",
                            "template": "commit: {title}\nsummary: {summary}\nlink: {url}",
                        }
                    ],
                },
            ).json()["task"]
            payload = json.dumps(
                {
                    "repository": {
                        "full_name": "Wish-Upon-A-Star/ai-board-jungle",
                        "html_url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
                    },
                    "commits": [
                        {
                            "id": "7ee9f823ab2a61a52cba4eb4bbd29f6713af6a14",
                            "message": "Add guarded live apply command",
                            "url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle/commit/7ee9f82",
                            "author": {"name": "Codex"},
                        }
                    ],
                }
            ).encode()
            signature = "sha256=" + hmac.new(b"hook-secret", payload, hashlib.sha256).hexdigest()
            triggered = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={"X-Hub-Signature-256": signature, "X-GitHub-Event": "push"},
            )
            assert triggered.status_code == 200
            data = triggered.json()
            assert data["matched"] == 1
            assert data["commits"] == 1
            assert data["triggered"][0]["taskId"] == task["id"]
            assert data["triggered"][0]["status"] == "changed"
            assert notion_tables
            assert notion_tables[0]["service"] == "notion"
            assert "요청 템플릿" in notion_tables[0]["title"]
            assert notion_tables[0]["sources"][0]["title"].startswith("[Webhook Payload GitHub] Webhook commit 7ee9f823ab2a")
            assert "Add guarded live apply command" in notion_tables[0]["sources"][0]["text"]
    finally:
        monkeypatch.delenv("AI_BOARD_GITHUB_WEBHOOK_SECRET", raising=False)
        settings.cache_clear()


def test_notion_webhook_signature_triggers_matching_automation(monkeypatch):
    monkeypatch.setenv("AI_BOARD_NOTION_WEBHOOK_SECRET", "notion-hook-secret")
    settings.cache_clear()
    writes = []
    notion_tables = []

    def fake_collect(profile, limit=20, pages=2):
        return [
            CollectedItem(
                title="Webhook task page",
                source_type="notion_page",
                url="https://www.notion.so/workspace/hooked-page",
                text="Webhook-triggered Notion task content",
                tags=["notion", "page"],
            )
        ], []

    def fake_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
        writes.append({"service": profile.source_kind, "title": title, "body": body, "dryRun": dry_run})
        return {
            "service": profile.source_kind,
            "status": "written",
            "url": f"https://example.test/{profile.source_kind}",
            "dryRun": dry_run,
        }

    monkeypatch.setattr("app.main.collect_profile_items", fake_collect)
    monkeypatch.setattr("app.main.execute_profile_write", fake_write)

    def fake_write_notion_sources_report(profile, title, sources, template, dry_run=True, target_url=None):
        notion_tables.append({
            "service": profile.source_kind,
            "title": title,
            "sources": [{"title": source.title, "text": source.extracted_text, "url": source.file_name} for source in sources],
            "template": template,
            "dryRun": dry_run,
            "targetUrl": target_url,
        })
        return {"service": "notion", "status": "written", "url": "https://example.test/notion", "dryRun": dry_run, "format": "template-rendered-blocks", "count": len(sources)}

    monkeypatch.setattr("app.main.write_notion_sources_report", fake_write_notion_sources_report)
    try:
        with TestClient(app) as client:
            register = client.post(
                "/api/auth/register",
                json={"email": "notion-webhook@example.com", "name": "Notion Hook User", "password": "password123"},
            )
            headers = {"Authorization": f"Bearer {register.json()['token']}"}
            notion = client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Hooked Notion",
                    "source_kind": "notion",
                    "base_url": "1234567890abcdef1234567890abcdef",
                    "api_provider": "Notion API",
                    "token_name": "NOTION_TOKEN",
                    "token_value": "notion_webhook_token",
                    "rag_targets": ["notion_pages"],
                },
            ).json()["profile"]
            task = client.post(
                "/api/automations",
                headers=headers,
                json={
                    "name": "Notion webhook sync",
                    "integration_profile_id": notion["id"],
                    "source": "Notion Pages",
                    "destination": "Notion Tasks",
                    "interval_minutes": 5,
                    "instruction": "When Notion changes arrive, summarize and write a task page.",
                    "template": "page / link / next action",
                    "api_provider": "Notion API",
                    "ai_agent": "NotionWebhookAgent",
                    "notion_database_url": "1234567890abcdef1234567890abcdef",
                    "custom_connections": [
                        {
                            "label": "Notion task DB",
                            "service": "notion",
                            "url": "1234567890abcdef1234567890abcdef",
                            "api": "Notion API",
                            "auth_key_name": "NOTION_TOKEN",
                            "operation": "upsert_task_page",
                            "template": "title: {title}",
                        }
                    ],
                },
            ).json()["task"]
            payload = json.dumps({"data": {"parent": {"id": "12345678-90ab-cdef-1234-567890abcdef"}}}).encode()
            bad = client.post("/api/webhooks/notion", content=payload, headers={"X-AI-Board-Signature": "sha256=bad"})
            assert bad.status_code == 401
            signature = "sha256=" + hmac.new(b"notion-hook-secret", payload, hashlib.sha256).hexdigest()
            triggered = client.post("/api/webhooks/notion", content=payload, headers={"X-AI-Board-Signature": signature})
            assert triggered.status_code == 200
            data = triggered.json()
            assert data["matched"] == 1
            assert data["targets"] == ["12345678-90ab-cdef-1234-567890abcdef"]
            assert data["triggered"][0]["taskId"] == task["id"]
            assert data["triggered"][0]["status"] == "changed"
            assert notion_tables
            assert notion_tables[0]["service"] == "notion"
            assert "요청 템플릿" in notion_tables[0]["title"]
            assert notion_tables[0]["sources"][0]["title"] == "[Hooked Notion] Webhook task page"
    finally:
        monkeypatch.delenv("AI_BOARD_NOTION_WEBHOOK_SECRET", raising=False)
        settings.cache_clear()


def test_high_volume_query_indexes_exist():
    init_db()
    indexes = {
        table: {item["name"] for item in inspect(engine).get_indexes(table)}
        for table in [
            "integration_activities",
            "knowledge_sources",
            "automation_tasks",
            "automation_runs",
            "integration_profiles",
            "posts",
        ]
    }
    assert {
        "ix_activities_owner_created",
        "ix_activities_owner_event_created",
        "ix_activities_owner_provider_event",
        "ix_activities_owner_status_created",
        "ix_activities_owner_task_created",
        "ix_activities_owner_profile_created",
    } <= indexes["integration_activities"]
    assert {"ix_knowledge_owner_created", "ix_knowledge_owner_type_file"} <= indexes["knowledge_sources"]
    assert {"ix_tasks_owner_created", "ix_tasks_owner_status_created", "ix_tasks_status_created"} <= indexes["automation_tasks"]
    assert {"ix_runs_task_created", "ix_runs_owner_created"} <= indexes["automation_runs"]
    assert {"ix_profiles_owner_created", "ix_profiles_owner_source"} <= indexes["integration_profiles"]
    assert {"ix_posts_status_created", "ix_posts_author_created"} <= indexes["posts"]
