from __future__ import annotations

import os
import json
import subprocess
import sys
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ["AI_BOARD_DATABASE_URL"] = "sqlite:///:memory:"

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.collectors import CollectedItem, parse_github_repo
from app.config import settings
from app.db import SessionLocal, engine, init_db
import app.main as main_module
from app.main import app
from app.models import AutomationTask, IntegrationProfile
from app.live_writers import write_github_issue, write_notion_task
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
    assert write["payload"]["parent"]["database_id"] == "1234567890abcdef1234567890abcdef"
    assert "plain-notion-token-for-dry-run" not in str(write)


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

        def fake_execute_profile_write(profile, title, body, dry_run=True, start_minutes_from_now=15, duration_minutes=30):
            written.append({"service": profile.source_kind, "title": title, "body": body, "dryRun": dry_run})
            return {"service": profile.source_kind, "status": "written", "url": f"https://example.test/{profile.source_kind}", "dryRun": dry_run}

        monkeypatch.setattr("app.main.execute_profile_write", fake_execute_profile_write)
        first_run = client.post(f"/api/automations/{task_id}/run", headers=headers)
        assert first_run.status_code == 200
        assert first_run.json()["run"]["result"]["status"] == "changed"
        assert first_run.json()["run"]["result"]["scheduled"] is False
        assert first_run.json()["run"]["result"]["targets"][0]["target"] == "github"
        assert first_run.json()["run"]["result"]["targets"][0]["operation"] == "rag_collect_issues_commits_prs"
        assert {"issues", "commits", "pull_requests"} <= {item["target"] for item in first_run.json()["run"]["result"]["externalRagSources"]}
        assert first_run.json()["run"]["result"]["liveWrites"][0]["service"] == "notion"
        assert first_run.json()["run"]["result"]["liveWrites"][0]["status"] == "written"
        assert written and written[0]["service"] == "notion"
        assert written[0]["dryRun"] is False
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
            assert writes
            assert writes[0]["service"] == "notion"
            assert writes[0]["title"] == "[AI Board] [Hooked GitHub] Webhook commit"
            assert "Source URL: https://github.com/acme/hooked/commit/abc" in writes[0]["body"]
            activities = client.get("/api/integration-activities?event_type=automation.live_write", headers=headers).json()["activities"]
            assert any(item["provider"] == "notion" and item["status"] == "written" for item in activities)
    finally:
        monkeypatch.delenv("AI_BOARD_GITHUB_WEBHOOK_SECRET", raising=False)
        settings.cache_clear()


def test_notion_webhook_signature_triggers_matching_automation(monkeypatch):
    monkeypatch.setenv("AI_BOARD_NOTION_WEBHOOK_SECRET", "notion-hook-secret")
    settings.cache_clear()
    writes = []

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
            assert writes
            assert writes[0]["service"] == "notion"
            assert writes[0]["title"] == "[AI Board] [Hooked Notion] Webhook task page"
            assert "Source URL: https://www.notion.so/workspace/hooked-page" in writes[0]["body"]
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
