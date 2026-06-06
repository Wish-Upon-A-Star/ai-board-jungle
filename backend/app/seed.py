from __future__ import annotations

from .db import SessionLocal, init_db
from .models import AutomationTask, Post, User
from .security import hash_password
from .services import get_or_create_tags


def seed() -> None:
    init_db()
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.email == "admin@example.com").first():
            db.add(User(email="admin@example.com", name="관리자", password_hash=hash_password("password123"), role="ADMIN"))
            db.add(User(email="user@example.com", name="사용자", password_hash=hash_password("password123"), role="USER"))
            db.commit()

        admin = db.query(User).filter(User.email == "admin@example.com").first()
        user = db.query(User).filter(User.email == "user@example.com").first()

        if db.query(Post).count() == 0 and admin:
            samples = [
                ("GitHub 칸반과 Notion 업무 동기화", "이슈를 칸반에 정리하고 Notion 업무 DB와 연결합니다.", ["github", "notion"]),
                ("Google Calendar 일정 자동 등록", "운영 지침에서 마감일을 추출해 캘린더 이벤트로 연결합니다.", ["calendar"]),
                ("Figma 디자인 확인 작업", "Figma 링크를 운영 지침과 연결해 디자인 확인 작업을 묶습니다.", ["figma"]),
            ]
            for title, content, tags in samples:
                post = Post(title=title, content=content, summary=content, author_id=admin.id)
                post.tags = get_or_create_tags(db, tags)
                db.add(post)
            db.commit()

        if db.query(AutomationTask).count() == 0 and admin and user:
            tasks = [
                AutomationTask(
                    name="GitHub 이슈 -> Notion 업무 동기화",
                    owner_id=admin.id,
                    source="GitHub Issues",
                    destination="Notion Tasks DB",
                    interval_minutes=5,
                    instruction="새 이슈와 변경된 이슈를 요약하고 담당자, 상태, 마감일을 Notion 업무 DB에 반영한다.",
                    template="업무명 / 상태 / 링크 / 요약 / 다음 액션",
                    api_provider="GitHub REST API + Notion API",
                    ai_agent="SyncPlannerAgent",
                ),
                AutomationTask(
                    name="게시판 글 -> Calendar/Figma 확인 큐",
                    owner_id=user.id,
                    source="AI Board Posts",
                    destination="Google Calendar + Figma Review",
                    interval_minutes=15,
                    instruction="디자인 리뷰나 마감일이 포함된 게시글을 찾아 캘린더 일정과 Figma 확인 항목으로 만든다.",
                    template="일정 제목 / 디자인 링크 / 확인 기준 / 담당자",
                    api_provider="FastAPI + Google Calendar API + Figma API",
                    ai_agent="ReviewRouteAgent",
                ),
            ]
            db.add_all(tasks)
            db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
