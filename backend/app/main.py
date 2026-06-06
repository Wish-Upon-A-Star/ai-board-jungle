from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db, init_db
from .models import AutomationRun, AutomationTask, Comment, Post, User
from .schemas import AutomationIn, CommentIn, InstructionIn, LoginIn, PostIn, QuestionIn, RegisterIn
from .security import create_token, current_user, hash_password, verify_password
from .services import agent_review, automation_fingerprint, automation_plan, get_or_create_tags, instruction_hub, rag_answer, result_to_text, search_posts, summarize

app = FastAPI(title="AI Board API", description="React + FastAPI + PostgreSQL + Redis AI board API.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup() -> None:
    init_db()


def serialize_user(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


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
    return {
        "id": task.id,
        "name": task.name,
        "owner": serialize_user(task.owner),
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
    return {"user": serialize_user(user)}


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


@app.get("/api/automations")
def list_automations(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    stmt = select(AutomationTask).order_by(AutomationTask.created_at.desc())
    if user.role != "ADMIN":
        stmt = stmt.where(AutomationTask.owner_id == user.id)
    tasks = db.scalars(stmt).all()
    return {"tasks": [serialize_task(task) for task in tasks]}


@app.post("/api/automations")
def create_automation(data: AutomationIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    task = AutomationTask(
        name=data.name,
        owner_id=user.id,
        source=data.source,
        destination=data.destination,
        interval_minutes=data.interval_minutes,
        instruction=data.instruction,
        template=data.template,
        api_provider=data.api_provider,
        ai_agent=data.ai_agent,
        github_repo_url=data.github_repo_url,
        github_project_url=data.github_project_url,
        notion_database_url=data.notion_database_url,
        figma_file_url=data.figma_file_url,
        calendar_id=data.calendar_id,
        ai_provider=data.ai_provider,
        ai_model=data.ai_model,
        ai_api_base=data.ai_api_base,
        api_key_strategy=data.api_key_strategy,
        request_template=data.request_template,
        github_issue_template=data.github_issue_template,
        notion_template=data.notion_template,
        figma_template=data.figma_template,
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
