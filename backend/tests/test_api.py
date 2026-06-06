from __future__ import annotations

import os

os.environ["AI_BOARD_DATABASE_URL"] = "sqlite:///:memory:"

from fastapi.testclient import TestClient

from app.collectors import CollectedItem
from app.db import SessionLocal
from app.main import app
from app.models import IntegrationProfile
from app.security import reveal_secret


def test_full_fastapi_flow(monkeypatch):
    def fake_collect(profile, limit=20, pages=2):
        assert limit == 20
        assert pages == 2
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
        assert profile_json["hasToken"] is True
        assert profile_json["tokenStorage"] == "encrypted"
        assert "ghp_secret_value" not in str(profile_json)
        assert "pull_requests" in profile_json["ragTargets"]
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
        collected = client.post(f"/api/integration-profiles/{profile_json['id']}/collect?limit=20&pages=2", headers=headers)
        assert collected.status_code == 200
        assert collected.json()["status"] == "collected"
        assert collected.json()["request"] == {"limit": 20, "pages": 2}
        assert collected.json()["saved"][0]["sourceType"] == "github_issue"
        profiles_after_collect = client.get("/api/integration-profiles", headers=headers).json()["profiles"]
        after_collect_profile = next(item for item in profiles_after_collect if item["id"] == profile_json["id"])
        assert after_collect_profile["lastCollect"]["status"] == "collected"
        assert after_collect_profile["lastCollect"]["saved"] == 1
        collected_again = client.post(f"/api/integration-profiles/{profile_json['id']}/collect?limit=20&pages=2", headers=headers)
        assert collected_again.status_code == 200
        assert collected_again.json()["status"] == "unchanged"
        assert collected_again.json()["skippedDuplicates"] == 1
        profiles_after_duplicate = client.get("/api/integration-profiles", headers=headers).json()["profiles"]
        after_duplicate_profile = next(item for item in profiles_after_duplicate if item["id"] == profile_json["id"])
        assert after_duplicate_profile["lastCollect"]["status"] == "unchanged"
        assert after_duplicate_profile["lastCollect"]["skippedDuplicates"] == 1

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

        assert client.get("/api/posts?q=GitHub").json()["total"] >= 1
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
        assert automation.json()["task"]["integrationProfile"]["sourceKind"] == "github"
        assert automation.json()["task"]["customConnections"][0]["service"] == "github"
        assert client.get("/api/automations", headers=headers).json()["tasks"]
        first_run = client.post(f"/api/automations/{task_id}/run", headers=headers)
        assert first_run.status_code == 200
        assert first_run.json()["run"]["result"]["status"] == "changed"
        assert first_run.json()["run"]["result"]["targets"][0]["target"] == "github"
        assert first_run.json()["run"]["result"]["targets"][0]["operation"] == "rag_collect_issues_commits_prs"
        assert {"issues", "commits", "pull_requests"} <= {item["target"] for item in first_run.json()["run"]["result"]["externalRagSources"]}
        second_run = client.post(f"/api/automations/{task_id}/run", headers=headers)
        assert second_run.status_code == 200
        assert second_run.json()["run"]["result"]["status"] == "skipped"
        assert client.post(f"/api/automations/{task_id}/share", headers=headers).status_code == 200
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

        forbidden = client.post(f"/api/automations/{admin_task.json()['task']['id']}/run", headers=user_headers)
        assert forbidden.status_code == 403

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
