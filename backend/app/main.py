from __future__ import annotations

import base64
import json
import os
import hashlib
import hmac
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .collectors import CollectedItem, collect_profile_items, extract_notion_id, parse_github_repo, save_collected_items
from .db import check_db, database_reachable, get_db, init_db
from .live_writers import execute_profile_write, google_calendar_access_token, parse_figma_file_key, profile_access_token, safe_calendar_id, write_calendar_event_at, write_notion_sources_report
from .models import AutomationRun, AutomationTask, Comment, IntegrationActivity, IntegrationProfile, KnowledgeSource, Post, SystemSetting, User
from .schemas import AutomationIn, CommentIn, IntegrationProfileIn, InstructionIn, KnowledgeIn, LiveWriteIn, LoginIn, PostIn, ProfileSettingsIn, QuestionIn, RegisterIn, SystemSettingsIn
from .security import create_token, current_user, hash_password, protect_secret, reveal_secret, secret_preview, secret_storage_type, verify_password
from .services import agent_review, automation_fingerprint, automation_plan, get_or_create_tags, instruction_hub, rag_answer, result_to_text, search_posts, summarize
from .taskory_import import normalize_taskory_export
from .config import settings

app = FastAPI(title="AI Board API", description="React + FastAPI + PostgreSQL + Redis AI board API.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = Path(os.environ.get("AI_BOARD_FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist")).resolve()
FRONTEND_INDEX = FRONTEND_DIST / "index.html"


class ReportSource(dict):
    def __getattr__(self, name: str):
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc
FRONTEND_ASSETS = FRONTEND_DIST / "assets"
STARTUP_DB_ERROR = ""
OAUTH_STATE_TTL_SECONDS = 10 * 60
OPENAI_AUDIO_DIRECT_LIMIT = 24 * 1024 * 1024


@app.on_event("startup")
def startup() -> None:
    global STARTUP_DB_ERROR
    ensure_database_ready()


def ensure_database_ready() -> tuple[bool, str]:
    global STARTUP_DB_ERROR
    reachable, reason = database_reachable()
    if not reachable:
        STARTUP_DB_ERROR = reason
        return False, reason
    try:
        init_db()
        STARTUP_DB_ERROR = ""
        return True, ""
    except SQLAlchemyError as exc:
        STARTUP_DB_ERROR = f"{exc.__class__.__name__}: {str(exc).splitlines()[0][:240]}"
        return False, STARTUP_DB_ERROR


def serialize_user(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


def parse_connections(raw: str) -> list[dict]:
    try:
        value = json.loads(raw or "[]")
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def parse_string_list(raw: str) -> list[str]:
    try:
        value = json.loads(raw or "[]")
        return [str(item) for item in value] if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def merge_connection_lists(primary: list[dict], secondary: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for item in [*primary, *secondary]:
        service = str(item.get("service", "")).lower()
        operation = str(item.get("operation", "")).lower()
        url = str(item.get("url", "")).strip()
        key = (service, operation, url)
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def connection_dicts(value: list | str) -> list[dict]:
    if isinstance(value, str):
        return parse_connections(value)
    result = []
    for item in value:
        result.append(item.model_dump() if hasattr(item, "model_dump") else dict(item))
    return result


def serialize_profile_settings(user: User) -> dict:
    return {
        "aiProvider": user.profile_ai_provider,
        "aiModel": user.profile_ai_model,
        "aiApiBase": user.profile_ai_api_base,
        "apiKeyStrategy": user.profile_api_key_strategy,
        "templatePreset": user.profile_template_preset,
        "customTemplate": user.profile_custom_template,
        "customConnections": parse_connections(user.profile_custom_connections),
    }


def system_setting_value(db: Session | None, key: str) -> str:
    if db is None:
        return ""
    setting = db.get(SystemSetting, key)
    return (setting.value if setting else "").strip().rstrip("/")


def serialize_system_settings(db: Session | None) -> dict:
    public_base_url = system_setting_value(db, "public_base_url") or os.environ.get("AI_BOARD_PUBLIC_BASE_URL", "").strip().rstrip("/")
    return {
        "publicBaseUrl": public_base_url,
        "source": "database" if system_setting_value(db, "public_base_url") else ("environment" if public_base_url else "request"),
    }


def provider_oauth_redirect_override(provider: str) -> str:
    normalized = provider.lower()
    override_key = f"AI_BOARD_{normalized.upper()}_OAUTH_REDIRECT_URI"
    override = os.environ.get(override_key, "").strip().rstrip("/")
    if override.startswith(("https://", "http://")):
        return override
    if normalized == "google_calendar":
        google_override = os.environ.get("AI_BOARD_GOOGLE_OAUTH_REDIRECT_URI", "").strip().rstrip("/")
        if google_override.startswith(("https://", "http://")):
            return google_override
    return ""


def oauth_redirect_uri_source(provider: str, db: Session | None = None) -> str:
    normalized = provider.lower()
    if provider_oauth_redirect_override(normalized):
        return "provider_override"
    if system_setting_value(db, "public_base_url"):
        return "database_public_base_url"
    if os.environ.get("AI_BOARD_PUBLIC_BASE_URL", "").strip().rstrip("/"):
        return "environment_public_base_url"
    return "request_public_origin"


def upsert_system_setting(db: Session, key: str, value: str) -> SystemSetting:
    setting = db.get(SystemSetting, key)
    if not setting:
        setting = SystemSetting(key=key, value=value)
        db.add(setting)
    else:
        setting.value = value
    return setting


def serialize_knowledge(source: KnowledgeSource) -> dict:
    return {
        "id": source.id,
        "title": source.title,
        "sourceType": source.source_type,
        "fileName": source.file_name,
        "mimeType": source.mime_type,
        "instruction": source.instruction,
        "extractedText": source.extracted_text,
        "tags": parse_string_list(source.tags_json),
        "createdAt": str(source.created_at),
    }


def parse_json_object(raw: str) -> dict:
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def find_user_openai_credentials(db: Session, user: User, profile_id: int | None = None) -> tuple[str, str, int | None, str]:
    if profile_id:
        profile = db.get(IntegrationProfile, profile_id)
        if not profile or profile.owner_id != user.id:
            raise HTTPException(status_code=404, detail="선택한 OpenAI API 키 프로필을 찾을 수 없습니다.")
        provider = f"{profile.ai_provider} {profile.api_provider} {profile.name}".lower()
        if "openai" not in provider:
            raise HTTPException(status_code=400, detail="선택한 프로필은 OpenAI 전사용 프로필이 아닙니다.")
        token = reveal_secret(profile.token_value).strip()
        if not token:
            raise HTTPException(status_code=400, detail="선택한 OpenAI 프로필에 API 키가 저장되어 있지 않습니다.")
        return token, (profile.ai_api_base or profile.base_url or "https://api.openai.com/v1").rstrip("/"), profile.id, profile.name

    stmt = (
        select(IntegrationProfile)
        .where(IntegrationProfile.owner_id == user.id)
        .order_by(IntegrationProfile.created_at.desc())
    )
    for profile in db.scalars(stmt).all():
        provider = f"{profile.ai_provider} {profile.api_provider} {profile.name}".lower()
        if "openai" not in provider:
            continue
        token = reveal_secret(profile.token_value).strip()
        if token:
            return token, (profile.ai_api_base or profile.base_url or "https://api.openai.com/v1").rstrip("/"), profile.id, profile.name
    if settings.openai_api_key:
        return settings.openai_api_key, "https://api.openai.com/v1", None, "server OPENAI_API_KEY"
    raise HTTPException(status_code=400, detail="OpenAI API 키 프로필이 없습니다. 프로필 탭에서 OpenAI 키를 먼저 저장하세요.")


def split_audio_bytes(raw: bytes, file_name: str) -> tuple[tempfile.TemporaryDirectory | None, list[tuple[str, bytes, str]]]:
    if len(raw) <= OPENAI_AUDIO_DIRECT_LIMIT:
        return None, [(file_name, raw, "application/octet-stream")]
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=413, detail="24MB를 넘는 음성 파일은 ffmpeg가 필요합니다. ffmpeg를 설치하거나 더 작은 파일을 업로드하세요.")
    temp_dir = tempfile.TemporaryDirectory(prefix="ai-board-audio-")
    temp_path = Path(temp_dir.name)
    suffix = Path(file_name).suffix or ".audio"
    source_path = temp_path / f"source{suffix}"
    source_path.write_bytes(raw)
    output_pattern = temp_path / "chunk-%03d.mp3"
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(source_path),
        "-f",
        "segment",
        "-segment_time",
        "600",
        "-vn",
        "-acodec",
        "libmp3lame",
        "-b:a",
        "64k",
        str(output_pattern),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        temp_dir.cleanup()
        raise HTTPException(status_code=500, detail=f"ffmpeg 음성 분할 실패: {(result.stderr or result.stdout)[-800:]}")
    parts = sorted(temp_path.glob("chunk-*.mp3"))
    if not parts:
        temp_dir.cleanup()
        raise HTTPException(status_code=500, detail="ffmpeg가 음성 조각을 만들지 못했습니다.")
    return temp_dir, [(part.name, part.read_bytes(), "audio/mpeg") for part in parts]


async def post_openai_transcription(api_key: str, api_base: str, file_name: str, raw: bytes, mime_type: str, model: str, prompt: str) -> str:
    data = {"model": model or "whisper-1"}
    if prompt.strip():
        data["prompt"] = prompt.strip()
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{api_base}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files={"file": (file_name, raw, mime_type or "application/octet-stream")},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI 음성 전사 연결 실패: {exc}") from exc
    if response.status_code >= 400:
        detail = response.text[:500]
        raise HTTPException(status_code=502, detail=f"OpenAI 음성 전사 실패: HTTP {response.status_code} {detail}")
    payload = response.json()
    transcript = str(payload.get("text") or "").strip()
    if not transcript:
        raise HTTPException(status_code=502, detail="OpenAI 전사 결과가 비어 있습니다.")
    return transcript


async def transcribe_audio_with_openai(api_key: str, api_base: str, upload: UploadFile, model: str, prompt: str) -> dict:
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="전사할 음성 파일이 비어 있습니다.")
    file_name = upload.filename or "audio"
    mime_type = upload.content_type or "application/octet-stream"
    temp_dir = None
    try:
        temp_dir, parts = split_audio_bytes(raw, file_name)
        if len(parts) == 1 and parts[0][0] == file_name:
            parts[0] = (file_name, parts[0][1], mime_type)
        transcripts = []
        for index, (part_name, part_raw, part_mime) in enumerate(parts, start=1):
            part_prompt = prompt if len(parts) == 1 else f"{prompt}\n\n이 파일은 {file_name}의 {index}/{len(parts)}번째 조각입니다.".strip()
            transcripts.append(await post_openai_transcription(api_key, api_base, part_name, part_raw, part_mime, model, part_prompt))
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()
    return {"text": "\n\n".join(transcripts).strip(), "fileName": file_name, "mimeType": mime_type, "model": model or "whisper-1", "parts": len(parts)}


def serialize_activity(activity: IntegrationActivity) -> dict:
    return {
        "id": activity.id,
        "ownerId": activity.owner_id,
        "automationTaskId": activity.automation_task_id,
        "integrationProfileId": activity.integration_profile_id,
        "eventType": activity.event_type,
        "provider": activity.provider,
        "status": activity.status,
        "summary": activity.summary,
        "details": parse_json_object(activity.details_json),
        "createdAt": str(activity.created_at),
    }


def serialize_run(run: AutomationRun) -> dict:
    return {
        "id": run.id,
        "taskId": run.task_id,
        "ownerId": run.owner_id,
        "result": run.result,
        "createdPostId": run.created_post_id,
        "createdAt": str(run.created_at),
    }


def serialize_automation_template(task: AutomationTask | None) -> dict | None:
    if not task:
        return None
    return {
        "name": task.name,
        "integration_profile_id": "",
        "source": task.source,
        "destination": task.destination,
        "interval_minutes": task.interval_minutes,
        "instruction": task.instruction,
        "template": task.template,
        "api_provider": task.api_provider,
        "ai_agent": task.ai_agent,
        "github_repo_url": task.github_repo_url,
        "github_project_url": task.github_project_url,
        "notion_database_url": task.notion_database_url,
        "figma_file_url": task.figma_file_url,
        "calendar_id": task.calendar_id,
        "ai_provider": task.ai_provider,
        "ai_model": task.ai_model,
        "ai_api_base": task.ai_api_base,
        "api_key_strategy": "내 계정의 연동 프로필/API 키로 다시 선택해서 실행합니다.",
        "request_template": task.request_template,
        "github_issue_template": task.github_issue_template,
        "notion_template": task.notion_template,
        "figma_template": task.figma_template,
        "template_preset": task.template_preset,
        "custom_template": task.custom_template,
        "custom_connections": parse_connections(task.custom_connections),
        "status": "ACTIVE",
    }


def log_activity(
    db: Session,
    user: User,
    event_type: str,
    provider: str,
    status: str,
    summary: str,
    details: dict | None = None,
    task_id: int | None = None,
    profile_id: int | None = None,
) -> IntegrationActivity:
    activity = IntegrationActivity(
        owner_id=user.id,
        automation_task_id=task_id,
        integration_profile_id=profile_id,
        event_type=event_type,
        provider=provider,
        status=status,
        summary=summary[:240],
        details_json=json.dumps(details or {}, ensure_ascii=False),
    )
    db.add(activity)
    return activity


def serialize_integration_profile(profile: IntegrationProfile) -> dict:
    token_plain = reveal_secret(profile.token_value)
    return {
        "id": profile.id,
        "name": profile.name,
        "sourceKind": profile.source_kind,
        "baseUrl": profile.base_url,
        "apiProvider": profile.api_provider,
        "tokenName": profile.token_name,
        "hasToken": bool(token_plain),
        "tokenPreview": secret_preview(profile.token_value),
        "tokenStorage": secret_storage_type(profile.token_value),
        "authType": profile.auth_type,
        "mcpServerUrl": profile.mcp_server_url,
        "mcpAuthSubject": profile.mcp_auth_subject,
        "mcpScopes": parse_string_list(profile.mcp_scopes_json),
        "aiProvider": profile.ai_provider,
        "aiModel": profile.ai_model,
        "aiApiBase": profile.ai_api_base,
        "ragTargets": parse_string_list(profile.rag_targets_json),
        "collectLimit": profile.collect_limit,
        "collectPages": profile.collect_pages,
        "customConnections": parse_connections(profile.custom_connections),
        "customTemplate": profile.custom_template,
        "lastCollect": {
            "status": profile.last_collect_status,
            "collected": profile.last_collect_count,
            "saved": profile.last_collect_saved,
            "skippedDuplicates": profile.last_collect_duplicates,
            "warnings": parse_string_list(profile.last_collect_warnings),
            "at": str(profile.last_collected_at) if profile.last_collected_at else "",
        },
        "createdAt": str(profile.created_at),
    }


def provider_validation_hint(service: str, status_code: int | None, reason: str = "") -> str:
    if reason == "missing_token":
        return "프로필에 API 키 또는 OAuth 토큰을 저장하세요."
    if reason == "missing_target":
        return "Base URL 또는 대상 ID/URL을 입력하세요."
    if service == "github":
        if status_code == 401:
            return "GitHub 토큰이 만료되었거나 잘못되었습니다. repo 읽기 권한이 있는 토큰으로 다시 연결하세요."
        if status_code == 403:
            return "GitHub 토큰 권한이 부족합니다. 저장소 읽기/이슈 권한을 확인하세요."
        if status_code == 404:
            return "저장소 URL이 틀렸거나 이 계정/토큰이 저장소에 접근할 수 없습니다."
    if service == "notion":
        if status_code == 401:
            return "Notion integration secret이 잘못되었거나 만료되었습니다."
        if status_code == 403:
            return "Notion 페이지/DB가 integration에 공유되지 않았습니다."
        if status_code == 404:
            return "Notion 대상 ID가 틀렸거나 integration에 공유되지 않았습니다."
    if service == "figma":
        if status_code in {401, 403}:
            return "Figma 토큰이 잘못되었거나 해당 파일 접근 권한이 없습니다."
        if status_code == 404:
            return "Figma 파일 URL 또는 key를 확인하세요."
    if service == "google_calendar":
        if status_code in {401, 403}:
            return "Google OAuth 토큰이 만료되었거나 캘린더 접근 권한이 없습니다. 다시 로그인하세요."
        if status_code == 404:
            return "Calendar ID가 틀렸거나 접근 권한이 없습니다."
    if service == "openai":
        if status_code == 401:
            return "OpenAI API 키가 잘못되었거나 만료되었습니다."
        if status_code == 403:
            return "OpenAI API 키 권한 또는 프로젝트 접근 권한을 확인하세요."
        if status_code == 404:
            return "OpenAI API Base URL이 올바른지 확인하세요."
    return "대상 서비스의 토큰, URL, 권한을 확인하세요."


def validation_result(service: str, status: str, message: str, *, target: str = "", status_code: int | None = None, reason: str = "", checked: list[str] | None = None) -> dict:
    return {
        "service": service,
        "status": status,
        "message": message,
        "target": target,
        "statusCode": status_code,
        "reason": reason,
        "checked": checked or [],
        "hint": provider_validation_hint(service, status_code, reason) if status != "ok" else "읽기 전용 인증 검증이 통과했습니다.",
    }


def validate_integration_profile_credentials(profile: IntegrationProfile) -> dict:
    service = (profile.source_kind or "custom").lower()
    provider_text = f"{profile.ai_provider} {profile.api_provider} {profile.name}".lower()
    if "openai" in provider_text and service == "custom":
        service = "openai"

    token = google_calendar_access_token(profile) if service == "google_calendar" else profile_access_token(profile)
    if not token:
        return validation_result(service, "blocked", "저장된 토큰이 없어 검증할 수 없습니다.", reason="missing_token", checked=["token_missing"])

    try:
        if service == "github":
            repo = parse_github_repo(profile.base_url)
            if not repo:
                return validation_result(service, "blocked", "GitHub 저장소 URL을 확인할 수 없습니다.", reason="missing_target", checked=["token_present", "repo_missing"])
            owner, name = repo
            url = f"https://api.github.com/repos/{owner}/{name}"
            response = httpx.get(
                url,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
                timeout=15.0,
            )
            if response.is_success:
                payload = response.json()
                return validation_result(service, "ok", f"{payload.get('full_name', f'{owner}/{name}')} 저장소 읽기 인증이 정상입니다.", target=url, status_code=response.status_code, checked=["token_present", "repo_read"])
            return validation_result(service, "failed", f"GitHub 저장소 읽기 검증 실패: HTTP {response.status_code}", target=url, status_code=response.status_code, checked=["token_present", "repo_read_failed"])

        if service == "notion":
            target_id = extract_notion_id(profile.base_url)
            if not target_id:
                return validation_result(service, "blocked", "Notion 페이지 또는 데이터베이스 ID를 찾을 수 없습니다.", reason="missing_target", checked=["token_present", "target_missing"])
            headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Accept": "application/json"}
            database_url = f"https://api.notion.com/v1/databases/{target_id}"
            response = httpx.get(database_url, headers=headers, timeout=15.0)
            target_url = database_url
            target_type = "database"
            if response.status_code in {400, 404}:
                block_url = f"https://api.notion.com/v1/blocks/{target_id}"
                block_response = httpx.get(block_url, headers=headers, timeout=15.0)
                if block_response.status_code != 404 or response.status_code == 404:
                    response = block_response
                    target_url = block_url
                    target_type = "block"
            if response.is_success:
                return validation_result(service, "ok", f"Notion {target_type} 읽기 인증이 정상입니다.", target=target_url, status_code=response.status_code, checked=["token_present", f"{target_type}_read"])
            return validation_result(service, "failed", f"Notion 읽기 검증 실패: HTTP {response.status_code}", target=target_url, status_code=response.status_code, checked=["token_present", "notion_read_failed"])

        if service == "figma":
            file_key = parse_figma_file_key(profile.base_url)
            if not file_key:
                return validation_result(service, "blocked", "Figma 파일 URL 또는 key를 찾을 수 없습니다.", reason="missing_target", checked=["token_present", "file_missing"])
            url = f"https://api.figma.com/v1/files/{file_key}"
            response = httpx.get(url, headers={"X-Figma-Token": token}, timeout=15.0)
            if response.is_success:
                payload = response.json()
                return validation_result(service, "ok", f"Figma 파일 '{payload.get('name', file_key)}' 읽기 인증이 정상입니다.", target=url, status_code=response.status_code, checked=["token_present", "file_read"])
            return validation_result(service, "failed", f"Figma 파일 읽기 검증 실패: HTTP {response.status_code}", target=url, status_code=response.status_code, checked=["token_present", "file_read_failed"])

        if service == "google_calendar":
            calendar_id = safe_calendar_id(profile.base_url)
            url = f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id, safe='')}"
            response = httpx.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, timeout=15.0)
            if response.is_success:
                payload = response.json()
                return validation_result(service, "ok", f"Google Calendar '{payload.get('summary', calendar_id)}' 읽기 인증이 정상입니다.", target=url, status_code=response.status_code, checked=["token_present", "calendar_read"])
            return validation_result(service, "failed", f"Google Calendar 읽기 검증 실패: HTTP {response.status_code}", target=url, status_code=response.status_code, checked=["token_present", "calendar_read_failed"])

        if service == "openai":
            api_base = (profile.ai_api_base or profile.base_url or "https://api.openai.com/v1").rstrip("/")
            url = f"{api_base}/models"
            response = httpx.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, timeout=15.0)
            if response.is_success:
                return validation_result(service, "ok", "OpenAI API 키로 모델 목록 읽기 인증이 정상입니다.", target=url, status_code=response.status_code, checked=["token_present", "models_read"])
            return validation_result(service, "failed", f"OpenAI 모델 목록 읽기 검증 실패: HTTP {response.status_code}", target=url, status_code=response.status_code, checked=["token_present", "models_read_failed"])
    except httpx.HTTPError as exc:
        return validation_result(service, "failed", f"연결 검증 중 네트워크 오류가 발생했습니다: {exc}", reason="network_error", checked=["token_present"])

    return validation_result(service, "blocked", f"{service} 프로필은 아직 자동 검증을 지원하지 않습니다.", reason="unsupported", checked=["token_present"])


def public_base_url(request: Request, db: Session | None = None) -> str:
    configured = system_setting_value(db, "public_base_url") or os.environ.get("AI_BOARD_PUBLIC_BASE_URL", "").strip().rstrip("/")
    explicit_origin = request.headers.get("x-ai-board-public-origin", "").strip().rstrip("/")
    forwarded_host = request.headers.get("x-forwarded-host")
    host = forwarded_host or request.headers.get("host") or request.url.netloc
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    request_base = f"{proto}://{host}".rstrip("/")
    if configured:
        configured_host = urlparse(configured).netloc.lower()
        if not (
            "trycloudflare.com" in configured_host
            or configured_host.endswith(".ngrok-free.app")
            or configured_host.endswith(".ngrok.app")
        ):
            return configured
    if explicit_origin.startswith(("https://", "http://")):
        origin_host = urlparse(explicit_origin).netloc.lower()
        if (
            "trycloudflare.com" in origin_host
            or origin_host.endswith(".ngrok-free.app")
            or origin_host.endswith(".ngrok.app")
        ):
            return explicit_origin
    host_lower = host.lower()
    if configured and not (
        "trycloudflare.com" in host_lower
        or host_lower.endswith(".ngrok-free.app")
        or host_lower.endswith(".ngrok.app")
    ):
        return configured
    return request_base or configured


def public_origin_diagnostics(request: Request, db: Session | None = None) -> dict:
    origin = public_base_url(request, db)
    host = urlparse(origin).netloc.lower()
    setting_source = serialize_system_settings(db)
    temporary = (
        "trycloudflare.com" in host
        or host.endswith(".ngrok-free.app")
        or host.endswith(".ngrok.app")
    )
    return {
        "origin": origin,
        "configuredPublicBaseUrl": setting_source["publicBaseUrl"],
        "configuredPublicBaseUrlSource": setting_source["source"],
        "temporaryTunnel": temporary,
        "risk": "temporary_tunnel_callback_rotation" if temporary else "stable_public_origin",
        "message": (
            "현재 접속 주소가 임시 터널입니다. 주소가 바뀌면 GitHub/Notion/Figma/Google OAuth callback을 모두 다시 등록해야 합니다."
            if temporary
            else "현재 접속 주소는 고정 public origin으로 보입니다. OAuth callback 등록이 안정적으로 유지됩니다."
        ),
        "nextAction": (
            "Cloudflare named tunnel, 고정 도메인, 또는 호스팅 배포 URL을 AI_BOARD_PUBLIC_BASE_URL로 사용하세요."
            if temporary
            else "각 provider 개발자 콘솔에 표시된 callback URL이 등록되어 있는지만 확인하세요."
        ),
    }


def oauth_redirect_uri(provider: str, request: Request, db: Session | None = None) -> str:
    normalized = provider.lower()
    provider_override = provider_oauth_redirect_override(normalized)
    if provider_override:
        return provider_override
    configured_public_base = system_setting_value(db, "public_base_url")
    if configured_public_base:
        return f"{configured_public_base}/api/oauth/{normalized}/callback"
    return f"{public_base_url(request, db)}/api/oauth/{normalized}/callback"


def webhook_readiness(request: Request, db: Session | None = None) -> list[dict]:
    base_url = public_base_url(request, db)
    return [
        {
            "provider": "github",
            "name": "GitHub",
            "endpoint": f"{base_url}/api/webhooks/github",
            "events": ["push"],
            "signatureHeader": "X-Hub-Signature-256",
            "secretEnv": "AI_BOARD_GITHUB_WEBHOOK_SECRET",
            "secretConfigured": bool(settings().github_webhook_secret),
            "setupUrl": "https://github.com/<owner>/<repo>/settings/hooks",
            "usedByTemplates": ["GitHub → Notion"],
            "matchingRule": "repository.full_name 또는 repository.html_url이 자동화 GitHub repo URL/Profile Base URL과 일치해야 합니다.",
            "nextAction": "GitHub repository Settings > Webhooks에 endpoint를 Payload URL로 등록하고 Content type은 application/json으로 둡니다.",
        },
        {
            "provider": "notion",
            "name": "Notion",
            "endpoint": f"{base_url}/api/webhooks/notion",
            "events": ["page.updated", "database.updated"],
            "signatureHeader": "X-AI-Board-Signature",
            "secretEnv": "AI_BOARD_NOTION_WEBHOOK_SECRET",
            "secretConfigured": bool(settings().notion_webhook_secret),
            "setupUrl": "https://www.notion.so/profile/integrations",
            "usedByTemplates": ["Notion BOARD → GitHub Issue", "Notion GANTT → Google Calendar"],
            "matchingRule": "payload page/database URL 또는 ID가 자동화 Notion URL/Profile Base URL과 일치해야 합니다.",
            "nextAction": "Notion integration에서 변경 이벤트를 받을 대상 page/database를 공유하고, 외부 webhook sender가 이 endpoint로 변경 payload를 전송하게 설정합니다.",
        },
    ]


def clean_oauth_env_value(value: str) -> str:
    cleaned = str(value or "").strip().lstrip("\ufeff").strip().strip("\"'")
    if not cleaned:
        return ""
    if "=" in cleaned:
        left, right = cleaned.split("=", 1)
        if left.strip().replace("_", "").replace("-", "").isalnum() and len(left.strip()) <= 60:
            cleaned = right.strip().strip("\"'")
    if ":" in cleaned:
        left, right = cleaned.split(":", 1)
        label = left.strip().lower()
        label_markers = ("client", "secret", "id", "클라이언트", "시크릿", "보안", "비밀번호", "아이디")
        if any(marker in label for marker in label_markers):
            cleaned = right.strip().strip("\"'")
    return cleaned


def oauth_state_secret() -> bytes:
    return settings().jwt_secret.encode()


def sign_oauth_state(payload: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(oauth_state_secret(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{signature}"


def read_oauth_state(state: str) -> dict:
    try:
        raw, signature = state.rsplit(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="OAuth state is malformed.") from exc
    expected = hmac.new(oauth_state_secret(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=400, detail="OAuth state signature is invalid.")
    try:
        padded = raw + ("=" * (-len(raw) % 4))
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="OAuth state payload is invalid.") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=400, detail="OAuth state expired. Start the connector login again.")
    return payload


def oauth_provider_config(provider: str, request: Request, db: Session | None = None) -> dict:
    normalized = provider.lower()
    redirect_uri = oauth_redirect_uri(normalized, request, db)
    if normalized == "github":
        client_id = clean_oauth_env_value(os.environ.get("AI_BOARD_GITHUB_OAUTH_CLIENT_ID", ""))
        client_secret = clean_oauth_env_value(os.environ.get("AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET", ""))
        return {
            "provider": "github",
            "clientId": client_id,
            "clientSecret": client_secret,
            "missing": [
                name
                for name, value in {
                    "AI_BOARD_GITHUB_OAUTH_CLIENT_ID": client_id,
                    "AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET": client_secret,
                }.items()
                if not value
            ],
            "authorizeUrl": "https://github.com/login/oauth/authorize",
            "tokenUrl": "https://github.com/login/oauth/access_token",
            "redirectUri": redirect_uri,
            "scope": "repo read:user user:email",
            "mcpServerUrl": "mcp://github",
            "apiProvider": "GitHub MCP OAuth",
            "tokenName": "GITHUB_MCP_OAUTH_TOKEN",
            "ragTargets": ["issues", "commits", "pull_requests"],
            "profileName": "GitHub MCP OAuth profile",
            "baseUrl": "https://github.com/<owner>/<repo>",
            "setupUrl": "https://github.com/settings/developers",
        }
    if normalized == "notion":
        client_id = clean_oauth_env_value(os.environ.get("AI_BOARD_NOTION_OAUTH_CLIENT_ID", ""))
        client_secret = clean_oauth_env_value(os.environ.get("AI_BOARD_NOTION_OAUTH_CLIENT_SECRET", ""))
        return {
            "provider": "notion",
            "clientId": client_id,
            "clientSecret": client_secret,
            "missing": [
                name
                for name, value in {
                    "AI_BOARD_NOTION_OAUTH_CLIENT_ID": client_id,
                    "AI_BOARD_NOTION_OAUTH_CLIENT_SECRET": client_secret,
                }.items()
                if not value
            ],
            "authorizeUrl": "https://api.notion.com/v1/oauth/authorize",
            "tokenUrl": "https://api.notion.com/v1/oauth/token",
            "redirectUri": redirect_uri,
            "scope": "page.read page.write database.read database.write",
            "mcpServerUrl": "mcp://notion",
            "apiProvider": "Notion MCP OAuth",
            "tokenName": "NOTION_MCP_OAUTH_TOKEN",
            "ragTargets": ["notion_pages", "notion_database"],
            "profileName": "Notion MCP OAuth profile",
            "baseUrl": "https://www.notion.so/<workspace>/<page-or-database-id>",
            "setupUrl": "https://www.notion.so/profile/integrations",
        }
    if normalized == "figma":
        client_id = clean_oauth_env_value(os.environ.get("AI_BOARD_FIGMA_OAUTH_CLIENT_ID", ""))
        client_secret = clean_oauth_env_value(os.environ.get("AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET", ""))
        return {
            "provider": "figma",
            "clientId": client_id,
            "clientSecret": client_secret,
            "missing": [
                name
                for name, value in {
                    "AI_BOARD_FIGMA_OAUTH_CLIENT_ID": client_id,
                    "AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET": client_secret,
                }.items()
                if not value
            ],
            "authorizeUrl": "https://www.figma.com/oauth",
            "tokenUrl": "https://api.figma.com/v1/oauth/token",
            "redirectUri": redirect_uri,
            "scope": "file_content:read,file_metadata:read,file_versions:read,file_comments:read,file_comments:write,current_user:read",
            "mcpServerUrl": "mcp://figma",
            "apiProvider": "Figma MCP OAuth",
            "tokenName": "FIGMA_MCP_OAUTH_TOKEN",
            "ragTargets": ["figma_files", "figma_comments"],
            "profileName": "Figma MCP OAuth profile",
            "baseUrl": "https://www.figma.com/design/<fileKey>/<fileName>",
            "setupUrl": "https://www.figma.com/developers/apps",
        }
    if normalized in {"google", "google_calendar"}:
        client_id = clean_oauth_env_value(os.environ.get("AI_BOARD_GOOGLE_OAUTH_CLIENT_ID", ""))
        client_secret = clean_oauth_env_value(os.environ.get("AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET", ""))
        return {
            "provider": "google_calendar",
            "clientId": client_id,
            "clientSecret": client_secret,
            "missing": [
                name
                for name, value in {
                    "AI_BOARD_GOOGLE_OAUTH_CLIENT_ID": client_id,
                    "AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET": client_secret,
                }.items()
                if not value
            ],
            "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth",
            "tokenUrl": "https://oauth2.googleapis.com/token",
            "redirectUri": redirect_uri,
            "scope": "openid email profile https://www.googleapis.com/auth/calendar.events",
            "mcpServerUrl": "mcp://google-calendar",
            "apiProvider": "Google Calendar MCP OAuth",
            "tokenName": "GOOGLE_CALENDAR_MCP_OAUTH_TOKEN",
            "ragTargets": ["calendar_events"],
            "profileName": "Google Calendar MCP OAuth profile",
            "baseUrl": "primary",
            "setupUrl": "https://console.cloud.google.com/apis/credentials",
            "extraAuthorizeParams": {"access_type": "offline", "include_granted_scopes": "true", "prompt": "consent"},
        }
    raise HTTPException(status_code=404, detail="지원하지 않는 OAuth 제공자입니다.")


def exchange_oauth_code(provider_config: dict, code: str) -> dict:
    provider = provider_config["provider"]
    if provider == "github":
        response = httpx.post(
            provider_config["tokenUrl"],
            data={
                "client_id": provider_config["clientId"],
                "client_secret": provider_config["clientSecret"],
                "code": code,
                "redirect_uri": provider_config["redirectUri"],
            },
            headers={"Accept": "application/json"},
            timeout=20.0,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise HTTPException(status_code=400, detail=f"GitHub OAuth 실패: {payload.get('error_description') or payload['error']}")
        return payload
    if provider == "figma":
        basic = base64.b64encode(f"{provider_config['clientId']}:{provider_config['clientSecret']}".encode()).decode()
        response = httpx.post(
            provider_config["tokenUrl"],
            data={"grant_type": "authorization_code", "code": code, "redirect_uri": provider_config["redirectUri"]},
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"},
            timeout=20.0,
        )
        response.raise_for_status()
        return response.json()
    if provider == "google_calendar":
        response = httpx.post(
            provider_config["tokenUrl"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": provider_config["redirectUri"],
                "client_id": provider_config["clientId"],
                "client_secret": provider_config["clientSecret"],
            },
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            timeout=20.0,
        )
        response.raise_for_status()
        return response.json()
    basic = base64.b64encode(f"{provider_config['clientId']}:{provider_config['clientSecret']}".encode()).decode()
    response = httpx.post(
        provider_config["tokenUrl"],
        json={"grant_type": "authorization_code", "code": code, "redirect_uri": provider_config["redirectUri"]},
        headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Basic {basic}"},
        timeout=20.0,
    )
    response.raise_for_status()
    return response.json()


def github_oauth_subject(access_token: str) -> str:
    try:
        response = httpx.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
            timeout=15.0,
        )
        response.raise_for_status()
        user_info = response.json()
        return str(user_info.get("login") or user_info.get("email") or "github-user")
    except httpx.HTTPError:
        return "github-user"


def notion_oauth_subject(payload: dict) -> str:
    owner = payload.get("owner") if isinstance(payload.get("owner"), dict) else {}
    user = owner.get("user") if isinstance(owner.get("user"), dict) else {}
    person = user.get("person") if isinstance(user.get("person"), dict) else {}
    return str(
        person.get("email")
        or user.get("name")
        or payload.get("workspace_name")
        or payload.get("workspace_id")
        or payload.get("bot_id")
        or "notion-workspace"
    )


def figma_oauth_subject(access_token: str) -> str:
    try:
        response = httpx.get(
            "https://api.figma.com/v1/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15.0,
        )
        response.raise_for_status()
        user_info = response.json()
        return str(user_info.get("email") or user_info.get("handle") or user_info.get("id") or "figma-user")
    except httpx.HTTPError:
        return "figma-user"


def google_oauth_subject(access_token: str) -> str:
    try:
        response = httpx.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15.0,
        )
        response.raise_for_status()
        user_info = response.json()
        return str(user_info.get("email") or user_info.get("id") or "google-calendar-user")
    except httpx.HTTPError:
        return "google-calendar-user"


def upsert_oauth_profile(db: Session, user: User, provider_config: dict, token_payload: dict) -> IntegrationProfile:
    provider = provider_config["provider"]
    access_token = str(token_payload.get("access_token") or "")
    if not access_token:
        raise HTTPException(status_code=400, detail=f"{provider} OAuth 응답에 access_token이 없습니다.")
    scopes = provider_config["scope"].replace(",", " ").split()
    returned_scope = token_payload.get("scope")
    if isinstance(returned_scope, str) and returned_scope.strip():
        scopes = returned_scope.replace(",", " ").split()
    if provider == "github":
        subject = github_oauth_subject(access_token)
    elif provider == "notion":
        subject = notion_oauth_subject(token_payload)
    elif provider == "figma":
        subject = figma_oauth_subject(access_token)
    elif provider == "google_calendar":
        subject = google_oauth_subject(access_token)
    else:
        subject = f"{provider}-user"
    profile = db.scalars(
        select(IntegrationProfile)
        .where(
            IntegrationProfile.owner_id == user.id,
            IntegrationProfile.source_kind == provider,
            IntegrationProfile.auth_type == "mcp_oauth",
            IntegrationProfile.token_name == provider_config["tokenName"],
        )
        .order_by(IntegrationProfile.created_at.desc())
    ).first()
    if not profile:
        profile = IntegrationProfile(owner_id=user.id, source_kind=provider)
        db.add(profile)
    current_base_url = profile.base_url if profile.base_url and "<" not in profile.base_url else provider_config["baseUrl"]
    profile.name = provider_config["profileName"]
    profile.base_url = current_base_url
    profile.api_provider = provider_config["apiProvider"]
    profile.token_name = provider_config["tokenName"]
    if provider == "google_calendar":
        profile.token_value = protect_secret(json.dumps(token_payload, ensure_ascii=False))
    else:
        profile.token_value = protect_secret(access_token)
    profile.auth_type = "mcp_oauth"
    profile.mcp_server_url = provider_config["mcpServerUrl"]
    profile.mcp_auth_subject = subject
    profile.mcp_scopes_json = json.dumps(scopes, ensure_ascii=False)
    profile.rag_targets_json = json.dumps(provider_config["ragTargets"], ensure_ascii=False)
    profile.collect_limit = profile.collect_limit or 20
    profile.collect_pages = profile.collect_pages or 2
    profile.custom_connections = json.dumps(
        [
            {
                "label": f"{provider_config['profileName']} connection",
                "service": provider,
                "url": current_base_url,
                "api": provider_config["apiProvider"],
                "auth_key_name": provider_config["tokenName"],
                "operation": "oauth_mcp_profile",
                "template": "Use the user-owned OAuth connector credential stored on this profile.",
            }
        ],
        ensure_ascii=False,
    )
    return profile


def provider_readiness(user: User, db: Session) -> list[dict]:
    profiles = db.scalars(select(IntegrationProfile).where(IntegrationProfile.owner_id == user.id)).all()
    providers = [
        {
            "key": "github",
            "name": "GitHub Issues",
            "requiredToken": "GITHUB_TOKEN",
            "requiredUrl": "GitHub repository URL",
            "operation": "issue_create_or_update / rag_collect_issues_commits_prs",
        },
        {
            "key": "notion",
            "name": "Notion Tasks DB",
            "requiredToken": "NOTION_TOKEN",
            "requiredUrl": "Notion database/page URL",
            "operation": "upsert_task_page / rag_collect_pages",
        },
        {
            "key": "figma",
            "name": "Figma Review",
            "requiredToken": "FIGMA_TOKEN",
            "requiredUrl": "Figma file URL",
            "operation": "create_review_comment",
        },
        {
            "key": "google_calendar",
            "name": "Google Calendar",
            "requiredToken": "GOOGLE_CALENDAR_TOKEN",
            "requiredUrl": "calendar id",
            "operation": "create_event",
        },
    ]
    results: list[dict] = []
    for provider in providers:
        key = provider["key"]
        matches: list[IntegrationProfile] = []
        profile_urls: dict[int, bool] = {}
        for profile in profiles:
            connections = parse_connections(profile.custom_connections)
            has_connection = any(str(item.get("service", "")).lower() == key for item in connections)
            if profile.source_kind == key or has_connection:
                matches.append(profile)
                profile_urls[profile.id] = bool(profile.base_url) or any(
                    str(item.get("service", "")).lower() == key and bool(item.get("url"))
                    for item in connections
                )
        ready_profiles = [profile for profile in matches if reveal_secret(profile.token_value) and profile_urls.get(profile.id)]
        results.append({
            **provider,
            "profileCount": len(matches),
            "readyCount": len(ready_profiles),
            "ready": bool(ready_profiles),
            "profiles": [
                {
                    "id": profile.id,
                    "name": profile.name,
                    "sourceKind": profile.source_kind,
                    "hasToken": bool(reveal_secret(profile.token_value)),
                    "hasUrl": bool(profile_urls.get(profile.id)),
                    "tokenStorage": secret_storage_type(profile.token_value),
                    "customConnections": [item.get("service", "custom") for item in parse_connections(profile.custom_connections)],
                }
                for profile in matches
            ],
            "nextAction": "ready" if ready_profiles else f"Add an integration profile with {provider['requiredUrl']} and {provider['requiredToken']}.",
        })
    return results


def profile_for_service(db: Session, user: User, task: AutomationTask, service: str) -> IntegrationProfile | None:
    normalized = service.lower()
    if task.integration_profile and task.integration_profile.source_kind.lower() == normalized and reveal_secret(task.integration_profile.token_value):
        return task.integration_profile
    return db.scalars(
        select(IntegrationProfile)
        .where(IntegrationProfile.owner_id == user.id, IntegrationProfile.source_kind == normalized)
        .order_by(IntegrationProfile.created_at.desc())
    ).first()


def automation_write_body(task: AutomationTask, summary: str, source_urls: list[str]) -> str:
    links = "\n".join(f"- {url}" for url in source_urls if url)
    return "\n".join(
        part
        for part in [
            f"Automation: {task.name}",
            f"Route: {task.source} -> {task.destination}",
            f"Instruction: {task.instruction}",
            f"Summary: {summary}",
            f"Next action: {task.template or task.custom_template}",
            "Sources:",
            links or "- No new external source URL was saved.",
        ]
        if part
    )


def source_write_body(task: AutomationTask, source: KnowledgeSource) -> str:
    return "\n".join(
        part
        for part in [
            f"Automation: {task.name}",
            f"Route: {task.source} -> {task.destination}",
            f"Source type: {source.source_type}",
            f"Source title: {source.title}",
            f"Source URL: {source.file_name}",
            f"Next action: {task.template or task.custom_template}",
            "Extracted text:",
            source.extracted_text,
        ]
        if part
    )


def task_output_template(task: AutomationTask) -> str:
    return (
        task.request_template.strip()
        or task.notion_template.strip()
        or task.custom_template.strip()
        or task.template.strip()
        or "{title}\n{summary}\n{source_url}"
    )


def notion_property_title(properties: dict) -> str:
    for prop in properties.values():
        if not isinstance(prop, dict):
            continue
        if prop.get("type") == "title":
            return "".join(part.get("plain_text", "") for part in prop.get("title", [])).strip()
    return ""


def notion_property_text(properties: dict, name: str) -> str:
    prop = properties.get(name) or {}
    if not isinstance(prop, dict):
        return ""
    prop_type = prop.get("type")
    if prop_type == "rich_text":
        return "".join(part.get("plain_text", "") for part in prop.get("rich_text", [])).strip()
    if prop_type == "select":
        return str((prop.get("select") or {}).get("name") or "")
    if prop_type == "status":
        return str((prop.get("status") or {}).get("name") or "")
    if prop_type == "url":
        return str(prop.get("url") or "")
    if prop_type == "number":
        return str(prop.get("number") or "")
    return ""


def source_raw_text(source: object) -> str:
    if isinstance(source, dict):
        return str(source.get("summary") or source.get("text") or "")
    return str(getattr(source, "extracted_text", "") or getattr(source, "text", "") or "")


def parse_notion_properties_from_source(source: object) -> dict:
    text = source_raw_text(source)
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return {}


def write_notion_gantt_sources_to_calendar(profile: IntegrationProfile, sources: list[object], connection: dict, dry_run: bool = False) -> dict:
    calendar_id = str(connection.get("url") or profile.base_url or "primary")
    events: list[dict] = []
    skipped: list[dict] = []
    for source in sources:
        properties = parse_notion_properties_from_source(source)
        date_prop = properties.get("날짜") or properties.get("Date") or properties.get("date") or {}
        date_value = date_prop.get("date") if date_prop.get("type") == "date" else None
        title = notion_property_title(properties) or (source.get("title", "") if isinstance(source, dict) else getattr(source, "title", "")) or "Notion 일정"
        title = re.sub(r"^\[[^\]]+\]\s+", "", title).strip() or title
        if not date_value or not date_value.get("start"):
            skipped.append({"title": title, "reason": "missing Notion 날짜 property"})
            continue
        status = notion_property_text(properties, "상태")
        notion_url = source.get("url", "") if isinstance(source, dict) else getattr(source, "file_name", "")
        body = "\n".join(part for part in [f"Notion GANTT 상태: {status}" if status else "Notion GANTT 일정", f"Notion 링크: {notion_url}" if notion_url else ""] if part)
        write = write_calendar_event_at(
            profile,
            title,
            body,
            date_value.get("start", ""),
            date_value.get("end") or date_value.get("start", ""),
            dry_run=dry_run,
            target_url=calendar_id,
        )
        write["sourceTitle"] = title
        events.append(write)
    return {
        "service": "google_calendar",
        "status": "written" if any(item.get("status") == "written" for item in events) else "ready" if dry_run and events else "skipped",
        "operation": "create_events_from_notion_gantt",
        "calendarId": calendar_id,
        "count": len(events),
        "events": events,
        "skipped": skipped,
        "dryRun": dry_run,
    }


def verify_hmac_signature(secret: str, body: bytes, signature: str, prefix: str = "sha256=") -> bool:
    if not secret:
        return True
    if not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    supplied = signature.removeprefix(prefix)
    return hmac.compare_digest(expected, supplied)


def notion_webhook_target_matches(target: str, candidate: str) -> bool:
    target = target.strip()
    candidate = candidate.strip()
    if not target or not candidate:
        return False
    target_id = extract_notion_id(target)
    candidate_id = extract_notion_id(candidate)
    target_is_id = bool(re.fullmatch(r"[0-9a-fA-F]{32}", target_id))
    candidate_is_id = bool(re.fullmatch(r"[0-9a-fA-F]{32}", candidate_id))
    if target_is_id and candidate_is_id:
        return target_id.lower() == candidate_id.lower()
    return target in candidate or candidate in target


def notion_webhook_targets(payload: object) -> list[str]:
    targets: list[str] = []
    target_keys = {"database_url", "database_id", "page_url", "page_id", "url", "id"}

    def visit(value: object, key: str = "") -> None:
        if isinstance(value, dict):
            for nested_key, nested_value in value.items():
                visit(nested_value, str(nested_key).lower())
            return
        if isinstance(value, list):
            for item in value:
                visit(item, key)
            return
        if key in target_keys and value is not None:
            target = str(value).strip()
            if target:
                targets.append(target)

    visit(payload)
    return list(dict.fromkeys(targets))


def github_webhook_repo_matches(repo_url: str, candidate: str) -> bool:
    repo = parse_github_repo(repo_url.strip())
    candidate_repo = parse_github_repo(candidate.strip())
    if not repo or not candidate_repo:
        return False
    return tuple(part.lower() for part in repo) == tuple(part.lower() for part in candidate_repo)


def github_webhook_repos(payload: dict) -> list[str]:
    repository = payload.get("repository") if isinstance(payload, dict) else None
    if not isinstance(repository, dict):
        return []
    targets: list[str] = []
    for key in ["html_url", "clone_url", "ssh_url", "git_url"]:
        value = str(repository.get(key) or "").strip()
        if value:
            targets.append(value)
    full_name = str(repository.get("full_name") or "").strip().strip("/")
    if re.fullmatch(r"[^/\s]+/[^/\s]+", full_name):
        targets.append(f"https://github.com/{full_name}")
    return list(dict.fromkeys(targets))


def github_webhook_collected_items(payload: dict) -> list[CollectedItem]:
    repository = payload.get("repository") if isinstance(payload, dict) else {}
    repo_url = str(repository.get("html_url") or "").rstrip("/")
    commits = payload.get("commits") if isinstance(payload, dict) else []
    if not isinstance(commits, list):
        return []
    items: list[CollectedItem] = []
    for commit in commits[:50]:
        if not isinstance(commit, dict):
            continue
        sha = str(commit.get("id") or commit.get("sha") or "")[:12]
        message = str(commit.get("message") or "").strip()
        author = commit.get("author") if isinstance(commit.get("author"), dict) else {}
        author_name = str(author.get("name") or author.get("username") or "").strip()
        url = str(commit.get("url") or (f"{repo_url}/commit/{sha}" if repo_url and sha else "")).strip()
        first_line = message.splitlines()[0] if message else "no message"
        text = "\n".join(
            part
            for part in [
                message,
                f"sha: {sha}" if sha else "",
                f"author: {author_name}" if author_name else "",
                f"url: {url}" if url else "",
            ]
            if part
        )
        items.append(
            CollectedItem(
                title=f"Webhook commit {sha}: {first_line}" if sha else f"Webhook commit: {first_line}",
                source_type="github_webhook_commit",
                url=url or f"webhook://github/{sha or len(items) + 1}",
                text=text,
                tags=["github", "webhook", "commit"],
            )
        )
    return items


async def extract_upload_text(upload: UploadFile | None) -> tuple[str, str, str]:
    if upload is None:
        return "", "", ""
    raw = await upload.read()
    mime_type = upload.content_type or ""
    file_name = upload.filename or ""
    if mime_type.startswith("text/") or file_name.lower().endswith((".txt", ".md", ".csv", ".json", ".jsonl", ".log")):
        text = raw[:20000].decode("utf-8-sig", errors="ignore")
        normalized, is_taskory = normalize_taskory_export(text, file_name)
        if is_taskory:
            return file_name, mime_type or "application/json", normalized
        return file_name, mime_type, text
    return file_name, mime_type, f"[{mime_type or 'binary'} 파일: {file_name}] 파일 이름과 메타데이터를 RAG 근거로 사용합니다."


def serialize_post(post: Post) -> dict:
    return {
        "id": post.id,
        "title": post.title,
        "content": post.content,
        "summary": post.summary,
        "status": post.status,
        "automationTaskId": post.automation_task_id,
        "automationTemplate": serialize_automation_template(post.automation_task),
        "author": {"name": post.author.name, "role": post.author.role},
        "tags": [{"tag": {"name": tag.name}} for tag in post.tags],
        "comments": [{"id": c.id, "content": c.content, "author": {"name": c.author.name, "role": c.author.role}} for c in post.comments],
        "createdAt": str(post.created_at),
    }


def serialize_task(task: AutomationTask) -> dict:
    custom_connections = parse_connections(task.custom_connections)
    return {
        "id": task.id,
        "name": task.name,
        "owner": serialize_user(task.owner),
        "integrationProfileId": task.integration_profile_id,
        "integrationProfile": serialize_integration_profile(task.integration_profile) if task.integration_profile else None,
        "source": task.source,
        "destination": task.destination,
        "intervalMinutes": task.interval_minutes,
        "instruction": task.instruction,
        "template": task.template,
        "apiProvider": task.api_provider,
        "aiAgent": task.ai_agent,
        "githubRepoUrl": task.github_repo_url,
        "githubProjectUrl": task.github_project_url,
        "notionDatabaseUrl": task.notion_database_url,
        "figmaFileUrl": task.figma_file_url,
        "calendarId": task.calendar_id,
        "aiProvider": task.ai_provider,
        "aiModel": task.ai_model,
        "aiApiBase": task.ai_api_base,
        "apiKeyStrategy": task.api_key_strategy,
        "requestTemplate": task.request_template,
        "githubIssueTemplate": task.github_issue_template,
        "notionTemplate": task.notion_template,
        "figmaTemplate": task.figma_template,
        "templatePreset": task.template_preset,
        "customTemplate": task.custom_template,
        "customConnections": custom_connections,
        "status": task.status,
        "lastResult": task.last_result,
        "lastInputHash": task.last_input_hash,
        "lastRunAt": str(task.last_run_at) if task.last_run_at else None,
        "createdAt": str(task.created_at),
        "runs": [serialize_run(run) for run in task.runs[-5:]],
    }


@app.get("/api/health", response_model=None)
def health() -> dict | JSONResponse:
    if STARTUP_DB_ERROR:
        recovered, _ = ensure_database_ready()
        if recovered:
            return {"ok": True, "stack": "React + FastAPI + PostgreSQL + Redis", "docs": "/docs", "database": check_db()}
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "stack": "React + FastAPI + PostgreSQL + Redis",
                "docs": "/docs",
                "database": {"ok": False, "error": STARTUP_DB_ERROR},
            },
        )
    try:
        database = check_db()
    except SQLAlchemyError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "stack": "React + FastAPI + PostgreSQL + Redis",
                "docs": "/docs",
                "database": {"ok": False, "error": f"{exc.__class__.__name__}: {str(exc).splitlines()[0][:240]}"},
            },
        )
    return {"ok": True, "stack": "React + FastAPI + PostgreSQL + Redis", "docs": "/docs", "database": database}


@app.post("/api/auth/register")
def register(data: RegisterIn, db: Session = Depends(get_db)) -> dict:
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다.")
    user = User(email=data.email, name=data.name, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": create_token(user), "user": serialize_user(user)}


@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)) -> dict:
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    return {"token": create_token(user), "user": serialize_user(user)}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"user": serialize_user(user), "profileSettings": serialize_profile_settings(user)}


@app.get("/api/profile/settings")
def get_profile_settings(user: User = Depends(current_user)) -> dict:
    return {"profileSettings": serialize_profile_settings(user)}


@app.put("/api/profile/settings")
def update_profile_settings(data: ProfileSettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.profile_ai_provider = data.ai_provider
    user.profile_ai_model = data.ai_model
    user.profile_ai_api_base = data.ai_api_base
    user.profile_api_key_strategy = data.api_key_strategy
    user.profile_template_preset = data.template_preset
    user.profile_custom_template = data.custom_template
    user.profile_custom_connections = json.dumps([item.model_dump() for item in data.custom_connections], ensure_ascii=False)
    db.commit()
    db.refresh(user)
    return {"profileSettings": serialize_profile_settings(user)}


@app.get("/api/system/settings")
def get_system_settings(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return {"systemSettings": serialize_system_settings(db)}


@app.put("/api/system/settings")
def update_system_settings(data: SystemSettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="관리자만 시스템 설정을 수정할 수 있습니다.")
    upsert_system_setting(db, "public_base_url", data.public_base_url)
    db.commit()
    return {"systemSettings": serialize_system_settings(db)}


@app.get("/api/integration-profiles")
def list_integration_profiles(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profiles = db.scalars(
        select(IntegrationProfile).where(IntegrationProfile.owner_id == user.id).order_by(IntegrationProfile.created_at.desc())
    ).all()
    return {"profiles": [serialize_integration_profile(profile) for profile in profiles]}


@app.get("/api/oauth/status")
def oauth_status(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    providers = []
    for provider in ("github", "notion", "figma", "google_calendar"):
        config = oauth_provider_config(provider, request, db)
        providers.append(
            {
                "provider": provider,
                "configured": not config["missing"],
                "missing": config["missing"],
                "redirectUri": config["redirectUri"],
                "redirectUriSource": oauth_redirect_uri_source(provider, db),
                "mcpServerUrl": config["mcpServerUrl"],
                "setupUrl": config["setupUrl"],
                "scope": config["scope"],
                "baseUrl": config["baseUrl"],
                "apiProvider": config["apiProvider"],
            }
        )
    return {"providers": providers, "publicOrigin": public_origin_diagnostics(request, db), "systemSettings": serialize_system_settings(db)}


@app.get("/api/oauth/{provider}/start")
def start_oauth_login(provider: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    config = oauth_provider_config(provider, request, db)
    if config["missing"]:
        return {
            "provider": config["provider"],
            "configured": False,
            "message": f"{config['provider']} MCP 로그인은 서버 OAuth 앱 설정이 먼저 필요합니다.",
            "missing": config["missing"],
            "setupUrl": config["setupUrl"],
            "redirectUri": config["redirectUri"],
            "redirectUriSource": oauth_redirect_uri_source(config["provider"], db),
            "requiredEnv": {name: "" for name in config["missing"]},
        }
    state = sign_oauth_state(
        {
            "provider": config["provider"],
            "userId": user.id,
            "nonce": hashlib.sha256(os.urandom(16)).hexdigest()[:24],
            "exp": int(time.time()) + OAUTH_STATE_TTL_SECONDS,
        }
    )
    params = {
        "client_id": config["clientId"],
        "redirect_uri": config["redirectUri"],
        "response_type": "code",
        "state": state,
    }
    if config["provider"] in {"github", "figma", "google_calendar"}:
        params["scope"] = config["scope"]
    if config["provider"] == "notion":
        params["owner"] = "user"
    params.update(config.get("extraAuthorizeParams", {}))
    query = str(httpx.QueryParams(params))
    return {
        "provider": config["provider"],
        "configured": True,
        "authorizeUrl": f"{config['authorizeUrl']}?{query}",
        "redirectUri": config["redirectUri"],
        "redirectUriSource": oauth_redirect_uri_source(config["provider"], db),
        "expiresInSeconds": OAUTH_STATE_TTL_SECONDS,
    }


@app.get("/api/oauth/{provider}/callback")
def oauth_callback(provider: str, request: Request, code: str = "", state: str = "", db: Session = Depends(get_db)) -> HTMLResponse:
    if not code:
        raise HTTPException(status_code=400, detail="OAuth callback code is missing.")
    payload = read_oauth_state(state)
    config = oauth_provider_config(provider, request, db)
    if payload.get("provider") != config["provider"]:
        raise HTTPException(status_code=400, detail="OAuth provider state mismatch.")
    if config["missing"]:
        raise HTTPException(status_code=400, detail=f"OAuth 설정이 누락되었습니다: {', '.join(config['missing'])}")
    user = db.get(User, int(payload.get("userId", 0)))
    if not user:
        raise HTTPException(status_code=404, detail="OAuth state user was not found.")
    try:
        token_payload = exchange_oauth_code(config, code)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=400, detail=f"{config['provider']} OAuth token exchange failed: {exc.response.text[:240]}") from exc
    profile = upsert_oauth_profile(db, user, config, token_payload)
    db.flush()
    log_activity(
        db,
        user,
        "integration_profile.oauth_connected",
        config["provider"],
        "connected",
        f"{config['provider']} MCP OAuth login connected for {profile.mcp_auth_subject}.",
        {"profileId": profile.id, "mcpServerUrl": profile.mcp_server_url, "scopes": parse_string_list(profile.mcp_scopes_json)},
        profile_id=profile.id,
    )
    db.commit()
    target = f"/?oauth=connected&provider={config['provider']}&profile={profile.id}"
    html = f"""<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta http-equiv="refresh" content="1; url={target}"><title>AI Board MCP OAuth</title></head>
<body>
<p>{config['provider']} MCP OAuth 연결이 완료되었습니다. AI Board로 돌아갑니다.</p>
<p><a href="{target}">돌아가기</a></p>
</body>
</html>"""
    return HTMLResponse(html)


@app.get("/api/provider-readiness")
def list_provider_readiness(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return {"providers": provider_readiness(user, db)}


@app.get("/api/webhook-readiness")
def list_webhook_readiness(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return {
        "webhooks": webhook_readiness(request, db),
        "publicOrigin": public_origin_diagnostics(request, db),
    }


@app.get("/api/integration-activities")
def list_integration_activities(
    provider: str = "",
    status: str = "",
    event_type: str = "",
    automation_task_id: int | None = None,
    integration_profile_id: int | None = None,
    dry_run: bool | None = None,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    filters = [IntegrationActivity.owner_id == user.id]
    if provider:
        filters.append(IntegrationActivity.provider == provider)
    if status:
        filters.append(IntegrationActivity.status == status)
    if event_type:
        filters.append(IntegrationActivity.event_type == event_type)
    if automation_task_id is not None:
        filters.append(IntegrationActivity.automation_task_id == automation_task_id)
    if integration_profile_id is not None:
        filters.append(IntegrationActivity.integration_profile_id == integration_profile_id)
    if dry_run is not None:
        filters.append(IntegrationActivity.details_json.contains(f'"dryRun": {str(dry_run).lower()}'))
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(0, offset)
    total = db.scalar(select(func.count()).select_from(IntegrationActivity).where(*filters)) or 0
    stmt = (
        select(IntegrationActivity)
        .where(*filters)
        .order_by(IntegrationActivity.created_at.desc(), IntegrationActivity.id.desc())
        .offset(safe_offset)
        .limit(safe_limit)
    )
    activities = [serialize_activity(activity) for activity in db.scalars(stmt).all()]
    next_offset = safe_offset + len(activities)
    return {
        "activities": activities,
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "nextOffset": next_offset,
        "hasMore": next_offset < total,
    }


@app.post("/api/integration-profiles")
def create_integration_profile(data: IntegrationProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = IntegrationProfile(
        owner_id=user.id,
        name=data.name,
        source_kind=data.source_kind,
        base_url=data.base_url,
        api_provider=data.api_provider,
        token_name=data.token_name,
        token_value=protect_secret(data.token_value),
        auth_type=data.auth_type,
        mcp_server_url=data.mcp_server_url,
        mcp_auth_subject=data.mcp_auth_subject,
        mcp_scopes_json=json.dumps(data.mcp_scopes, ensure_ascii=False),
        ai_provider=data.ai_provider,
        ai_model=data.ai_model,
        ai_api_base=data.ai_api_base,
        rag_targets_json=json.dumps(data.rag_targets, ensure_ascii=False),
        collect_limit=max(1, min(data.collect_limit, 100)),
        collect_pages=max(1, min(data.collect_pages, 5)),
        custom_connections=json.dumps([item.model_dump() for item in data.custom_connections], ensure_ascii=False),
        custom_template=data.custom_template,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    log_activity(
        db,
        user,
        "integration_profile.created",
        profile.source_kind,
        "ok",
        f"Saved integration profile {profile.name}",
        {"profile": serialize_integration_profile(profile)},
        profile_id=profile.id,
    )
    db.commit()
    return {"profile": serialize_integration_profile(profile)}


@app.delete("/api/integration-profiles/{profile_id}")
def delete_integration_profile(profile_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = db.get(IntegrationProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="연동 프로필을 찾을 수 없습니다.")
    if profile.owner_id != user.id:
        raise HTTPException(status_code=403, detail="다른 사용자의 연동 프로필은 사용할 수 없습니다.")
    db.delete(profile)
    db.commit()
    return {"ok": True}


@app.post("/api/integration-profiles/{profile_id}/collect")
def collect_integration_profile(profile_id: int, limit: int | None = None, pages: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = db.get(IntegrationProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="연동 프로필을 찾을 수 없습니다.")
    if profile.owner_id != user.id:
        raise HTTPException(status_code=403, detail="다른 사용자의 연동 프로필은 수집할 수 없습니다.")
    safe_limit = max(1, min(limit if limit is not None else profile.collect_limit, 100))
    safe_pages = max(1, min(pages if pages is not None else profile.collect_pages, 5))
    items, warnings = collect_profile_items(profile, limit=safe_limit, pages=safe_pages)
    saved = save_collected_items(db, user, profile, items) if items else []
    status = "collected" if saved else "unchanged" if items else "no-data"
    skipped_duplicates = max(len(items) - len(saved), 0)
    profile.last_collect_status = status
    profile.last_collect_count = len(items)
    profile.last_collect_saved = len(saved)
    profile.last_collect_duplicates = skipped_duplicates
    profile.last_collect_warnings = json.dumps(warnings, ensure_ascii=False)
    profile.last_collected_at = datetime.now(timezone.utc)
    db.add(profile)
    log_activity(
        db,
        user,
        "integration_profile.collect",
        profile.source_kind,
        status,
        f"Collected {len(items)} items, saved {len(saved)}, skipped {skipped_duplicates}",
        {"warnings": warnings, "limit": safe_limit, "pages": safe_pages, "saved": len(saved), "collected": len(items)},
        profile_id=profile.id,
    )
    db.commit()
    db.refresh(profile)
    return {
        "profile": serialize_integration_profile(profile),
        "collected": len(items),
        "saved": [serialize_knowledge(source) for source in saved],
        "skippedDuplicates": skipped_duplicates,
        "warnings": warnings,
        "status": status,
        "request": {"limit": safe_limit, "pages": safe_pages},
    }


@app.post("/api/integration-profiles/{profile_id}/validate")
def validate_integration_profile(profile_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = db.get(IntegrationProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="연동 프로필을 찾을 수 없습니다.")
    if profile.owner_id != user.id:
        raise HTTPException(status_code=403, detail="다른 사용자의 연동 프로필은 검증할 수 없습니다.")
    result = validate_integration_profile_credentials(profile)
    log_activity(
        db,
        user,
        "integration_profile.validate",
        result.get("service") or profile.source_kind,
        result.get("status", "unknown"),
        f"{profile.name} credential validation {result.get('status', 'unknown')}: {result.get('message', '')}",
        {key: value for key, value in result.items() if key not in {"target"}},
        profile_id=profile.id,
    )
    db.commit()
    return {"profile": serialize_integration_profile(profile), "validation": result}


@app.post("/api/integration-profiles/{profile_id}/write")
def write_integration_profile(profile_id: int, data: LiveWriteIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = db.get(IntegrationProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="연동 프로필을 찾을 수 없습니다.")
    if profile.owner_id != user.id:
        raise HTTPException(status_code=403, detail="다른 사용자의 연동 프로필은 실행할 수 없습니다.")
    if not data.dry_run and data.confirmation.strip() != "WRITE LIVE":
        raise HTTPException(status_code=400, detail="Actual external writes require confirmation text WRITE LIVE.")
    result = execute_profile_write(
        profile,
        title=data.title,
        body=data.body,
        dry_run=data.dry_run,
        start_minutes_from_now=data.start_minutes_from_now,
        duration_minutes=data.duration_minutes,
    )
    log_activity(
        db,
        user,
        "integration_profile.write",
        profile.source_kind,
        result.get("status", "unknown"),
        f"{profile.source_kind} live write {result.get('status', 'unknown')} for {profile.name}",
        {**{key: value for key, value in result.items() if key != "payload"}, "dryRun": data.dry_run},
        profile_id=profile.id,
    )
    db.commit()
    return {"profile": serialize_integration_profile(profile), "write": result}


@app.get("/api/posts")
def list_posts(q: str = "", page: int = 1, limit: int = 8, offset: int | None = None, kind: str = "all", db: Session = Depends(get_db)) -> dict:
    safe_limit = max(1, min(limit, 50))
    safe_offset = max(0, offset if offset is not None else (max(page, 1) - 1) * safe_limit)
    safe_kind = kind if kind in {"all", "board", "automation"} else "all"
    posts, total = search_posts(db, q, safe_offset, safe_limit, safe_kind)
    next_offset = safe_offset + len(posts)
    return {
        "posts": [serialize_post(post) for post in posts],
        "total": total,
        "page": (safe_offset // safe_limit) + 1,
        "take": safe_limit,
        "limit": safe_limit,
        "offset": safe_offset,
        "nextOffset": next_offset,
        "hasMore": next_offset < total,
    }


@app.post("/api/posts")
def create_post(data: PostIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    review = agent_review(db, data.title, data.content)
    post = Post(
        title=data.title,
        content=data.content,
        summary=summarize(data.title, data.content),
        status="HELD" if review["decision"] == "hold" else "PUBLISHED",
        author_id=user.id,
    )
    post.tags = get_or_create_tags(db, data.tags + review.get("suggestedTags", []))
    db.add(post)
    db.commit()
    db.refresh(post)
    return {"post": serialize_post(post), "moderation": review}


@app.post("/api/posts/{post_id}/comments")
def add_comment(post_id: int, data: CommentIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    if not db.get(Post, post_id):
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    comment = Comment(post_id=post_id, author_id=user.id, content=data.content)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {"comment": {"id": comment.id, "content": comment.content}}


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    post = db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    if post.author_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    db.delete(post)
    db.commit()
    return {"ok": True}


@app.get("/api/knowledge")
def list_knowledge(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    stmt = select(KnowledgeSource).where(KnowledgeSource.owner_id == user.id).order_by(KnowledgeSource.created_at.desc())
    sources = db.scalars(stmt).all()
    return {"sources": [serialize_knowledge(source) for source in sources]}


@app.post("/api/knowledge")
def create_knowledge(data: KnowledgeIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    source = KnowledgeSource(
        owner_id=user.id,
        title=data.title,
        source_type=data.source_type,
        instruction=data.instruction,
        extracted_text=data.extracted_text,
        tags_json=json.dumps(data.tags, ensure_ascii=False),
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return {"source": serialize_knowledge(source), "rag": rag_answer(db, data.title, user.id)}


@app.post("/api/knowledge/upload")
async def upload_knowledge(
    title: str = Form(...),
    source_type: str = Form("document"),
    instruction: str = Form(""),
    tags: str = Form(""),
    file: UploadFile | None = File(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    file_name, mime_type, extracted = await extract_upload_text(file)
    tag_list = [tag.strip().removeprefix("#") for tag in tags.split(",") if tag.strip()]
    source = KnowledgeSource(
        owner_id=user.id,
        title=title,
        source_type=source_type,
        file_name=file_name,
        mime_type=mime_type,
        instruction=instruction,
        extracted_text=extracted,
        tags_json=json.dumps(tag_list, ensure_ascii=False),
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return {"source": serialize_knowledge(source), "rag": rag_answer(db, f"{title}\n{instruction}\n{extracted}", user.id)}


@app.post("/api/ai/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: str = Form("whisper-1"),
    prompt: str = Form(""),
    integration_profile_id: int | None = Form(None),
    save_to_knowledge: bool = Form(False),
    title: str = Form(""),
    instruction: str = Form(""),
    tags: str = Form("audio,transcription,openai"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    api_key, api_base, profile_id, profile_name = find_user_openai_credentials(db, user, integration_profile_id)
    result = await transcribe_audio_with_openai(api_key, api_base, file, model, prompt)
    result["integrationProfileId"] = profile_id
    result["integrationProfileName"] = profile_name
    if save_to_knowledge:
        source_title = title.strip() or Path(result["fileName"]).stem or "음성 전사"
        tag_list = [tag.strip().removeprefix("#") for tag in tags.split(",") if tag.strip()]
        source = KnowledgeSource(
            owner_id=user.id,
            title=source_title,
            source_type="audio",
            file_name=result["fileName"],
            mime_type=result["mimeType"],
            instruction=instruction.strip() or prompt.strip() or "OpenAI 음성 전사 결과를 RAG 지식자료로 사용합니다.",
            extracted_text=result["text"],
            tags_json=json.dumps(tag_list, ensure_ascii=False),
        )
        db.add(source)
        db.flush()
        result["source"] = serialize_knowledge(source)
        result["rag"] = rag_answer(db, f"{source.title}\n{source.instruction}\n{source.extracted_text}", user.id)
    log_activity(
        db,
        user,
        "ai.transcription",
        "openai",
        "completed",
        f"Transcribed {result['fileName']} with {result['model']} using {profile_name}",
        {
            "fileName": result["fileName"],
            "mimeType": result["mimeType"],
            "model": result["model"],
            "parts": result.get("parts", 1),
            "characters": len(result["text"]),
            "integrationProfileId": profile_id,
            "integrationProfileName": profile_name,
            "savedToKnowledge": save_to_knowledge,
            "sourceId": result.get("source", {}).get("id"),
        },
    )
    db.commit()
    return result


@app.delete("/api/knowledge/{source_id}")
def delete_knowledge(source_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    source = db.get(KnowledgeSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="지식 자료를 찾을 수 없습니다.")
    if source.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    db.delete(source)
    db.commit()
    return {"ok": True}


@app.get("/api/automations")
def list_automations(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    stmt = select(AutomationTask).order_by(AutomationTask.created_at.desc())
    if user.role != "ADMIN":
        stmt = stmt.where(AutomationTask.owner_id == user.id)
    tasks = db.scalars(stmt).all()
    return {"tasks": [serialize_task(task) for task in tasks]}


@app.post("/api/automations")
def create_automation(data: AutomationIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    selected_profile = db.get(IntegrationProfile, data.integration_profile_id) if data.integration_profile_id else None
    if selected_profile and selected_profile.owner_id != user.id:
        raise HTTPException(status_code=403, detail="다른 사용자의 연동 프로필은 자동화에 사용할 수 없습니다.")
    custom_connections = data.custom_connections
    custom_template = data.custom_template
    ai_provider = data.ai_provider
    ai_model = data.ai_model
    ai_api_base = data.ai_api_base
    api_provider = data.api_provider
    api_key_strategy = data.api_key_strategy
    custom_connections = connection_dicts(custom_connections)
    if selected_profile:
        ai_provider = selected_profile.ai_provider
        ai_model = selected_profile.ai_model
        ai_api_base = selected_profile.ai_api_base
        api_provider = selected_profile.api_provider
        api_key_strategy = f"사용자별 연동 프로필 '{selected_profile.name}'의 {selected_profile.token_name or '토큰'} 사용"
        custom_template = selected_profile.custom_template or custom_template
        profile_connections = parse_connections(selected_profile.custom_connections)
        if profile_connections:
            custom_connections = merge_connection_lists(profile_connections, custom_connections)
    task = AutomationTask(
        name=data.name,
        integration_profile_id=selected_profile.id if selected_profile else None,
        owner_id=user.id,
        source=data.source,
        destination=data.destination,
        interval_minutes=data.interval_minutes,
        instruction=data.instruction,
        template=data.template,
        api_provider=api_provider,
        ai_agent=data.ai_agent,
        github_repo_url=data.github_repo_url,
        github_project_url=data.github_project_url,
        notion_database_url=data.notion_database_url,
        figma_file_url=data.figma_file_url,
        calendar_id=data.calendar_id,
        ai_provider=ai_provider,
        ai_model=ai_model,
        ai_api_base=ai_api_base,
        api_key_strategy=api_key_strategy,
        request_template=data.request_template,
        github_issue_template=data.github_issue_template,
        notion_template=data.notion_template,
        figma_template=data.figma_template,
        template_preset=data.template_preset,
        custom_template=custom_template,
        custom_connections=json.dumps(custom_connections, ensure_ascii=False),
        status=data.status,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    log_activity(
        db,
        user,
        "automation.created",
        task.api_provider,
        "ok",
        f"Created automation {task.name}",
        {"taskId": task.id, "route": f"{task.source} -> {task.destination}", "agent": task.ai_agent},
        task_id=task.id,
        profile_id=task.integration_profile_id,
    )
    db.commit()
    return {"task": serialize_task(task), "plan": automation_plan(task)}


def task_due(task: AutomationTask, now: datetime | None = None) -> bool:
    if task.status != "ACTIVE":
        return False
    if not task.last_run_at:
        return True
    current_time = now or datetime.now(timezone.utc)
    last_run = task.last_run_at
    if last_run.tzinfo is None:
        last_run = last_run.replace(tzinfo=timezone.utc)
    return last_run + timedelta(minutes=max(task.interval_minutes, 1)) <= current_time


def serialize_collected_source(source: KnowledgeSource) -> dict:
    return {
        "id": source.id,
        "title": source.title,
        "sourceType": source.source_type,
        "url": source.file_name,
        "summary": source.extracted_text,
    }


WATCHED_AUTOMATION_FIELDS = [
    "source",
    "integration_profile_id",
    "destination",
    "instruction",
    "template",
    "api_provider",
    "ai_agent",
    "github_repo_url",
    "github_project_url",
    "notion_database_url",
    "figma_file_url",
    "calendar_id",
    "ai_provider",
    "ai_model",
    "ai_api_base",
    "request_template",
    "github_issue_template",
    "notion_template",
    "figma_template",
    "template_preset",
    "custom_template",
    "custom_connections",
]


def is_ai_board_generated_source(item: CollectedItem) -> bool:
    if item.source_type != "github_issue":
        return False
    tags = {tag.lower() for tag in item.tags}
    text = f"{item.title}\n{item.text}".lower()
    return (
        {"ai-board", "automation"} <= tags
        and ("[ai board]" in text or "automation:" in text or "route:" in text)
    )


def filter_automation_loop_sources(items: list[CollectedItem]) -> tuple[list[CollectedItem], int]:
    filtered = [item for item in items if not is_ai_board_generated_source(item)]
    return filtered, len(items) - len(filtered)


def execute_automation_task(
    db: Session,
    task: AutomationTask,
    actor: User,
    scheduled: bool = False,
    external_items: list[CollectedItem] | None = None,
    external_event_key: str = "",
) -> dict:
    collected: list[dict] = []
    collection_warnings: list[str] = []
    saved_sources: list[KnowledgeSource] = []
    report_sources: list[object] = []
    if task.integration_profile:
        limit = max(1, min(task.integration_profile.collect_limit, 100))
        pages = max(1, min(task.integration_profile.collect_pages, 5))
        if external_items:
            items = external_items
            collection_warnings = []
        else:
            items, collection_warnings = collect_profile_items(task.integration_profile, limit=limit, pages=pages)
        items, filtered_loop_items = filter_automation_loop_sources(items)
        if filtered_loop_items:
            collection_warnings.append(f"AI Board가 생성한 자동화 이슈 {filtered_loop_items}개를 루프 방지용으로 제외했습니다.")
        saved_sources = save_collected_items(db, actor, task.integration_profile, items) if items else []
        raw_report_sources = [
            ReportSource(
                title=f"[{task.integration_profile.name}] {item.title}" if external_items or external_event_key else item.title,
                source_type=item.source_type,
                sourceType=item.source_type,
                url=item.url,
                file_name=item.url,
                extracted_text=item.text,
                summary=item.text,
            )
            for item in items
        ]
        needs_raw_report_sources = any(
            str(connection.get("service", "")).lower() == "google_calendar"
            and "gantt" in str(connection.get("operation", "")).lower()
            for connection in parse_connections(task.custom_connections)
        )
        report_sources = raw_report_sources if needs_raw_report_sources or not saved_sources else saved_sources
        collected = [serialize_collected_source(source) for source in saved_sources]
        task.integration_profile.last_collect_status = "collected" if saved_sources else "unchanged" if items else "no-data"
        task.integration_profile.last_collect_count = len(items)
        task.integration_profile.last_collect_saved = len(saved_sources)
        task.integration_profile.last_collect_duplicates = max(len(items) - len(saved_sources), 0)
        task.integration_profile.last_collect_warnings = json.dumps(collection_warnings, ensure_ascii=False)
        task.integration_profile.last_collected_at = datetime.now(timezone.utc)
        log_activity(
            db,
            actor,
            "integration_profile.collect",
            task.integration_profile.source_kind,
            task.integration_profile.last_collect_status,
            f"Automation {task.name} collected {len(saved_sources)} new RAG items",
            {"taskId": task.id, "collected": len(items), "saved": len(saved_sources), "warnings": collection_warnings, "externalEvent": bool(external_items)},
            task_id=task.id,
            profile_id=task.integration_profile_id,
        )
    source_change_urls = []
    if task.integration_profile:
        source_change_urls = [source.url for source in items if source.url]
    external_change_key = "|".join(sorted(source_change_urls + ([external_event_key] if external_event_key else [])))
    current_hash = hashlib.sha256(f"{automation_fingerprint(task)}|{external_change_key}".encode("utf-8")).hexdigest()
    base_plan = automation_plan(task)
    if task.last_input_hash == current_hash:
        result = {
            "taskId": task.id,
            "agent": task.ai_agent,
            "targets": base_plan.get("targets", []),
            "status": "skipped",
            "reason": "Watched automation input did not change since the previous run.",
            "aiCallPolicy": "skipped: no watched input change, so no AI/model call or live write is allowed.",
            "changeHash": current_hash,
            "scheduled": scheduled,
            "watchedFields": WATCHED_AUTOMATION_FIELDS,
            "collected": collected,
            "collectionWarnings": collection_warnings,
        }
        task.last_result = result_to_text(result)
        task.last_run_at = datetime.now(timezone.utc)
        log_activity(
            db,
            actor,
            "automation.run",
            task.api_provider,
            "skipped",
            f"Skipped automation {task.name}: no watched input changes",
            {"taskId": task.id, "changeHash": current_hash, "scheduled": scheduled},
            task_id=task.id,
            profile_id=task.integration_profile_id,
        )
        db.commit()
        return {"task": serialize_task(task), "run": {"id": None, "result": result, "createdPostId": None}}
    watched_profile_without_data = (
        task.integration_profile is not None
        and task.integration_profile.source_kind in {"github", "notion"}
        and not report_sources
        and not external_event_key
    )
    if watched_profile_without_data:
        result = {
            "taskId": task.id,
            "agent": task.ai_agent,
            "targets": base_plan.get("targets", []),
            "status": "no-data",
            "reason": "No GitHub/Notion source changes were collected, so no AI/model call or live write was performed.",
            "aiCallPolicy": "skipped: no collected source items.",
            "changeHash": current_hash,
            "scheduled": scheduled,
            "watchedFields": WATCHED_AUTOMATION_FIELDS,
            "collected": collected,
            "collectionWarnings": collection_warnings,
            "liveWrites": [],
        }
        task.last_result = result_to_text(result)
        task.last_input_hash = current_hash
        task.last_run_at = datetime.now(timezone.utc)
        run = AutomationRun(task_id=task.id, owner_id=task.owner_id, result=task.last_result)
        db.add(run)
        log_activity(
            db,
            actor,
            "automation.run",
            task.api_provider,
            "no-data",
            f"Skipped live writes for {task.name}: no collected source changes",
            {"taskId": task.id, "changeHash": current_hash, "scheduled": scheduled},
            task_id=task.id,
            profile_id=task.integration_profile_id,
        )
        db.commit()
        db.refresh(run)
        return {"task": serialize_task(task), "run": {"id": run.id, "result": result, "createdPostId": None}}
    result = base_plan
    result["status"] = "changed"
    result["aiCallPolicy"] = "local deterministic summary only unless a configured model call is explicitly added later."
    result["changeHash"] = current_hash
    result["scheduled"] = scheduled
    result["collected"] = collected
    result["collectionWarnings"] = collection_warnings
    result["liveWrites"] = []
    custom_connections = parse_connections(task.custom_connections)
    source_urls = [source.file_name for source in saved_sources]
    summary = summarize(task.name, "\n".join([source.extracted_text for source in saved_sources]) or task.instruction)
    write_body = automation_write_body(task, summary, source_urls)
    for connection in custom_connections:
        service = str(connection.get("service", "")).lower()
        operation = str(connection.get("operation", "")).lower()
        read_only_operation = any(key in operation for key in ["read_", "rag_collect", "collect_", "query_", "search_"])
        should_write = (
            (service == "notion" and not read_only_operation)
            or service in {"figma", "google_calendar"}
            or (service == "github" and any(key in operation for key in ["issue_create", "create_issue", "issue_create_or_update"]))
        )
        if not should_write:
            continue
        profile = profile_for_service(db, actor, task, service)
        if not profile:
            write = {"service": service, "status": "blocked", "reason": f"No user-owned {service} integration profile with a token is available.", "dryRun": False}
        else:
            original_base_url = profile.base_url
            profile.base_url = str(connection.get("url") or profile.base_url)
            if service == "notion" and report_sources:
                write = write_notion_sources_report(
                    profile,
                    f"[AI Board] {task.name} - 요청 템플릿 렌더링",
                    report_sources,
                    task_output_template(task),
                    dry_run=False,
                )
            elif service == "notion":
                write = {"service": "notion", "status": "skipped", "reason": "No new GitHub or Notion source items were collected for the template report.", "dryRun": False}
            elif service == "google_calendar" and "gantt" in operation:
                write = write_notion_gantt_sources_to_calendar(profile, report_sources, connection, dry_run=False)
            else:
                write = execute_profile_write(profile, f"[AI Board] {task.name}", write_body, dry_run=False)
            profile.base_url = original_base_url
        result["liveWrites"].append(write)
        log_activity(
            db,
            actor,
            "automation.live_write",
            service,
            write.get("status", "unknown"),
            f"Automation {task.name} {service} write {write.get('status', 'unknown')}",
            {"taskId": task.id, "operation": operation, "write": write},
            task_id=task.id,
            profile_id=profile.id if profile else task.integration_profile_id,
        )
    task.last_result = result_to_text(result)
    task.last_input_hash = current_hash
    task.last_run_at = datetime.now(timezone.utc)
    run = AutomationRun(task_id=task.id, owner_id=task.owner_id, result=task.last_result)
    db.add(run)
    log_activity(
        db,
        actor,
        "automation.run",
        task.api_provider,
        "changed",
        f"Ran automation {task.name}",
        {"taskId": task.id, "changeHash": current_hash, "targets": result.get("targets", []), "scheduled": scheduled},
        task_id=task.id,
        profile_id=task.integration_profile_id,
    )
    db.commit()
    db.refresh(run)
    return {"task": serialize_task(task), "run": {"id": run.id, "result": result, "createdPostId": None}}


@app.post("/api/automations/{task_id}/run")
def run_automation(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    task = db.get(AutomationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Automation task not found.")
    if task.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="You do not have permission to run this automation.")
    return execute_automation_task(db, task, user, scheduled=False)


def hydrate_collected_items(db: Session, collected_items: list[dict]) -> list[dict]:
    source_ids = [int(item["id"]) for item in collected_items if isinstance(item, dict) and str(item.get("id", "")).isdigit()]
    if not source_ids:
        return collected_items
    sources = {source.id: source for source in db.query(KnowledgeSource).filter(KnowledgeSource.id.in_(source_ids)).all()}
    hydrated: list[dict] = []
    for item in collected_items:
        if not isinstance(item, dict):
            hydrated.append(item)
            continue
        source = sources.get(int(item["id"])) if str(item.get("id", "")).isdigit() else None
        if source:
            merged = dict(item)
            merged.setdefault("title", source.title)
            merged.setdefault("sourceType", source.source_type)
            merged.setdefault("url", source.file_name)
            merged["summary"] = merged.get("summary") or source.extracted_text
            hydrated.append(merged)
        else:
            hydrated.append(item)
    return hydrated


@app.post("/api/automations/{task_id}/runs/{run_id}/replay-notion")
def replay_automation_run_to_notion(task_id: int, run_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    task = db.get(AutomationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Automation task not found.")
    if task.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="You do not have permission to replay this automation.")
    run = (
        db.query(AutomationRun)
        .filter(AutomationRun.id == run_id, AutomationRun.task_id == task.id, AutomationRun.owner_id == task.owner_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Automation run not found.")
    try:
        previous_result = json.loads(run.result or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Automation run result is not valid JSON.") from exc
    collected_items = previous_result.get("collected") or []
    if not collected_items:
        raise HTTPException(status_code=400, detail="This run has no collected items to replay.")
    collected_items = hydrate_collected_items(db, collected_items)
    profile = profile_for_service(db, task.owner, task, "notion")
    if not profile:
        raise HTTPException(status_code=400, detail="No user-owned Notion integration profile with a token is available.")
    connection = next((item for item in parse_connections(task.custom_connections) if str(item.get("service", "")).lower() == "notion"), {})
    original_base_url = profile.base_url
    profile.base_url = str(connection.get("url") or task.notion_database_url or profile.base_url)
    write = write_notion_sources_report(
        profile,
        f"[AI Board] {task.name} - run {run.id} 요청 템플릿 재전송",
        collected_items,
        task_output_template(task),
        dry_run=False,
    )
    profile.base_url = original_base_url
    replay_result = {
        "taskId": task.id,
        "sourceRunId": run.id,
        "status": write.get("status", "unknown"),
        "collected": collected_items,
        "liveWrites": [write],
    }
    task.last_result = result_to_text(replay_result)
    task.last_run_at = datetime.now(timezone.utc)
    replay_run = AutomationRun(task_id=task.id, owner_id=task.owner_id, result=task.last_result)
    db.add(replay_run)
    log_activity(
        db,
        user,
        "automation.replay_notion",
        "notion",
        write.get("status", "unknown"),
        f"Replayed automation run {run.id} to Notion with Korean UTF-8 table",
        {"taskId": task.id, "sourceRunId": run.id, "write": write},
        task_id=task.id,
        profile_id=profile.id,
    )
    db.commit()
    db.refresh(replay_run)
    return {"task": serialize_task(task), "run": {"id": replay_run.id, "result": replay_result, "createdPostId": None}}


@app.get("/api/automations/{task_id}/runs")
def list_automation_runs(
    task_id: int,
    limit: int = 10,
    offset: int = 0,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    task = db.get(AutomationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Automation task not found.")
    if task.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="You do not have permission to view this automation history.")
    safe_limit = max(1, min(limit, 50))
    safe_offset = max(0, offset)
    filters = [AutomationRun.task_id == task.id]
    total = db.scalar(select(func.count()).select_from(AutomationRun).where(*filters)) or 0
    stmt = (
        select(AutomationRun)
        .where(*filters)
        .order_by(AutomationRun.created_at.desc(), AutomationRun.id.desc())
        .offset(safe_offset)
        .limit(safe_limit)
    )
    runs = [serialize_run(run) for run in db.scalars(stmt).all()]
    next_offset = safe_offset + len(runs)
    return {
        "task": {"id": task.id, "name": task.name},
        "runs": runs,
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "nextOffset": next_offset,
        "hasMore": next_offset < total,
    }


@app.post("/api/automations/scheduler/tick")
def tick_automations(limit: int = 20, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    safe_limit = max(1, min(limit, 100))
    stmt = select(AutomationTask).where(AutomationTask.status == "ACTIVE").order_by(AutomationTask.created_at.asc())
    if user.role != "ADMIN":
        stmt = stmt.where(AutomationTask.owner_id == user.id)
    tasks = db.scalars(stmt.limit(200)).all()
    due_tasks = [task for task in tasks if task_due(task)][:safe_limit]
    results = [execute_automation_task(db, task, task.owner, scheduled=True) for task in due_tasks]
    return {
        "checked": len(tasks),
        "due": len(due_tasks),
        "limit": safe_limit,
        "results": [
            {
                "taskId": item["task"]["id"],
                "taskName": item["task"]["name"],
                "status": item["run"]["result"]["status"],
                "runId": item["run"]["id"],
            }
            for item in results
        ],
    }


@app.post("/api/webhooks/github")
async def github_webhook(
    request: Request,
    x_hub_signature_256: str = Header(default=""),
    x_github_event: str = Header(default=""),
    db: Session = Depends(get_db),
) -> dict:
    body = await request.body()
    if not verify_hmac_signature(settings().github_webhook_secret, body, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature.")
    payload = json.loads(body.decode("utf-8") or "{}")
    repo_urls = github_webhook_repos(payload)
    webhook_items = github_webhook_collected_items(payload)
    event_key = hashlib.sha256(
        "|".join(item.url for item in webhook_items).encode("utf-8")
        or body
    ).hexdigest()
    stmt = select(AutomationTask).where(AutomationTask.status == "ACTIVE")
    tasks = []
    for task in db.scalars(stmt).all():
        profile_target = task.integration_profile.base_url if task.integration_profile else ""
        if any(
            github_webhook_repo_matches(repo_url, task.github_repo_url) or github_webhook_repo_matches(repo_url, profile_target)
            for repo_url in repo_urls
        ):
            tasks.append(task)
    results = [
        execute_automation_task(
            db,
            task,
            task.owner,
            scheduled=True,
            external_items=webhook_items,
            external_event_key=f"github:{x_github_event}:{event_key}",
        )
        for task in tasks[:20]
    ]
    return {
        "ok": True,
        "provider": "github",
        "event": x_github_event,
        "repo": repo_urls[0] if repo_urls else "",
        "repos": repo_urls,
        "commits": len(webhook_items),
        "matched": len(tasks),
        "triggered": [
            {
                "taskId": item["task"]["id"],
                "runId": item["run"]["id"],
                "status": item["run"]["result"]["status"],
                "reason": item["run"]["result"].get("reason", ""),
            }
            for item in results
        ],
        "signatureRequired": bool(settings().github_webhook_secret),
    }


@app.post("/api/webhooks/notion")
async def notion_webhook(
    request: Request,
    x_ai_board_signature: str = Header(default=""),
    db: Session = Depends(get_db),
) -> dict:
    body = await request.body()
    if not verify_hmac_signature(settings().notion_webhook_secret, body, x_ai_board_signature):
        raise HTTPException(status_code=401, detail="Invalid Notion webhook signature.")
    payload = json.loads(body.decode("utf-8") or "{}")
    targets = notion_webhook_targets(payload)
    event_key = hashlib.sha256(
        "|".join(sorted(targets)).encode("utf-8")
        + b"|"
        + body
    ).hexdigest()
    stmt = select(AutomationTask).where(AutomationTask.status == "ACTIVE")
    tasks = []
    for task in db.scalars(stmt).all():
        task_target = task.notion_database_url.strip()
        profile_target = task.integration_profile.base_url.strip() if task.integration_profile else ""
        if any(
            notion_webhook_target_matches(target, task_target) or notion_webhook_target_matches(target, profile_target)
            for target in targets
        ):
            tasks.append(task)
    results = [
        execute_automation_task(
            db,
            task,
            task.owner,
            scheduled=True,
            external_event_key=f"notion:{event_key}",
        )
        for task in tasks[:20]
    ]
    return {
        "ok": True,
        "provider": "notion",
        "target": targets[0] if targets else "",
        "targets": targets,
        "matched": len(tasks),
        "triggered": [
            {
                "taskId": item["task"]["id"],
                "runId": item["run"]["id"],
                "status": item["run"]["result"]["status"],
                "reason": item["run"]["result"].get("reason", ""),
            }
            for item in results
        ],
        "signatureRequired": bool(settings().notion_webhook_secret),
    }


@app.post("/api/automations/{task_id}/share")
def share_automation(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    task = db.get(AutomationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Automation task not found.")
    if task.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="You do not have permission to share this automation.")
    result = task.last_result or result_to_text(automation_plan(task))
    content = f"""자동화 작업 공유

- 주기: {task.interval_minutes}분마다
- 경로: {task.source} -> {task.destination}
- 지침: {task.instruction}
- 템플릿: {task.template}
- API: {task.api_provider}
- AI Agent: {task.ai_agent}
- AI 모델: {task.ai_provider} / {task.ai_model}
- GitHub: {task.github_repo_url or task.github_project_url or "미설정"}
- Notion: {task.notion_database_url or "미설정"}
- Figma: {task.figma_file_url or "미설정"}
- Calendar: {task.calendar_id}
- API Key 전략: {task.api_key_strategy}
- 템플릿 선택: {task.template_preset}

커스텀 템플릿:
{task.custom_template}

커스텀 연결:
{task.custom_connections}

GitHub 이슈 템플릿:
{task.github_issue_template}

Notion 반영 템플릿:
{task.notion_template}

Figma 작업 템플릿:
{task.figma_template}

최근 실행 결과:
{result}
"""
    post = Post(title=f"[자동화] {task.name}", content=content, summary=summarize(task.name, content), author_id=user.id, automation_task_id=task.id)
    post.tags = get_or_create_tags(db, ["automation", "github", "notion", "agent"])
    db.add(post)
    log_activity(
        db,
        user,
        "automation.shared",
        task.api_provider,
        "ok",
        f"Shared automation {task.name} to board",
        {"taskId": task.id, "postTitle": post.title},
        task_id=task.id,
        profile_id=task.integration_profile_id,
    )
    db.commit()
    db.refresh(post)
    run = db.scalars(select(AutomationRun).where(AutomationRun.task_id == task.id).order_by(AutomationRun.created_at.desc())).first()
    if run:
        run.created_post_id = post.id
        db.commit()
    return {"post": serialize_post(post)}


@app.delete("/api/automations/{task_id}")
def delete_automation(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    task = db.get(AutomationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="자동화 작업을 찾을 수 없습니다.")
    if task.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    db.delete(task)
    db.commit()
    return {"ok": True}


@app.post("/api/ai/rag")
def rag(data: QuestionIn, db: Session = Depends(get_db)) -> dict:
    return rag_answer(db, data.question)


@app.post("/api/knowledge/rag")
def user_rag(data: QuestionIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return rag_answer(db, data.question, user.id)


@app.post("/api/ai/agent/moderate")
def agent(data: PostIn, db: Session = Depends(get_db)) -> dict:
    return agent_review(db, data.title, data.content)


@app.post("/api/integrations/hub/run")
async def hub_run(data: InstructionIn) -> dict:
    return await instruction_hub(data.instruction)


@app.post("/mcp/rpc")
async def mcp_rpc(payload: dict) -> dict:
    method = payload.get("method")
    if method == "weather.lookup":
        return {"jsonrpc": "2.0", "id": payload.get("id"), "result": {"location": "Seoul", "summary": "서울 기준 날씨 브리핑입니다.", "source": "demo-mcp"}}
    if method == "automation.describe":
        return {"jsonrpc": "2.0", "id": payload.get("id"), "result": {"summary": "자동화 작업의 주기, 경로, API, AI Agent를 설명합니다."}}
    return {"jsonrpc": "2.0", "id": payload.get("id"), "error": {"code": -32601, "message": "method not found"}}


def frontend_file_response(path: str = "") -> FileResponse:
    if not FRONTEND_INDEX.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found. Run npm run build first.")
    if path:
        requested = (FRONTEND_DIST / path).resolve()
        if FRONTEND_DIST in requested.parents and requested.is_file():
            return FileResponse(requested)
    return FileResponse(FRONTEND_INDEX)


if FRONTEND_ASSETS.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS), name="frontend-assets")


@app.get("/", include_in_schema=False)
def serve_frontend_root() -> FileResponse:
    return frontend_file_response()


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_spa(full_path: str) -> FileResponse:
    if full_path.startswith(("api/", "mcp/")):
        raise HTTPException(status_code=404, detail="API route not found.")
    return frontend_file_response(full_path)
