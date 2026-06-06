from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings


def engine_url() -> str:
    url = settings().database_url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


database_url = engine_url()
engine_kwargs = {"pool_pre_ping": True}
if database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    if database_url.startswith("sqlite:///") and database_url != "sqlite:///:memory:":
        sqlite_path = database_url.removeprefix("sqlite:///")
        Path(sqlite_path).parent.mkdir(parents=True, exist_ok=True)
    if database_url == "sqlite:///:memory:":
        engine_kwargs["poolclass"] = StaticPool

engine = create_engine(database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models

    Base.metadata.create_all(bind=engine)
    if database_url.startswith("sqlite"):
        with engine.begin() as conn:
            post_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(posts)")).fetchall()}
            if "automation_task_id" not in post_columns:
                conn.execute(text("ALTER TABLE posts ADD COLUMN automation_task_id INTEGER REFERENCES automation_tasks(id)"))
            task_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(automation_tasks)")).fetchall()}
            task_additions = {
                "github_repo_url": "VARCHAR(300) DEFAULT ''",
                "github_project_url": "VARCHAR(300) DEFAULT ''",
                "notion_database_url": "VARCHAR(300) DEFAULT ''",
                "figma_file_url": "VARCHAR(300) DEFAULT ''",
                "calendar_id": "VARCHAR(160) DEFAULT 'primary'",
                "ai_provider": "VARCHAR(80) DEFAULT 'OpenAI'",
                "ai_model": "VARCHAR(120) DEFAULT 'gpt-4o-mini'",
                "ai_api_base": "VARCHAR(240) DEFAULT ''",
                "api_key_strategy": "TEXT DEFAULT '사용자별 환경변수 또는 서버 비밀 저장소에 보관'",
                "request_template": "TEXT DEFAULT ''",
                "github_issue_template": "TEXT DEFAULT ''",
                "notion_template": "TEXT DEFAULT ''",
                "figma_template": "TEXT DEFAULT ''",
                "last_input_hash": "VARCHAR(80) DEFAULT ''",
            }
            for column, ddl in task_additions.items():
                if column not in task_columns:
                    conn.execute(text(f"ALTER TABLE automation_tasks ADD COLUMN {column} {ddl}"))
