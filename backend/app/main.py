from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from .collectors import collect_profile_items, save_collected_items
from .db import get_db, init_db
from .models import AutomationRun, AutomationTask, Comment, IntegrationProfile, KnowledgeSource, Post, User
from .schemas import AutomationIn, CommentIn, IntegrationProfileIn, InstructionIn, KnowledgeIn, LoginIn, PostIn, ProfileSettingsIn, QuestionIn, RegisterIn
from .security import create_token, current_user, hash_password, protect_secret, reveal_secret, secret_preview, verify_password
from .services import agent_review, automation_fingerprint, automation_plan, get_or_create_tags, instruction_hub, rag_answer, result_to_text, search_posts, summarize

app = FastAPI(title="AI Board API", description="React + FastAPI + PostgreSQL + Redis AI board API.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup() -> None:
    init_db()


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
        "tokenStorage": "encrypted" if profile.token_value.startswith("enc:v1:") else "legacy" if profile.token_value else "empty",
        "aiProvider": profile.ai_provider,
        "aiModel": profile.ai_model,
        "aiApiBase": profile.ai_api_base,
        "ragTargets": parse_string_list(profile.rag_targets_json),
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
        for profile in profiles:
            connections = parse_connections(profile.custom_connections)
            has_connection = any(str(item.get("service", "")).lower() == key for item in connections)
            if profile.source_kind == key or has_connection:
                matches.append(profile)
        ready_profiles = [profile for profile in matches if reveal_secret(profile.token_value) and profile.base_url]
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
                    "hasUrl": bool(profile.base_url),
                    "tokenStorage": "encrypted" if profile.token_value.startswith("enc:v1:") else "legacy" if profile.token_value else "empty",
                    "customConnections": [item.get("service", "custom") for item in parse_connections(profile.custom_connections)],
                }
                for profile in matches
            ],
            "nextAction": "ready" if ready_profiles else f"Add an integration profile with {provider['requiredUrl']} and {provider['requiredToken']}.",
        })
    return results


async def extract_upload_text(upload: UploadFile | None) -> tuple[str, str, str]:
    if upload is None:
        return "", "", ""
    raw = await upload.read()
    mime_type = upload.content_type or ""
    file_name = upload.filename or ""
    if mime_type.startswith("text/") or file_name.lower().endswith((".txt", ".md", ".csv", ".json", ".log")):
        text = raw[:20000].decode("utf-8", errors="ignore")
        return file_name, mime_type, text
    return file_name, mime_type, f"[{mime_type or 'binary'} 파일: {file_name}] 파일 설명/작성 지침을 RAG 근거로 사용합니다."


def serialize_post(post: Post) -> dict:
    return {
        "id": post.id,
        "title": post.title,
        "content": post.content,
        "summary": post.summary,
        "status": post.status,
        "automationTaskId": post.automation_task_id,
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
        "runs": [{"id": run.id, "result": run.result, "createdPostId": run.created_post_id, "createdAt": str(run.created_at)} for run in task.runs[-5:]],
    }


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "stack": "React + FastAPI + PostgreSQL + Redis", "docs": "/docs"}


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


@app.get("/api/integration-profiles")
def list_integration_profiles(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profiles = db.scalars(
        select(IntegrationProfile).where(IntegrationProfile.owner_id == user.id).order_by(IntegrationProfile.created_at.desc())
    ).all()
    return {"profiles": [serialize_integration_profile(profile) for profile in profiles]}


@app.get("/api/provider-readiness")
def list_provider_readiness(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return {"providers": provider_readiness(user, db)}


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
        ai_provider=data.ai_provider,
        ai_model=data.ai_model,
        ai_api_base=data.ai_api_base,
        rag_targets_json=json.dumps(data.rag_targets, ensure_ascii=False),
        custom_connections=json.dumps([item.model_dump() for item in data.custom_connections], ensure_ascii=False),
        custom_template=data.custom_template,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
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
def collect_integration_profile(profile_id: int, limit: int = 20, pages: int = 2, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = db.get(IntegrationProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="연동 프로필을 찾을 수 없습니다.")
    if profile.owner_id != user.id:
        raise HTTPException(status_code=403, detail="다른 사용자의 연동 프로필은 수집할 수 없습니다.")
    safe_limit = max(1, min(limit, 100))
    safe_pages = max(1, min(pages, 5))
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


@app.get("/api/posts")
def list_posts(q: str = "", page: int = 1, db: Session = Depends(get_db)) -> dict:
    posts, total = search_posts(db, q, max(page, 1), 8)
    return {"posts": [serialize_post(post) for post in posts], "total": total, "page": page, "take": 8}


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


@app.delete("/api/knowledge/{source_id}")
def delete_knowledge(source_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    source = db.get(KnowledgeSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="지식자료를 찾을 수 없습니다.")
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
    if selected_profile:
        ai_provider = selected_profile.ai_provider
        ai_model = selected_profile.ai_model
        ai_api_base = selected_profile.ai_api_base
        api_provider = selected_profile.api_provider
        api_key_strategy = f"사용자별 연동 프로필 '{selected_profile.name}'의 {selected_profile.token_name or '토큰'} 사용"
        custom_template = selected_profile.custom_template or custom_template
        profile_connections = parse_connections(selected_profile.custom_connections)
        if profile_connections:
            custom_connections = profile_connections
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
        custom_connections=json.dumps([item.model_dump() if hasattr(item, "model_dump") else item for item in custom_connections], ensure_ascii=False),
        status=data.status,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"task": serialize_task(task), "plan": automation_plan(task)}


@app.post("/api/automations/{task_id}/run")
def run_automation(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    task = db.get(AutomationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="자동화 작업을 찾을 수 없습니다.")
    if task.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="실행 권한이 없습니다.")
    current_hash = automation_fingerprint(task)
    if task.last_input_hash == current_hash:
        result = {
            "taskId": task.id,
            "status": "skipped",
            "reason": "감시 대상 입력값이 이전 실행과 같아서 외부 API 실행을 건너뜁니다.",
            "changeHash": current_hash,
            "watchedFields": [
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
            ],
        }
        task.last_result = result_to_text(result)
        task.last_run_at = datetime.now(timezone.utc)
        db.commit()
        return {"task": serialize_task(task), "run": {"id": None, "result": result, "createdPostId": None}}
    result = automation_plan(task)
    result["status"] = "changed"
    result["changeHash"] = current_hash
    task.last_result = result_to_text(result)
    task.last_input_hash = current_hash
    task.last_run_at = datetime.now(timezone.utc)
    run = AutomationRun(task_id=task.id, owner_id=task.owner_id, result=task.last_result)
    db.add(run)
    db.commit()
    db.refresh(run)
    return {"task": serialize_task(task), "run": {"id": run.id, "result": result, "createdPostId": None}}


@app.post("/api/automations/{task_id}/share")
def share_automation(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    task = db.get(AutomationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="자동화 작업을 찾을 수 없습니다.")
    if task.owner_id != user.id and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="공유 권한이 없습니다.")
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
- 커스텀 템플릿:
{task.custom_template}
- 커스텀 연결:
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
        return {"jsonrpc": "2.0", "id": payload.get("id"), "result": {"location": "Seoul", "summary": "서울 기준 데모 날씨 브리핑입니다.", "source": "demo-mcp"}}
    if method == "automation.describe":
        return {"jsonrpc": "2.0", "id": payload.get("id"), "result": {"summary": "자동화 작업의 주기, 경로, API, AI Agent를 설명합니다."}}
    return {"jsonrpc": "2.0", "id": payload.get("id"), "error": {"code": -32601, "message": "method not found"}}
