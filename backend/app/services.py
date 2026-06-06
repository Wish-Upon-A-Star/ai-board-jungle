from __future__ import annotations

import json
import re

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .cache import cache_get, cache_set
from .config import settings
from .models import AutomationTask, Post, Tag


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


def rag_answer(db: Session, question: str) -> dict:
    hits = similar_posts(db, question)
    if hits:
        answer = f"가장 관련 있는 기록은 '{hits[0]['title']}'입니다. {hits[0]['summary']}"
    else:
        answer = "게시판 지식 베이스에서 충분한 근거를 찾지 못했습니다."
    return {"answer": answer, "sources": [hit["title"] for hit in hits], "recommendations": hits}


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
    text = f"{task.source} {task.destination} {task.instruction} {task.api_provider}".lower()
    if re.search(r"github|깃허브|git hub|kanban|칸반|issue|이슈", text):
        targets.append({"target": "github", "api": "GitHub REST/CLI", "mode": "live" if settings().github_token else "connector-or-cli"})
    if re.search(r"notion|노션", text):
        targets.append({"target": "notion", "api": "Notion API/MCP", "mode": "live" if settings().notion_token else "connector"})
    if re.search(r"calendar|캘린더|google|구글|일정", text):
        targets.append({"target": "google_calendar", "api": "Google Calendar API", "mode": "live" if settings().google_access_token else "needs-token"})
    if re.search(r"figma|피그마|design|디자인", text):
        targets.append({"target": "figma", "api": "Figma API/MCP", "mode": "live" if settings().figma_token else "connector"})
    if not targets:
        targets.append({"target": "board", "api": "FastAPI", "mode": "local"})
    return {
        "taskId": task.id,
        "agent": task.ai_agent,
        "intervalMinutes": task.interval_minutes,
        "route": f"{task.source} -> {task.destination}",
        "template": task.template,
        "instruction": task.instruction,
        "targets": targets,
        "loopGuard": {"maxToolCalls": 6, "timeoutSeconds": 45, "retry": 1},
    }


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
