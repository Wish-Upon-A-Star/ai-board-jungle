from __future__ import annotations

import json
import re
from hashlib import sha256

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .cache import cache_get, cache_set
from .config import settings
from .models import AutomationTask, KnowledgeSource, Post, Tag


WORD_RE = re.compile(r"[a-zA-Z0-9가-힣]+")


def normalize_tags(tags: list[str]) -> list[str]:
    cleaned: list[str] = []
    for tag in tags[:8]:
        value = tag.strip().removeprefix("#")
        if value and value not in cleaned:
            cleaned.append(value)
    return cleaned


def summarize(title: str, content: str) -> str:
    return re.sub(r"\s+", " ", content).strip()[:140] or title


def lexical_score(query: str, text: str) -> float:
    query_words = set(WORD_RE.findall(query.lower()))
    doc_words = set(WORD_RE.findall(text.lower()))
    if not query_words:
        return 0.0
    return len(query_words & doc_words) / len(query_words)


def similar_posts(db: Session, question: str) -> list[dict]:
    cache_key = f"rag:similar:{hash(question)}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    posts = db.scalars(select(Post).where(Post.status == "PUBLISHED").order_by(Post.created_at.desc()).limit(80)).all()
    ranked = [
        {
            "id": post.id,
            "title": post.title,
            "summary": post.summary or summarize(post.title, post.content),
            "score": lexical_score(question, f"{post.title} {post.content} {' '.join(tag.name for tag in post.tags)}"),
            "tags": [tag.name for tag in post.tags],
        }
        for post in posts
    ]
    result = [item for item in sorted(ranked, key=lambda x: x["score"], reverse=True) if item["score"] > 0][:5]
    cache_set(cache_key, result, 90)
    return result


def similar_knowledge(db: Session, question: str, owner_id: int | None = None) -> list[dict]:
    cache_key = f"rag:knowledge:{owner_id or 'all'}:{hash(question)}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    stmt = select(KnowledgeSource).order_by(KnowledgeSource.created_at.desc()).limit(120)
    if owner_id is not None:
        stmt = stmt.where(KnowledgeSource.owner_id == owner_id)
    sources = db.scalars(stmt).all()
    ranked = [
        {
            "id": source.id,
            "title": source.title,
            "summary": summarize(source.title, f"{source.instruction}\n{source.extracted_text}"),
            "score": lexical_score(question, f"{source.title} {source.source_type} {source.file_name} {source.instruction} {source.extracted_text} {source.tags_json}"),
            "tags": json.loads(source.tags_json or "[]"),
            "sourceType": source.source_type,
            "fileName": source.file_name,
        }
        for source in sources
    ]
    result = [item for item in sorted(ranked, key=lambda x: x["score"], reverse=True) if item["score"] > 0][:5]
    cache_set(cache_key, result, 90)
    return result


def rag_answer(db: Session, question: str, owner_id: int | None = None) -> dict:
    hits = similar_posts(db, question)
    knowledge_hits = similar_knowledge(db, question, owner_id)
    combined = sorted(
        [{**hit, "kind": "post"} for hit in hits] + [{**hit, "kind": "knowledge"} for hit in knowledge_hits],
        key=lambda x: x["score"],
        reverse=True,
    )[:5]
    if combined:
        top = combined[0]
        answer = f"가장 관련 있는 근거는 '{top['title']}'입니다. {top['summary']}"
    else:
        answer = "게시판 지식 베이스에서 충분한 근거를 찾지 못했습니다."
    return {"answer": answer, "sources": [hit["title"] for hit in combined], "recommendations": combined, "knowledgeSources": knowledge_hits}


def agent_review(db: Session, title: str, content: str) -> dict:
    hits = similar_posts(db, f"{title}\n{content}")
    risky = bool(re.search(r"스팸|혐오|욕설|도배|사기", content, re.I))
    decision = "hold" if risky else "revise" if hits and hits[0]["score"] > 0.75 else "publish"
    return {
        "decision": decision,
        "reason": "위험 표현 감지" if risky else "유사 게시글 확인 필요" if decision == "revise" else "게시 가능",
        "steps": [{"tool": "rag.search", "observation": f"{len(hits)} similar posts"}],
        "suggestedTags": list({tag for hit in hits for tag in hit["tags"]})[:5],
    }


def automation_plan(task: AutomationTask) -> dict:
    targets = []
    try:
        custom_connections = json.loads(task.custom_connections or "[]")
    except json.JSONDecodeError:
        custom_connections = []
    for connection in custom_connections:
        service = connection.get("service", "custom")
        targets.append({
            "target": service.lower().replace(" ", "_"),
            "label": connection.get("label", service),
            "api": connection.get("api", "Custom API"),
            "mode": "user-token-required" if connection.get("auth_key_name") else "manual-or-public",
            "site": connection.get("url", ""),
            "authKeyName": connection.get("auth_key_name", ""),
            "template": connection.get("template", ""),
            "operation": connection.get("operation", "custom_action"),
        })
    text = f"{task.source} {task.destination} {task.instruction} {task.api_provider}".lower()
    if not custom_connections and re.search(r"github|깃허브|git hub|kanban|칸반|issue|이슈", text):
        targets.append({
            "target": "github",
            "api": "GitHub REST/CLI",
            "mode": "live" if settings().github_token else "user-token-required",
            "site": task.github_repo_url or task.github_project_url,
            "template": task.github_issue_template,
            "operation": "issue_create_or_update",
        })
    if not custom_connections and re.search(r"notion|노션", text):
        targets.append({
            "target": "notion",
            "api": "Notion API/MCP",
            "mode": "live" if settings().notion_token else "user-token-required",
            "site": task.notion_database_url,
            "template": task.notion_template,
            "operation": "database_row_upsert",
        })
    if not custom_connections and re.search(r"calendar|캘린더|google|구글|일정", text):
        targets.append({
            "target": "google_calendar",
            "api": "Google Calendar API",
            "mode": "live" if settings().google_access_token else "user-token-required",
            "site": task.calendar_id,
            "template": task.request_template,
            "operation": "event_create",
        })
    if not custom_connections and re.search(r"figma|피그마|design|디자인", text):
        targets.append({
            "target": "figma",
            "api": "Figma API/MCP",
            "mode": "live" if settings().figma_token else "user-token-required",
            "site": task.figma_file_url,
            "template": task.figma_template,
            "operation": "comment_or_section_create",
        })
    if not targets:
        targets.append({"target": "board", "api": "FastAPI", "mode": "local", "site": "AI Board", "template": task.template, "operation": "post_create"})
    return {
        "taskId": task.id,
        "agent": task.ai_agent,
        "integrationProfile": {
            "id": task.integration_profile.id,
            "name": task.integration_profile.name,
            "sourceKind": task.integration_profile.source_kind,
            "baseUrl": task.integration_profile.base_url,
            "ragTargets": json.loads(task.integration_profile.rag_targets_json or "[]"),
            "hasToken": bool(task.integration_profile.token_value),
        } if task.integration_profile else None,
        "ai": {"provider": task.ai_provider, "model": task.ai_model, "apiBase": task.ai_api_base, "keyStrategy": task.api_key_strategy},
        "intervalMinutes": task.interval_minutes,
        "route": f"{task.source} -> {task.destination}",
        "template": task.template,
        "templatePreset": task.template_preset,
        "customTemplate": task.custom_template,
        "requestTemplate": task.request_template,
        "instruction": task.instruction,
        "targets": targets,
        "externalRagSources": [
            {
                "source": task.integration_profile.source_kind,
                "target": target,
                "api": task.integration_profile.api_provider,
                "baseUrl": task.integration_profile.base_url,
                "mode": "live-token-ready" if task.integration_profile.token_value else "token-required",
            }
            for target in (json.loads(task.integration_profile.rag_targets_json or "[]") if task.integration_profile else [])
        ],
        "loopGuard": {"maxToolCalls": 6, "timeoutSeconds": 45, "retry": 1},
        "exampleTransform": {
            "githubIssueToNotion": {
                "from": task.github_issue_template,
                "to": task.notion_template,
                "targetDatabase": task.notion_database_url,
            },
            "notionToFigmaOrCalendar": {
                "figma": task.figma_template,
                "calendar": task.request_template,
            },
        },
    }


def automation_fingerprint(task: AutomationTask) -> str:
    watched = {
        "integration_profile_id": task.integration_profile_id,
        "source": task.source,
        "destination": task.destination,
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
        "api_key_strategy": task.api_key_strategy,
        "request_template": task.request_template,
        "github_issue_template": task.github_issue_template,
        "notion_template": task.notion_template,
        "figma_template": task.figma_template,
        "template_preset": task.template_preset,
        "custom_template": task.custom_template,
        "custom_connections": task.custom_connections,
    }
    payload = json.dumps(watched, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(payload.encode("utf-8")).hexdigest()


async def instruction_hub(instruction: str) -> dict:
    pseudo = AutomationTask(
        id=0,
        name="adhoc",
        owner_id=0,
        source="사용자 지침",
        destination="운영 자동화",
        interval_minutes=5,
        instruction=instruction,
        template="요약, 실행 대상, 실패 사유를 남긴다.",
        api_provider="GitHub/Notion/Google/Figma",
        ai_agent="AutomationPlannerAgent",
        github_repo_url="사용자가 입력한 GitHub 저장소 URL",
        github_project_url="사용자가 입력한 GitHub Project URL",
        notion_database_url="사용자가 입력한 Notion DB URL",
        figma_file_url="사용자가 입력한 Figma 파일 URL",
        calendar_id="primary",
        ai_provider="OpenAI",
        ai_model="gpt-4o-mini",
        ai_api_base="",
        api_key_strategy="사용자별 환경변수 또는 서버 비밀 저장소에 보관",
        request_template="요청 제목 / 담당자 / 마감일 / 링크 / 다음 액션",
        github_issue_template="이슈 제목 / 본문 / 라벨 / 담당자 / 마감일",
        notion_template="업무명 / 상태 / GitHub 링크 / 요약 / 담당자 / 마감일",
        figma_template="섹션명 / 확인 기준 / 관련 링크 / 담당자",
        template_preset="custom",
        custom_template="사용자 정의 출력 양식",
        custom_connections="[]",
    )
    plan = automation_plan(pseudo)
    return {
        "instruction": instruction,
        "actions": [{"target": x["target"], "mode": x["mode"], "detail": f"{x['api']}로 처리"} for x in plan["targets"]],
        "plan": plan,
    }


def search_posts(db: Session, q: str, page: int, take: int) -> tuple[list[Post], int]:
    stmt = select(Post).order_by(Post.created_at.desc())
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Post.title.ilike(like), Post.content.ilike(like)))
    posts = db.scalars(stmt.offset((page - 1) * take).limit(take)).all()
    all_count = len(db.scalars(stmt).all())
    return list(posts), all_count


def get_or_create_tags(db: Session, names: list[str]) -> list[Tag]:
    tags = []
    for name in normalize_tags(names):
        tag = db.scalar(select(Tag).where(Tag.name == name))
        if not tag:
            tag = Tag(name=name)
            db.add(tag)
            db.flush()
        tags.append(tag)
    return tags


def result_to_text(result: dict) -> str:
    return json.dumps(result, ensure_ascii=False, indent=2)
