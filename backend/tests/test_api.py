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
from app.models import AutomationRun, AutomationTask, IntegrationProfile, KnowledgeSource, SystemSetting, User
from app.live_writers import korean_summary_for_source, notion_sources_template_children, write_calendar_event, write_github_issue, write_notion_sources_report, write_notion_task
from app.security import reveal_secret
from app.taskory_import import normalize_taskory_export


def find_first_block(blocks, block_type):
    for block in blocks:
        if block.get("type") == block_type:
            return block
        payload = block.get(block.get("type"), {})
        for child_key in ("children",):
            found = find_first_block(payload.get(child_key, []), block_type)
            if found:
                return found
    return None


def collect_block_text(blocks):
    parts = []
    for block in blocks:
        payload = block.get(block.get("type"), {})
        rich_text = payload.get("rich_text", [])
        parts.append("".join(part["text"]["content"] for part in rich_text if "text" in part))
        parts.append(collect_block_text(payload.get("children", [])))
    return "\n".join(part for part in parts if part)


def test_taskory_state_json_normalizes_for_rag():
    raw = json.dumps(
        {
            "nodes": {
                "root": {"title": "root", "children": ["project"]},
                "project": {"title": "AI Board 연동", "memo": "Taskory 작업을 RAG로 보냅니다.", "children": ["child"]},
                "child": {"title": "JSONL 내보내기", "isToday": True, "priority": 2, "memo": "자동화 참고 자료로 저장"},
            }
        },
        ensure_ascii=False,
    )

    normalized, detected = normalize_taskory_export(raw, "task-explorer-state.json")

    assert detected is True
    assert "Taskory 작업 자료" in normalized
    assert "AI Board 연동" in normalized
    assert "경로: AI Board 연동 > JSONL 내보내기" in normalized
    assert "상태: 오늘 작업" in normalized
    assert "자동화 참고 자료로 저장" in normalized


def test_taskory_jsonl_export_normalizes_for_rag():
    raw = "\n".join(
        [
            json.dumps({"title": "커밋 요약", "path": "운영 > GitHub", "kind": "task", "text": "최근 커밋을 한국어로 요약"}, ensure_ascii=False),
            json.dumps({"title": "Notion 반영", "memo": "보드에 카드 생성", "completedAt": "2026-06-11T00:00:00Z"}, ensure_ascii=False),
        ]
    )

    normalized, detected = normalize_taskory_export(raw, "taskory-ai-board.jsonl")

    assert detected is True
    assert "커밋 요약" in normalized
    assert "최근 커밋을 한국어로 요약" in normalized
    assert "Notion 반영" in normalized
    assert "상태: 완료" in normalized


def test_audio_transcription_uses_user_openai_profile(monkeypatch):
    captured = {}

    class FakeOpenAIResponse:
        status_code = 200
        text = '{"text":"회의 내용을 작업 카드로 정리합니다."}'

        def json(self):
            return {"text": "회의 내용을 작업 카드로 정리합니다."}

    class FakeAsyncClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            captured["url"] = url
            captured["headers"] = headers or {}
            captured["data"] = data or {}
            captured["file"] = files["file"]
            return FakeOpenAIResponse()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", FakeAsyncClient)

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "voice@example.com", "name": "Voice User", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "OpenAI API 키",
                "source_kind": "custom",
                "base_url": "https://api.openai.com/v1",
                "api_provider": "OpenAI API",
                "token_name": "OPENAI_API_KEY",
                "token_value": "sk-user-openai",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": ["ai"],
            },
        )
        assert profile.status_code == 200
        openai_profile = profile.json()["profile"]

        response = client.post(
            "/api/ai/transcribe",
            headers=headers,
            data={"model": "gpt-4o-mini-transcribe", "prompt": "업무 회의", "integration_profile_id": openai_profile["id"]},
            files={"file": ("meeting.wav", b"RIFF0000WAVE", "audio/wav")},
        )

    assert response.status_code == 200
    assert response.json()["text"] == "회의 내용을 작업 카드로 정리합니다."
    assert response.json()["integrationProfileId"] == openai_profile["id"]
    assert response.json()["integrationProfileName"] == "OpenAI API 키"
    assert captured["url"] == "https://api.openai.com/v1/audio/transcriptions"
    assert captured["headers"]["Authorization"] == "Bearer sk-user-openai"
    assert captured["data"]["model"] == "gpt-4o-mini-transcribe"
    assert captured["data"]["prompt"] == "업무 회의"
    assert captured["file"][0] == "meeting.wav"


def test_audio_transcription_can_save_directly_to_knowledge(monkeypatch):
    class FakeOpenAIResponse:
        status_code = 200
        text = '{"text":"회의 결정사항을 지식자료로 저장합니다."}'

        def json(self):
            return {"text": "회의 결정사항을 지식자료로 저장합니다."}

    class FakeAsyncClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            return FakeOpenAIResponse()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", FakeAsyncClient)

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "voice-save@example.com", "name": "Voice Save", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "OpenAI API 키",
                "source_kind": "custom",
                "base_url": "https://api.openai.com/v1",
                "api_provider": "OpenAI API",
                "token_name": "OPENAI_API_KEY",
                "token_value": "sk-user-openai",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": ["ai"],
            },
        )
        openai_profile = profile.json()["profile"]

        response = client.post(
            "/api/ai/transcribe",
            headers=headers,
            data={
                "model": "gpt-4o-mini-transcribe",
                "prompt": "회의 결정사항 중심으로 전사",
                "integration_profile_id": openai_profile["id"],
                "save_to_knowledge": "true",
                "title": "회의 전사",
                "instruction": "회의 전사 내용을 RAG 근거로 사용",
                "tags": "audio,meeting,openai",
            },
            files={"file": ("meeting.wav", b"RIFF0000WAVE", "audio/wav")},
        )
        sources = client.get("/api/knowledge", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"]["title"] == "회의 전사"
    assert payload["source"]["sourceType"] == "audio"
    assert payload["source"]["extractedText"] == "회의 결정사항을 지식자료로 저장합니다."
    assert payload["source"]["tags"] == ["audio", "meeting", "openai"]
    assert "rag" in payload
    assert sources.status_code == 200
    assert any(source["title"] == "회의 전사" for source in sources.json()["sources"])


def test_audio_transcription_splits_large_files_with_ffmpeg(monkeypatch):
    calls = []

    class FakeOpenAIResponse:
        status_code = 200
        text = '{"text":"chunk"}'

        def __init__(self, value):
            self.value = value
            self.text = json.dumps({"text": value}, ensure_ascii=False)

        def json(self):
            return {"text": self.value}

    class FakeAsyncClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            calls.append({"url": url, "headers": headers or {}, "data": data or {}, "file": files["file"]})
            return FakeOpenAIResponse(f"전사 조각 {len(calls)}")

    def fake_run(command, capture_output=True, text=True, timeout=180):
        output_pattern = Path(command[-1])
        (output_pattern.parent / "chunk-000.mp3").write_bytes(b"chunk-a")
        (output_pattern.parent / "chunk-001.mp3").write_bytes(b"chunk-b")

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return Result()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(main_module.shutil, "which", lambda name: "ffmpeg")
    monkeypatch.setattr(main_module.subprocess, "run", fake_run)

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "large-voice@example.com", "name": "Large Voice", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "OpenAI API 키",
                "source_kind": "custom",
                "base_url": "https://api.openai.com/v1",
                "api_provider": "OpenAI API",
                "token_name": "OPENAI_API_KEY",
                "token_value": "sk-user-openai",
                "ai_provider": "OpenAI",
                "ai_model": "gpt-4o-mini",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": ["ai"],
            },
        )
        response = client.post(
            "/api/ai/transcribe",
            headers=headers,
            data={"model": "whisper-1", "prompt": "긴 회의"},
            files={"file": ("large.wav", b"0" * (main_module.OPENAI_AUDIO_DIRECT_LIMIT + 1), "audio/wav")},
        )

    assert response.status_code == 200
    assert response.json()["text"] == "전사 조각 1\n\n전사 조각 2"
    assert response.json()["parts"] == 2
    assert [call["file"][0] for call in calls] == ["chunk-000.mp3", "chunk-001.mp3"]
    assert all(call["file"][2] == "audio/mpeg" for call in calls)
    assert "1/2번째 조각" in calls[0]["data"]["prompt"]
    assert "2/2번째 조각" in calls[1]["data"]["prompt"]


def test_integration_profile_validate_github_success(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        is_success = True

        def json(self):
            return {"full_name": "Wish-Upon-A-Star/ai-board-jungle"}

    def fake_get(url, headers=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers or {}
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(main_module.httpx, "get", fake_get)

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "validate-github@example.com", "name": "Validate GitHub", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "GitHub 검증",
                "source_kind": "github",
                "base_url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
                "api_provider": "GitHub REST",
                "token_name": "GITHUB_TOKEN",
                "token_value": "ghp-test-token",
                "rag_targets": ["commits"],
            },
        ).json()["profile"]
        response = client.post(f"/api/integration-profiles/{profile['id']}/validate", headers=headers)

    assert response.status_code == 200
    assert response.json()["validation"]["status"] == "ok"
    assert response.json()["validation"]["service"] == "github"
    assert "repo_read" in response.json()["validation"]["checked"]
    assert captured["url"] == "https://api.github.com/repos/Wish-Upon-A-Star/ai-board-jungle"
    assert captured["headers"]["Authorization"] == "Bearer ghp-test-token"


def test_integration_profile_validate_reports_auth_failure(monkeypatch):
    class FakeResponse:
        status_code = 401
        is_success = False
        text = '{"message":"Bad credentials"}'

        def json(self):
            return {"message": "Bad credentials"}

    monkeypatch.setattr(main_module.httpx, "get", lambda *args, **kwargs: FakeResponse())

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "validate-openai@example.com", "name": "Validate OpenAI", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        profile = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "OpenAI 검증",
                "source_kind": "custom",
                "base_url": "https://api.openai.com/v1",
                "api_provider": "OpenAI API",
                "token_name": "OPENAI_API_KEY",
                "token_value": "sk-bad",
                "ai_provider": "OpenAI",
                "ai_api_base": "https://api.openai.com/v1",
                "rag_targets": ["ai"],
            },
        ).json()["profile"]
        response = client.post(f"/api/integration-profiles/{profile['id']}/validate", headers=headers)

    validation = response.json()["validation"]
    assert response.status_code == 200
    assert validation["status"] == "failed"
    assert validation["service"] == "openai"
    assert validation["statusCode"] == 401
    assert "OpenAI API 키" in validation["hint"]
    assert "sk-bad" not in json.dumps(response.json(), ensure_ascii=False)


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


def test_github_issue_writer_preserves_notion_board_card_body():
    profile = IntegrationProfile(
        owner_id=1,
        name="GitHub issue writer",
        source_kind="github",
        base_url="https://github.com/acme/project",
        token_value="plain-github-token",
    )
    body = "\n".join(
        [
            "Notion BOARD 카드",
            "- 상태: In progress",
            "- 담당자: 정수현",
            "- 요청: 로그인 화면 구현",
            "- 원본: https://www.notion.so/card-123",
        ]
    )
    write = write_github_issue(profile, "[AI Board] 로그인 화면 구현", body, dry_run=True)
    payload = write["payload"]
    assert write["status"] == "ready"
    assert write["url"] == "https://api.github.com/repos/acme/project/issues"
    assert payload["title"] == "[AI Board] 로그인 화면 구현"
    assert payload["labels"] == ["ai-board", "automation"]
    assert "Notion BOARD 카드" in payload["body"]
    assert "상태: In progress" in payload["body"]
    assert "담당자: 정수현" in payload["body"]
    assert "plain-github-token" not in str(write)


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
    payload = status.json()
    providers = {item["provider"]: item for item in payload["providers"]}
    assert {"github", "notion", "figma", "google_calendar"} <= set(providers)
    assert providers["figma"]["missing"] == ["AI_BOARD_FIGMA_OAUTH_CLIENT_ID", "AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET"]
    assert providers["figma"]["redirectUri"].endswith("/api/oauth/figma/callback")
    assert providers["figma"]["setupUrl"] == "https://www.figma.com/developers/apps"
    assert providers["figma"]["apiProvider"] == "Figma MCP OAuth"
    assert "file_comments:write" in providers["figma"]["scope"]
    assert providers["google_calendar"]["setupUrl"] == "https://console.cloud.google.com/apis/credentials"
    assert providers["google_calendar"]["baseUrl"] == "primary"
    assert payload["publicOrigin"]["origin"].endswith("testserver")
    assert payload["publicOrigin"]["temporaryTunnel"] is False


def test_oauth_status_flags_temporary_tunnel_origin():
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "oauth-tunnel@example.com", "name": "OAuth Tunnel", "password": "password123"},
        )
        headers = {
            "Authorization": f"Bearer {register.json()['token']}",
            "x-ai-board-public-origin": "https://railway-mediterranean-snap-populations.trycloudflare.com",
        }
        status = client.get("/api/oauth/status", headers=headers)
    assert status.status_code == 200
    public_origin = status.json()["publicOrigin"]
    assert public_origin["origin"] == "https://railway-mediterranean-snap-populations.trycloudflare.com"
    assert public_origin["temporaryTunnel"] is True
    assert public_origin["risk"] == "temporary_tunnel_callback_rotation"
    assert "AI_BOARD_PUBLIC_BASE_URL" in public_origin["nextAction"]


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
    scope_values = set(params["scope"][0].replace(",", " ").split())
    assert {
        "file_content:read",
        "file_metadata:read",
        "file_versions:read",
        "file_comments:read",
        "file_comments:write",
        "current_user:read",
    } <= scope_values
    assert data["redirectUri"].endswith("/api/oauth/figma/callback")


def test_figma_oauth_start_uses_external_host_and_sanitizes_labeled_credentials(monkeypatch):
    monkeypatch.setenv("AI_BOARD_PUBLIC_BASE_URL", "https://old-stale.trycloudflare.com")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_ID", "클라이언트 ID:figma-client-clean")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET", "클라이언트 시크릿:figma-secret-clean")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "figma-oauth-host@example.com", "name": "Figma OAuth Host", "password": "password123"},
        )
        headers = {
            "Authorization": f"Bearer {register.json()['token']}",
            "x-ai-board-public-origin": "https://railway-mediterranean-snap-populations.trycloudflare.com",
            "host": "127.0.0.1:8000",
            "x-forwarded-proto": "https",
        }
        response = client.get("/api/oauth/figma/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorizeUrl"])
    params = parse_qs(parsed.query)
    assert params["client_id"] == ["figma-client-clean"]
    assert params["redirect_uri"] == ["https://railway-mediterranean-snap-populations.trycloudflare.com/api/oauth/figma/callback"]
    assert data["redirectUri"] == "https://railway-mediterranean-snap-populations.trycloudflare.com/api/oauth/figma/callback"
    assert "old-stale" not in data["authorizeUrl"]
    assert "클라이언트" not in data["authorizeUrl"]


def test_figma_oauth_start_prefers_registered_redirect_override(monkeypatch):
    monkeypatch.setenv("AI_BOARD_PUBLIC_BASE_URL", "https://old-stale.trycloudflare.com")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_REDIRECT_URI", "https://fixed.example.com/api/oauth/figma/callback")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_ID", "figma-client")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET", "figma-secret")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "figma-oauth-override@example.com", "name": "Figma OAuth Override", "password": "password123"},
        )
        headers = {
            "Authorization": f"Bearer {register.json()['token']}",
            "x-ai-board-public-origin": "https://railway-mediterranean-snap-populations.trycloudflare.com",
            "host": "127.0.0.1:8000",
        }
        response = client.get("/api/oauth/figma/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorizeUrl"])
    params = parse_qs(parsed.query)
    assert params["redirect_uri"] == ["https://fixed.example.com/api/oauth/figma/callback"]
    assert data["redirectUri"] == "https://fixed.example.com/api/oauth/figma/callback"


def test_figma_oauth_start_provider_override_wins_over_saved_public_base(monkeypatch):
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_REDIRECT_URI", "https://figma-fixed.example.com/api/oauth/figma/callback")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_ID", "figma-client")
    monkeypatch.setenv("AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET", "figma-secret")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "figma-oauth-db-override@example.com", "name": "Figma DB Override", "password": "password123"},
        )
        headers = {
            "Authorization": f"Bearer {register.json()['token']}",
            "x-ai-board-public-origin": "https://temporary.trycloudflare.com",
            "host": "127.0.0.1:8000",
        }
        with SessionLocal() as db:
            setting = db.get(SystemSetting, "public_base_url") or SystemSetting(key="public_base_url")
            setting.value = "https://database.example.test"
            db.add(setting)
            db.commit()
        try:
            response = client.get("/api/oauth/figma/start", headers=headers)
            assert response.status_code == 200
            data = response.json()
            params = parse_qs(urlparse(data["authorizeUrl"]).query)
            assert params["redirect_uri"] == ["https://figma-fixed.example.com/api/oauth/figma/callback"]
            assert data["redirectUri"] == "https://figma-fixed.example.com/api/oauth/figma/callback"
            assert data["redirectUriSource"] == "provider_override"

            status = client.get("/api/oauth/status", headers=headers)
            assert status.status_code == 200
            providers = {item["provider"]: item for item in status.json()["providers"]}
            assert providers["figma"]["redirectUri"] == "https://figma-fixed.example.com/api/oauth/figma/callback"
            assert providers["figma"]["redirectUriSource"] == "provider_override"
        finally:
            with SessionLocal() as db:
                setting = db.get(SystemSetting, "public_base_url")
                if setting:
                    db.delete(setting)
                    db.commit()


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


def test_google_calendar_oauth_start_uses_external_origin_and_sanitizes_labeled_credentials(monkeypatch):
    monkeypatch.setenv("AI_BOARD_PUBLIC_BASE_URL", "https://old-stale.trycloudflare.com")
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_ID", "클라이언트 ID:google-client-clean.apps.googleusercontent.com")
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET", "클라이언트 보안 비밀번호:google-secret-clean")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "google-oauth-host@example.com", "name": "Google OAuth Host", "password": "password123"},
        )
        headers = {
            "Authorization": f"Bearer {register.json()['token']}",
            "x-ai-board-public-origin": "https://railway-mediterranean-snap-populations.trycloudflare.com",
            "host": "127.0.0.1:8000",
        }
        response = client.get("/api/oauth/google_calendar/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorizeUrl"])
    params = parse_qs(parsed.query)
    assert params["client_id"] == ["google-client-clean.apps.googleusercontent.com"]
    assert params["redirect_uri"] == ["https://railway-mediterranean-snap-populations.trycloudflare.com/api/oauth/google_calendar/callback"]
    assert data["redirectUri"] == "https://railway-mediterranean-snap-populations.trycloudflare.com/api/oauth/google_calendar/callback"
    assert "old-stale" not in data["authorizeUrl"]
    assert "클라이언트" not in data["authorizeUrl"]


def test_google_calendar_oauth_start_prefers_registered_redirect_override(monkeypatch):
    monkeypatch.setenv("AI_BOARD_PUBLIC_BASE_URL", "https://old-stale.trycloudflare.com")
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_REDIRECT_URI", "https://fixed.example.com/api/oauth/google_calendar/callback")
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_ID", "google-client.apps.googleusercontent.com")
    monkeypatch.setenv("AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET", "google-secret")
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "google-oauth-override@example.com", "name": "Google OAuth Override", "password": "password123"},
        )
        headers = {
            "Authorization": f"Bearer {register.json()['token']}",
            "x-ai-board-public-origin": "https://railway-mediterranean-snap-populations.trycloudflare.com",
            "host": "127.0.0.1:8000",
        }
        response = client.get("/api/oauth/google_calendar/start", headers=headers)
    assert response.status_code == 200
    data = response.json()
    parsed = urlparse(data["authorizeUrl"])
    params = parse_qs(parsed.query)
    assert params["redirect_uri"] == ["https://fixed.example.com/api/oauth/google_calendar/callback"]
    assert data["redirectUri"] == "https://fixed.example.com/api/oauth/google_calendar/callback"


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
    rendered_text = collect_block_text(blocks)
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
    assert len(calls) == 1
    assert all(len(call["children"]) <= 100 for call in calls)
    assert find_first_block(calls[0]["children"], "column_list") is not None
    assert find_first_block(calls[0]["children"], "toggle") is not None
    assert find_first_block(calls[0]["children"], "table") is not None


def test_notion_sources_report_writes_kanban_database_cards(monkeypatch):
    created_pages = []

    class Response:
        status_code = 200
        headers = {"content-type": "application/json"}
        is_success = True
        text = "{}"

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    database_payload = {
        "id": "3797051c2f9981e882f0e9ed7da544a1",
        "properties": {
            "title": {"type": "title", "title": {}},
            "상태": {
                "type": "select",
                "select": {"options": [{"name": "Not started"}, {"name": "In progress"}, {"name": "Done"}, {"name": "Blocked"}]},
            },
            "유형": {
                "type": "select",
                "select": {"options": [{"name": "github_commit"}, {"name": "github_issue"}, {"name": "notion_change"}, {"name": "automation_report"}]},
            },
            "한국어 요약": {"type": "rich_text", "rich_text": {}},
            "영향 영역": {
                "type": "multi_select",
                "multi_select": {"options": [{"name": "BOARD"}, {"name": "PAGES"}, {"name": "GANTT"}]},
            },
            "다음 조치": {"type": "rich_text", "rich_text": {}},
            "링크": {"type": "url", "url": {}},
            "자동화 실행": {"type": "number", "number": {}},
        },
    }

    def fake_get(url, headers=None, timeout=15.0):
        return Response(database_payload)

    def fake_post(url, headers=None, json=None, timeout=15.0):
        created_pages.append(json)
        return Response({"id": f"page-{len(created_pages)}", "url": f"https://notion.test/page-{len(created_pages)}"})

    monkeypatch.setattr("app.live_writers.httpx.get", fake_get)
    monkeypatch.setattr("app.live_writers.httpx.post", fake_post)
    profile = IntegrationProfile(
        owner_id=1,
        name="Kanban Notion",
        source_kind="notion",
        base_url="https://app.notion.com/p/3797051c2f9981e882f0e9ed7da544a1",
        token_value="plain-notion-database-token",
    )

    write = write_notion_sources_report(
        profile,
        "칸반 보고",
        [
            {
                "title": "Commit abc123: Add OAuth login",
                "sourceType": "github_commit",
                "url": "https://github.com/acme/repo/commit/abc123",
                "summary": "author: User sha: abc123 date: 2026-06-09",
            },
            {
                "title": "Issue #7: failed sync",
                "sourceType": "github_issue",
                "url": "https://github.com/acme/repo/issues/7",
                "summary": "state: open error: Notion write failed",
            },
        ],
        "요청 제목: {title}\n요약: {summary}",
        dry_run=False,
    )

    assert write["status"] == "written"
    assert write["target"] == "database"
    assert write["format"] == "kanban-database-cards"
    assert len(created_pages) == 2
    first = created_pages[0]["properties"]
    second = created_pages[1]["properties"]
    assert created_pages[0]["parent"] == {"database_id": "3797051c2f9981e882f0e9ed7da544a1"}
    assert first["상태"]["select"]["name"] == "Not started"
    assert first["유형"]["select"]["name"] == "github_commit"
    assert first["영향 영역"]["multi_select"] == [{"name": "BOARD"}, {"name": "PAGES"}, {"name": "GANTT"}]
    assert "OAuth login" in first["한국어 요약"]["rich_text"][0]["text"]["content"]
    assert len(first["title"]["title"][0]["text"]["content"]) <= 95
    assert first["링크"]["url"] == "https://github.com/acme/repo/commit/abc123"
    assert second["상태"]["select"]["name"] == "Blocked"
    assert find_first_block(created_pages[0]["children"], "table") is not None
    full_text = collect_block_text(created_pages[0]["children"])
    assert "전체 제목" in full_text
    assert "Commit abc123: Add OAuth login" in full_text
    assert "한국어 요약" in full_text
    assert "??" not in full_text


def test_notion_sources_report_resolves_existing_board_database_inside_page(monkeypatch):
    created_pages = []
    calls = []
    page_id = "3797051c2f998088994ee86e76ec7e35"
    board_id = "37a7051c2f9981e882f0e9ed7da544a1"

    class Response:
        headers = {"content-type": "application/json"}
        text = "{}"

        def __init__(self, status_code, payload):
            self.status_code = status_code
            self.payload = payload
            self.is_success = 200 <= status_code < 300
            self.text = json.dumps(payload)

        def json(self):
            return self.payload

    database_payload = {
        "id": board_id,
        "properties": {
            "title": {"type": "title", "title": {}},
            "상태": {"type": "status", "status": {"options": [{"name": "Not started 🧱"}, {"name": "In progress 🛠"}, {"name": "Done🏠"}]}},
            "유형": {"type": "select", "select": {"options": [{"name": "github_commit"}, {"name": "github_issue"}]}},
            "한국어 요약": {"type": "rich_text", "rich_text": {}},
        },
    }

    def fake_get(url, headers=None, params=None, timeout=15.0):
        calls.append(("GET", url, params))
        if f"/v1/databases/{page_id}" in url:
            return Response(404, {"object": "error", "message": "page, not database"})
        if f"/v1/blocks/{page_id}/children" in url:
            return Response(
                200,
                {
                    "results": [
                        {"id": "column-list-1", "type": "column_list", "has_children": True, "column_list": {}},
                        {"id": board_id, "type": "child_database", "has_children": False, "child_database": {"title": "BOARD"}},
                    ],
                    "has_more": False,
                },
            )
        if f"/v1/databases/{board_id}" in url:
            return Response(200, database_payload)
        return Response(404, {"object": "error"})

    def fake_post(url, headers=None, json=None, timeout=15.0):
        created_pages.append(json)
        return Response(200, {"id": "created-card", "url": "https://notion.test/created-card"})

    monkeypatch.setattr("app.live_writers.httpx.get", fake_get)
    monkeypatch.setattr("app.live_writers.httpx.post", fake_post)
    profile = IntegrationProfile(
        owner_id=1,
        name="Original Template Page",
        source_kind="notion",
        base_url=f"https://app.notion.com/p/302-1-2-{page_id}",
        token_value="plain-notion-page-token",
    )

    write = write_notion_sources_report(
        profile,
        "원본 템플릿 보드 보고",
        [{"title": "Commit abc123: Preserve board", "sourceType": "github_commit", "url": "https://github.com/acme/repo/commit/abc123", "summary": ""}],
        "요청 제목: {title}",
        dry_run=False,
    )

    assert write["status"] == "written"
    assert write["target"] == "database"
    assert write["resolvedFrom"] == "page_child_database"
    assert write["sourcePageId"] == page_id
    assert created_pages[0]["parent"] == {"database_id": board_id}
    assert created_pages[0]["properties"]["상태"]["status"]["name"] == "Not started 🧱"


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
    table = find_first_block(blocks, "table")
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
    table = find_first_block(blocks, "table")
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
    table = find_first_block(blocks, "table")
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
    table = find_first_block(blocks, "table")
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
    table = find_first_block(blocks, "table")
    row = table["table"]["children"][1]["table_row"]["cells"]
    values = [cell[0]["text"]["content"] for cell in row]
    assert values[3].startswith("라이브 서버 재시작 시 바탕화면의 GitHub, Notion, Figma, Google OAuth 설정")
    assert values[4] == "BOARD/PAGES/GANTT"
    assert values[5] == "요청 템플릿 기준으로 검토"
    assert values[4] != "보통"


def test_notion_sources_report_preserves_board_pages_gantt_template_columns():
    blocks = notion_sources_template_children(
        "GitHub -> Notion BOARD/GANTT 보고",
        [
            {
                "title": "[GitHub MCP OAuth profile] Commit 45c0582d24cf: Verify scheduler skips unchanged live writes",
                "sourceType": "github_commit",
                "url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle/commit/45c0582d24cf",
                "summary": "Verify scheduler skips unchanged live writes sha: 45c0582d24cf author: Wish-Upon-A-Star",
            }
        ],
        "| 번호 | 유형 | 제목 | 한국어 요약 | 영향 영역 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|",
    )
    text = collect_block_text(blocks)
    table = find_first_block(blocks, "table")
    row = table["table"]["children"][1]["table_row"]["cells"]
    values = [cell[0]["text"]["content"] for cell in row]
    assert "BOARD / PAGES / GANTT CHART" in text
    assert values[1] == "github_commit"
    assert "Verify scheduler skips unchanged live writes" in values[2]
    assert values[4] == "BOARD/PAGES/GANTT"
    assert values[5] == "요청 템플릿 기준으로 검토"
    assert values[6].endswith("/45c0582d24cf")


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
    table = find_first_block(blocks, "table")
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


def test_admin_system_public_base_url_overrides_oauth_origin(monkeypatch):
    monkeypatch.setenv("AI_BOARD_PUBLIC_BASE_URL", "https://env.example.test")
    monkeypatch.setenv("AI_BOARD_GITHUB_OAUTH_CLIENT_ID", "github-client")
    monkeypatch.setenv("AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET", "github-secret")
    with TestClient(app) as client:
        admin_register = client.post(
            "/api/auth/register",
            json={"email": "system-admin@example.com", "name": "System Admin", "password": "password123"},
        )
        assert admin_register.status_code == 200
        with SessionLocal() as db:
            admin_user = db.query(User).filter(User.email == "system-admin@example.com").first()
            admin_user.role = "ADMIN"
            db.commit()
        admin_login = client.post("/api/auth/login", json={"email": "system-admin@example.com", "password": "password123"})
        assert admin_login.status_code == 200
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['token']}"}
        user_register = client.post(
            "/api/auth/register",
            json={"email": "system-setting-user@example.com", "name": "System User", "password": "password123"},
        )
        user_headers = {"Authorization": f"Bearer {user_register.json()['token']}"}

        forbidden = client.put(
            "/api/system/settings",
            headers=user_headers,
            json={"public_base_url": "https://user.example.test"},
        )
        assert forbidden.status_code == 403

        saved = client.put(
            "/api/system/settings",
            headers=admin_headers,
            json={"public_base_url": "https://stable.example.test/"},
        )
        assert saved.status_code == 200
        assert saved.json()["systemSettings"]["publicBaseUrl"] == "https://stable.example.test"
        assert saved.json()["systemSettings"]["source"] == "database"

        status = client.get(
            "/api/oauth/status",
            headers={**admin_headers, "x-ai-board-public-origin": "https://temporary.trycloudflare.com"},
        )
        assert status.status_code == 200
        assert status.json()["publicOrigin"]["origin"] == "https://stable.example.test"
        assert status.json()["publicOrigin"]["configuredPublicBaseUrlSource"] == "database"

        response = client.get(
            "/api/oauth/github/start",
            headers={**admin_headers, "x-ai-board-public-origin": "https://temporary.trycloudflare.com"},
        )
        assert response.status_code == 200
        params = parse_qs(urlparse(response.json()["authorizeUrl"]).query)
        assert params["redirect_uri"] == ["https://stable.example.test/api/oauth/github/callback"]

        cleanup = client.put(
            "/api/system/settings",
            headers=admin_headers,
            json={"public_base_url": ""},
        )
        assert cleanup.status_code == 200


def test_webhook_readiness_lists_public_endpoints_without_secret_values(monkeypatch):
    monkeypatch.setenv("AI_BOARD_GITHUB_WEBHOOK_SECRET", "github-secret-value")
    monkeypatch.setenv("AI_BOARD_NOTION_WEBHOOK_SECRET", "")
    settings.cache_clear()
    with TestClient(app) as client:
        try:
            register = client.post(
                "/api/auth/register",
                json={"email": "webhook-readiness@example.com", "name": "Webhook Readiness", "password": "password123"},
            )
            headers = {
                "Authorization": f"Bearer {register.json()['token']}",
                "x-forwarded-proto": "https",
                "x-forwarded-host": "hooks.example.test",
                "host": "hooks.example.test",
            }
            response = client.get("/api/webhook-readiness", headers=headers)
        finally:
            settings.cache_clear()
    assert response.status_code == 200
    data = response.json()
    webhooks = {item["provider"]: item for item in data["webhooks"]}
    assert webhooks["github"]["endpoint"] == "https://hooks.example.test/api/webhooks/github"
    assert webhooks["github"]["signatureHeader"] == "X-Hub-Signature-256"
    assert webhooks["github"]["secretEnv"] == "AI_BOARD_GITHUB_WEBHOOK_SECRET"
    assert webhooks["github"]["secretConfigured"] is True
    assert "github-secret-value" not in json.dumps(data)
    assert webhooks["notion"]["endpoint"] == "https://hooks.example.test/api/webhooks/notion"
    assert webhooks["notion"]["signatureHeader"] == "X-AI-Board-Signature"
    assert webhooks["notion"]["secretConfigured"] is False
    assert "GitHub → Notion" in webhooks["github"]["usedByTemplates"]
    assert "Notion BOARD → GitHub Issue" in webhooks["notion"]["usedByTemplates"]


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
        board_page = client.get("/api/posts?kind=board&limit=20&offset=0").json()
        assert any(item["id"] == post_id for item in board_page["posts"])
        automation_page_before_share = client.get("/api/posts?kind=automation&limit=20&offset=0").json()
        assert all(item["id"] != post_id for item in automation_page_before_share["posts"])
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
        shared_response = client.post(f"/api/automations/{task_id}/share", headers=headers)
        assert shared_response.status_code == 200
        shared_post_id = shared_response.json()["post"]["id"]
        board_page_after_share = client.get("/api/posts?kind=board&limit=20&offset=0").json()
        automation_page_after_share = client.get("/api/posts?kind=automation&limit=20&offset=0").json()
        assert any(item["id"] == post_id for item in board_page_after_share["posts"])
        assert any(item["id"] == shared_post_id for item in automation_page_after_share["posts"])
        assert all(item["id"] != shared_post_id for item in board_page_after_share["posts"])
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


def test_notion_gantt_automation_creates_calendar_events(monkeypatch):
    collected = [
        CollectedItem(
            title="로그인 화면 구현",
            source_type="notion_database_page",
            url="https://notion.test/gantt/login",
            text=json.dumps(
                {
                    "이름": {"type": "title", "title": [{"plain_text": "로그인 화면 구현"}]},
                    "날짜": {"type": "date", "date": {"start": "2026-06-10", "end": "2026-06-12", "time_zone": None}},
                    "상태": {"type": "status", "status": {"name": "Not started"}},
                },
                ensure_ascii=False,
            ),
            tags=["notion", "database"],
        ),
        CollectedItem(
            title="디자인 작업",
            source_type="notion_database_page",
            url="https://notion.test/gantt/design",
            text=json.dumps(
                {
                    "이름": {"type": "title", "title": [{"plain_text": "디자인 작업"}]},
                    "날짜": {"type": "date", "date": {"start": "2026-06-13", "end": None, "time_zone": None}},
                    "상태": {"type": "status", "status": {"name": "In progress"}},
                },
                ensure_ascii=False,
            ),
            tags=["notion", "database"],
        ),
    ]
    calendar_events = []

    def fake_collect(profile, limit=20, pages=2):
        return collected, []

    def fake_write_calendar_event_at(profile, title, body, start_date, end_date="", dry_run=True, target_url=None):
        calendar_events.append(
            {
                "profile": profile.name,
                "title": title,
                "body": body,
                "start": start_date,
                "end": end_date,
                "target": target_url,
                "dryRun": dry_run,
            }
        )
        return {"service": "google_calendar", "status": "written", "id": f"event-{len(calendar_events)}", "url": "https://calendar.test/event", "dryRun": dry_run}

    monkeypatch.setattr("app.main.collect_profile_items", fake_collect)
    monkeypatch.setattr("app.main.write_calendar_event_at", fake_write_calendar_event_at)
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "gantt-calendar@example.com", "name": "Gantt Calendar", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        notion = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Template GANTT",
                "source_kind": "notion",
                "base_url": "35f7051c2f9982d6a3bf813799fc400b",
                "api_provider": "Notion API",
                "token_name": "NOTION_TOKEN",
                "token_value": "notion-token",
                "rag_targets": ["notion_database"],
            },
        ).json()["profile"]
        client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Team Calendar",
                "source_kind": "google_calendar",
                "base_url": "primary",
                "api_provider": "Google Calendar API",
                "token_name": "GOOGLE_CALENDAR_TOKEN",
                "token_value": "calendar-token",
                "rag_targets": [],
            },
        )
        task = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Notion GANTT to Calendar",
                "integration_profile_id": notion["id"],
                "source": "Notion GANTT",
                "destination": "Google Calendar",
                "interval_minutes": 10,
                "instruction": "Create calendar events from GANTT rows with dates.",
                "template": "GANTT 날짜를 Calendar 일정으로 생성",
                "api_provider": "Notion API + Google Calendar API",
                "ai_agent": "GanttCalendarAgent",
                "custom_connections": [
                    {
                        "label": "Google Calendar",
                        "service": "google_calendar",
                        "url": "primary",
                        "api": "Google Calendar API",
                        "auth_key_name": "GOOGLE_CALENDAR_TOKEN",
                        "operation": "create_events_from_notion_gantt",
                        "template": "일정 제목: {title}\n날짜: {date}\n상태: {status}",
                    }
                ],
            },
        ).json()["task"]
        run = client.post(f"/api/automations/{task['id']}/run", headers=headers)
    assert run.status_code == 200
    write = run.json()["run"]["result"]["liveWrites"][0]
    assert write["service"] == "google_calendar"
    assert write["operation"] == "create_events_from_notion_gantt"
    assert write["count"] == 2
    assert [event["title"] for event in calendar_events] == ["로그인 화면 구현", "디자인 작업"]
    assert calendar_events[0]["start"] == "2026-06-10"
    assert calendar_events[0]["end"] == "2026-06-12"
    assert calendar_events[1]["start"] == "2026-06-13"
    assert calendar_events[1]["target"] == "primary"


def test_notion_read_connection_does_not_write_back_to_notion(monkeypatch):
    collected = [
        CollectedItem(
            title="운영 안정성 보강",
            source_type="notion_database_page",
            url="https://notion.test/board/risk",
            text="DB lock 또는 queue가 필요합니다.",
            tags=["notion", "board"],
        )
    ]
    writes = []

    def fake_collect(profile, limit=20, pages=2):
        return collected, []

    def fail_notion_write(*args, **kwargs):
        raise AssertionError("read-only Notion connection must not be treated as a live write")

    def fake_execute_profile_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
        writes.append({"service": profile.source_kind, "title": title, "body": body, "dryRun": dry_run})
        return {"service": profile.source_kind, "status": "written", "url": "https://github.test/issues/1", "dryRun": dry_run}

    monkeypatch.setattr("app.main.collect_profile_items", fake_collect)
    monkeypatch.setattr("app.main.write_notion_sources_report", fail_notion_write)
    monkeypatch.setattr("app.main.execute_profile_write", fake_execute_profile_write)
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "notion-read-to-github@example.com", "name": "Notion Read", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {register.json()['token']}"}
        notion = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Template BOARD",
                "source_kind": "notion",
                "base_url": "4487051c2f9983488ed9018bbe475822",
                "api_provider": "Notion API",
                "token_name": "NOTION_TOKEN",
                "token_value": "notion-token",
                "rag_targets": ["notion_database"],
            },
        ).json()["profile"]
        client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Team GitHub",
                "source_kind": "github",
                "base_url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
                "api_provider": "GitHub REST API",
                "token_name": "GITHUB_TOKEN",
                "token_value": "github-token",
                "rag_targets": [],
            },
        )
        task = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Notion BOARD to GitHub",
                "integration_profile_id": notion["id"],
                "source": "Notion BOARD",
                "destination": "GitHub Issues",
                "interval_minutes": 10,
                "instruction": "Create GitHub issues from Notion BOARD cards.",
                "template": "Notion 카드: {title}",
                "api_provider": "Notion API + GitHub API",
                "ai_agent": "NotionIssueAgent",
                "custom_connections": [
                    {
                        "label": "Notion BOARD read",
                        "service": "notion",
                        "url": "4487051c2f9983488ed9018bbe475822",
                        "api": "Notion API",
                        "auth_key_name": "NOTION_TOKEN",
                        "operation": "read_board_cards_since_last_run",
                        "template": "카드 제목: {title}",
                    },
                    {
                        "label": "GitHub issue",
                        "service": "github",
                        "url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
                        "api": "GitHub REST API",
                        "auth_key_name": "GITHUB_TOKEN",
                        "operation": "issue_create_or_update",
                        "template": "제목: [Notion] {title}",
                    },
                ],
            },
        ).json()["task"]
        run = client.post(f"/api/automations/{task['id']}/run", headers=headers)
    assert run.status_code == 200
    live_writes = run.json()["run"]["result"]["liveWrites"]
    assert [write["service"] for write in live_writes] == ["github"]
    assert writes and writes[0]["service"] == "github"


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


def test_scheduler_unchanged_input_skips_summary_and_live_writes(monkeypatch):
    counters = {"collect": 0, "summary": 0, "notion_write": 0, "generic_write": 0}

    def fake_collect(profile, limit=20, pages=2):
        counters["collect"] += 1
        return [
            CollectedItem(
                title="Commit abc123: Scheduler skip guard",
                source_type="github_commit",
                url="https://github.com/example/repo/commit/abc123",
                text="동일 커밋은 두 번째 스케줄 실행에서 다시 쓰지 않아야 합니다.",
                tags=["github", "commit"],
            )
        ], []

    def fake_summarize(title, content):
        counters["summary"] += 1
        return f"요약: {title}"

    def fake_write_notion_sources_report(profile, title, sources, template, dry_run=True, target_url=None):
        counters["notion_write"] += 1
        return {"service": "notion", "status": "written", "count": len(sources), "dryRun": dry_run}

    def fake_execute_profile_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
        counters["generic_write"] += 1
        return {"service": profile.source_kind, "status": "written", "dryRun": dry_run}

    monkeypatch.setattr("app.main.collect_profile_items", fake_collect)
    monkeypatch.setattr("app.main.summarize", fake_summarize)
    monkeypatch.setattr("app.main.write_notion_sources_report", fake_write_notion_sources_report)
    monkeypatch.setattr("app.main.execute_profile_write", fake_execute_profile_write)

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "scheduler-skip@example.com", "name": "Scheduler Skip", "password": "password123"},
        )
        assert register.status_code == 200
        headers = {"Authorization": f"Bearer {register.json()['token']}"}

        github = client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Scheduler GitHub",
                "source_kind": "github",
                "base_url": "https://github.com/example/repo",
                "api_provider": "GitHub API",
                "token_name": "GITHUB_TOKEN",
                "token_value": "github-secret",
                "rag_targets": ["commits"],
            },
        ).json()["profile"]
        client.post(
            "/api/integration-profiles",
            headers=headers,
            json={
                "name": "Scheduler Notion",
                "source_kind": "notion",
                "base_url": "3797051c2f998094b2a5e5062d353881",
                "api_provider": "Notion API",
                "token_name": "NOTION_TOKEN",
                "token_value": "notion-secret",
                "rag_targets": [],
            },
        )
        automation = client.post(
            "/api/automations",
            headers=headers,
            json={
                "name": "Scheduler unchanged skip guard",
                "integration_profile_id": github["id"],
                "source": "GitHub",
                "destination": "Notion",
                "interval_minutes": 1,
                "instruction": "Only write when collected GitHub input changes.",
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

        first_tick = client.post("/api/automations/scheduler/tick", headers=headers)
        assert first_tick.status_code == 200
        assert first_tick.json()["results"][0]["status"] == "changed"
        assert counters == {"collect": 1, "summary": 1, "notion_write": 1, "generic_write": 0}

        with SessionLocal() as db:
            stored_task = db.get(AutomationTask, task_id)
            assert stored_task is not None
            stored_task.last_run_at = datetime.now(timezone.utc) - timedelta(minutes=2)
            db.commit()

        second_tick = client.post("/api/automations/scheduler/tick", headers=headers)
        assert second_tick.status_code == 200
        assert second_tick.json()["results"][0]["status"] == "skipped"
        assert second_tick.json()["results"][0]["runId"] is None
        assert counters == {"collect": 2, "summary": 1, "notion_write": 1, "generic_write": 0}

        skipped_activities = client.get("/api/integration-activities?event_type=automation.run&status=skipped", headers=headers).json()["activities"]
        assert skipped_activities
        assert "no watched input changes" in skipped_activities[0]["summary"]


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
    filtered = korean_summary_for_source(
        {
            "source_type": "github_commit",
            "title": "[GitHub MCP OAuth profile] Commit 28ff25212345: Filter automation generated GitHub issues",
            "summary": "author: Wish-Upon-A-Star sha: 28ff25212345",
        }
    )
    assert "자기 자신이 만든 GitHub 이슈와 댓글" in filtered


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


def test_repeated_github_webhook_payload_skips_duplicate_notion_write(monkeypatch):
    monkeypatch.setenv("AI_BOARD_GITHUB_WEBHOOK_SECRET", "hook-secret")
    settings.cache_clear()
    notion_tables = []

    def no_live_collect(profile, limit=20, pages=2):
        return [], ["webhook payload should be enough"]

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

    monkeypatch.setattr("app.main.collect_profile_items", no_live_collect)
    monkeypatch.setattr("app.main.write_notion_sources_report", fake_write_notion_sources_report)
    try:
        with TestClient(app) as client:
            register = client.post(
                "/api/auth/register",
                json={"email": "webhook-repeat@example.com", "name": "Webhook Repeat User", "password": "password123"},
            )
            headers = {"Authorization": f"Bearer {register.json()['token']}"}
            github = client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Repeat Webhook GitHub",
                    "source_kind": "github",
                    "base_url": "https://github.com/Wish-Upon-A-Star/repeat-hook",
                    "api_provider": "GitHub REST API",
                    "token_name": "GITHUB_TOKEN",
                    "token_value": "github_repeat_token",
                    "rag_targets": ["commits"],
                },
            ).json()["profile"]
            client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Repeat Webhook Notion",
                    "source_kind": "notion",
                    "base_url": "https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8",
                    "api_provider": "Notion API",
                    "token_name": "NOTION_TOKEN",
                    "token_value": "notion_repeat_token",
                    "rag_targets": ["notion_pages"],
                },
            )
            task = client.post(
                "/api/automations",
                headers=headers,
                json={
                    "name": "Repeat GitHub webhook to Notion",
                    "integration_profile_id": github["id"],
                    "source": "GitHub Push",
                    "destination": "Small Notion Page",
                    "interval_minutes": 5,
                    "instruction": "Append GitHub push commit summaries to Notion only when input changes.",
                    "template": "commit / author / link / next action",
                    "api_provider": "GitHub webhook + Notion API",
                    "ai_agent": "WebhookCommitAgent",
                    "template_preset": "github_notion",
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
                        "full_name": "Wish-Upon-A-Star/repeat-hook",
                        "html_url": "https://github.com/Wish-Upon-A-Star/repeat-hook",
                    },
                    "commits": [
                        {
                            "id": "1111111111111111111111111111111111111111",
                            "message": "Repeat webhook should write once",
                            "url": "https://github.com/Wish-Upon-A-Star/repeat-hook/commit/1111111",
                            "author": {"name": "Codex"},
                        }
                    ],
                }
            ).encode()
            signature = "sha256=" + hmac.new(b"hook-secret", payload, hashlib.sha256).hexdigest()
            first = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={"X-Hub-Signature-256": signature, "X-GitHub-Event": "push"},
            )
            second = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={"X-Hub-Signature-256": signature, "X-GitHub-Event": "push"},
            )

            assert first.status_code == 200
            assert second.status_code == 200
            assert first.json()["triggered"][0]["taskId"] == task["id"]
            assert first.json()["triggered"][0]["status"] == "changed"
            assert second.json()["triggered"][0]["taskId"] == task["id"]
            assert second.json()["triggered"][0]["status"] == "skipped"
            assert len(notion_tables) == 1
            assert notion_tables[0]["sources"][0]["title"].startswith("[Repeat Webhook GitHub] Webhook commit 111111111111")
            activities = client.get("/api/integration-activities?event_type=automation.live_write", headers=headers).json()["activities"]
            assert len([item for item in activities if item["automationTaskId"] == task["id"]]) == 1
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


def test_repeated_notion_webhook_payload_skips_duplicate_github_issue_write(monkeypatch):
    monkeypatch.setenv("AI_BOARD_NOTION_WEBHOOK_SECRET", "notion-hook-secret")
    settings.cache_clear()
    writes = []
    notion_database_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    notion_database_uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

    def fake_collect(profile, limit=20, pages=2):
        return [
            CollectedItem(
                title="반복 Notion 카드",
                source_type="notion_database_page",
                url="https://www.notion.so/workspace/repeat-card",
                text="같은 Notion 변경 이벤트는 GitHub 이슈를 한 번만 만들어야 합니다.",
                tags=["notion", "board"],
            )
        ], []

    def fail_notion_write(*args, **kwargs):
        raise AssertionError("Notion source -> GitHub issue automation must not write back to Notion")

    def fake_execute_profile_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
        writes.append({"service": profile.source_kind, "title": title, "body": body, "dryRun": dry_run})
        return {"service": profile.source_kind, "status": "written", "url": "https://github.test/issues/99", "dryRun": dry_run}

    monkeypatch.setattr("app.main.collect_profile_items", fake_collect)
    monkeypatch.setattr("app.main.write_notion_sources_report", fail_notion_write)
    monkeypatch.setattr("app.main.execute_profile_write", fake_execute_profile_write)
    try:
        with TestClient(app) as client:
            register = client.post(
                "/api/auth/register",
                json={"email": "notion-repeat-webhook@example.com", "name": "Notion Repeat Webhook", "password": "password123"},
            )
            headers = {"Authorization": f"Bearer {register.json()['token']}"}
            notion = client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Repeat Notion BOARD",
                    "source_kind": "notion",
                    "base_url": notion_database_id,
                    "api_provider": "Notion API",
                    "token_name": "NOTION_TOKEN",
                    "token_value": "notion-repeat-token",
                    "rag_targets": ["notion_database"],
                },
            ).json()["profile"]
            client.post(
                "/api/integration-profiles",
                headers=headers,
                json={
                    "name": "Repeat GitHub Target",
                    "source_kind": "github",
                    "base_url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
                    "api_provider": "GitHub REST API",
                    "token_name": "GITHUB_TOKEN",
                    "token_value": "github-repeat-token",
                    "rag_targets": [],
                },
            )
            task = client.post(
                "/api/automations",
                headers=headers,
                json={
                    "name": "Repeat Notion webhook to GitHub",
                    "integration_profile_id": notion["id"],
                    "source": "Notion BOARD",
                    "destination": "GitHub Issues",
                    "interval_minutes": 10,
                    "instruction": "Create or update GitHub issues from Notion BOARD cards only when Notion changes.",
                    "template": "Notion 카드: {title}\n요약: {summary}",
                    "api_provider": "Notion webhook + GitHub API",
                    "ai_agent": "NotionIssueAgent",
                    "notion_database_url": notion_database_id,
                    "template_preset": "team_notion_board_to_github",
                    "custom_connections": [
                        {
                            "label": "Notion BOARD read",
                            "service": "notion",
                            "url": notion_database_id,
                            "api": "Notion API",
                            "auth_key_name": "NOTION_TOKEN",
                            "operation": "read_board_cards_since_last_run",
                            "template": "카드 제목: {title}",
                        },
                        {
                            "label": "GitHub issue",
                            "service": "github",
                            "url": "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
                            "api": "GitHub REST API",
                            "auth_key_name": "GITHUB_TOKEN",
                            "operation": "issue_create_or_update",
                            "template": "제목: [Notion] {title}\n본문: {summary}\n원본: {source_url}",
                        },
                    ],
                },
            ).json()["task"]
            payload = json.dumps({"data": {"parent": {"id": notion_database_uuid}}}).encode()
            signature = "sha256=" + hmac.new(b"notion-hook-secret", payload, hashlib.sha256).hexdigest()
            first = client.post("/api/webhooks/notion", content=payload, headers={"X-AI-Board-Signature": signature})
            second = client.post("/api/webhooks/notion", content=payload, headers={"X-AI-Board-Signature": signature})
            changed_payload = json.dumps({
                "data": {
                    "parent": {"id": notion_database_uuid},
                    "page": {"id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"},
                    "last_edited_time": "2026-06-12T03:00:00.000Z",
                }
            }).encode()
            changed_signature = "sha256=" + hmac.new(b"notion-hook-secret", changed_payload, hashlib.sha256).hexdigest()
            third = client.post("/api/webhooks/notion", content=changed_payload, headers={"X-AI-Board-Signature": changed_signature})

            assert first.status_code == 200
            assert second.status_code == 200
            assert third.status_code == 200
            first_result = next(item for item in first.json()["triggered"] if item["taskId"] == task["id"])
            second_result = next(item for item in second.json()["triggered"] if item["taskId"] == task["id"])
            third_result = next(item for item in third.json()["triggered"] if item["taskId"] == task["id"])
            assert first_result["status"] == "changed"
            assert first_result["runId"]
            assert second_result["status"] == "skipped"
            assert second_result["runId"] is None
            assert "did not change" in second_result["reason"]
            assert third_result["status"] == "changed"
            assert third_result["runId"]
            assert len(writes) == 2
            assert writes[0]["service"] == "github"
            assert "Repeat Notion webhook to GitHub" in writes[0]["title"]
            activities = client.get("/api/integration-activities?event_type=automation.live_write", headers=headers).json()["activities"]
            assert len([item for item in activities if item["automationTaskId"] == task["id"] and item["provider"] == "github"]) == 2
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
