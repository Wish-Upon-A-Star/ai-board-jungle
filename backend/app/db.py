from __future__ import annotations

import socket
import os
from pathlib import Path
from urllib.parse import urlparse

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
if database_url.startswith("sqlite") and os.environ.get("AI_BOARD_ALLOW_SQLITE_TEST_DB") != "1":
    raise RuntimeError(
        "SQLite is disabled for AI Board runtime. "
        "Use PostgreSQL via AI_BOARD_DATABASE_URL, or set AI_BOARD_ALLOW_SQLITE_TEST_DB=1 only for isolated tests."
    )
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


def check_db() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"ok": True, "url": database_url.split("://", 1)[0]}


def database_reachable(timeout_seconds: float = 1.0) -> tuple[bool, str]:
    if not database_url.startswith("postgresql"):
        return True, ""
    parsed = urlparse(database_url.replace("postgresql+psycopg://", "postgresql://", 1))
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            return True, ""
    except OSError as exc:
        return False, f"PostgreSQL is not reachable at {host}:{port}: {exc.__class__.__name__}"


def init_db() -> None:
    from . import models

    Base.metadata.create_all(bind=engine)
    if database_url.startswith("sqlite"):
        with engine.begin() as conn:
            post_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(posts)")).fetchall()}
            if "automation_task_id" not in post_columns:
                conn.execute(text("ALTER TABLE posts ADD COLUMN automation_task_id INTEGER REFERENCES automation_tasks(id)"))
            user_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()}
            user_additions = {
                "profile_ai_provider": "VARCHAR(80) DEFAULT 'OpenAI'",
                "profile_ai_model": "VARCHAR(120) DEFAULT 'gpt-4o-mini'",
                "profile_ai_api_base": "VARCHAR(240) DEFAULT 'https://api.openai.com/v1'",
                "profile_api_key_strategy": "TEXT DEFAULT '사용자별 환경변수 또는 서버 비밀 저장소에 보관'",
                "profile_template_preset": "VARCHAR(80) DEFAULT 'github_notion'",
                "profile_custom_template": "TEXT DEFAULT ''",
                "profile_custom_connections": "TEXT DEFAULT '[]'",
            }
            for column, ddl in user_additions.items():
                if column not in user_columns:
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {column} {ddl}"))
            task_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(automation_tasks)")).fetchall()}
            task_additions = {
                "integration_profile_id": "INTEGER REFERENCES integration_profiles(id) ON DELETE SET NULL",
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
                "template_preset": "VARCHAR(80) DEFAULT 'github_notion'",
                "custom_template": "TEXT DEFAULT ''",
                "custom_connections": "TEXT DEFAULT '[]'",
                "last_input_hash": "VARCHAR(80) DEFAULT ''",
            }
            for column, ddl in task_additions.items():
                if column not in task_columns:
                    conn.execute(text(f"ALTER TABLE automation_tasks ADD COLUMN {column} {ddl}"))
            conn.execute(text(
                """
                CREATE TABLE IF NOT EXISTS knowledge_sources (
                    id INTEGER NOT NULL PRIMARY KEY,
                    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title VARCHAR(180) NOT NULL,
                    source_type VARCHAR(40) DEFAULT 'document' NOT NULL,
                    file_name VARCHAR(240) DEFAULT '' NOT NULL,
                    mime_type VARCHAR(120) DEFAULT '' NOT NULL,
                    instruction TEXT DEFAULT '' NOT NULL,
                    extracted_text TEXT DEFAULT '' NOT NULL,
                    tags_json TEXT DEFAULT '[]' NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            ))
            conn.execute(text(
                """
                CREATE TABLE IF NOT EXISTS integration_profiles (
                    id INTEGER NOT NULL PRIMARY KEY,
                    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(120) NOT NULL,
                    source_kind VARCHAR(60) DEFAULT 'custom' NOT NULL,
                    base_url VARCHAR(500) DEFAULT '' NOT NULL,
                    api_provider VARCHAR(120) DEFAULT 'REST API' NOT NULL,
                    token_name VARCHAR(120) DEFAULT '' NOT NULL,
                    token_value TEXT DEFAULT '' NOT NULL,
                    ai_provider VARCHAR(80) DEFAULT 'OpenAI' NOT NULL,
                    ai_model VARCHAR(120) DEFAULT 'gpt-4o-mini' NOT NULL,
                    ai_api_base VARCHAR(240) DEFAULT 'https://api.openai.com/v1' NOT NULL,
                    rag_targets_json TEXT DEFAULT '[]' NOT NULL,
                    collect_limit INTEGER DEFAULT 20 NOT NULL,
                    collect_pages INTEGER DEFAULT 2 NOT NULL,
                    custom_connections TEXT DEFAULT '[]' NOT NULL,
                    custom_template TEXT DEFAULT '' NOT NULL,
                    last_collect_status VARCHAR(40) DEFAULT '' NOT NULL,
                    last_collect_count INTEGER DEFAULT 0 NOT NULL,
                    last_collect_saved INTEGER DEFAULT 0 NOT NULL,
                    last_collect_duplicates INTEGER DEFAULT 0 NOT NULL,
                    last_collect_warnings TEXT DEFAULT '[]' NOT NULL,
                    last_collected_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            ))
            integration_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(integration_profiles)")).fetchall()}
            integration_additions = {
                "collect_limit": "INTEGER DEFAULT 20 NOT NULL",
                "collect_pages": "INTEGER DEFAULT 2 NOT NULL",
                "last_collect_status": "VARCHAR(40) DEFAULT '' NOT NULL",
                "last_collect_count": "INTEGER DEFAULT 0 NOT NULL",
                "last_collect_saved": "INTEGER DEFAULT 0 NOT NULL",
                "last_collect_duplicates": "INTEGER DEFAULT 0 NOT NULL",
                "last_collect_warnings": "TEXT DEFAULT '[]' NOT NULL",
                "last_collected_at": "DATETIME",
            }
            for column, ddl in integration_additions.items():
                if column not in integration_columns:
                    conn.execute(text(f"ALTER TABLE integration_profiles ADD COLUMN {column} {ddl}"))
            conn.execute(text(
                """
                CREATE TABLE IF NOT EXISTS integration_activities (
                    id INTEGER NOT NULL PRIMARY KEY,
                    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    automation_task_id INTEGER REFERENCES automation_tasks(id) ON DELETE SET NULL,
                    integration_profile_id INTEGER REFERENCES integration_profiles(id) ON DELETE SET NULL,
                    event_type VARCHAR(80) NOT NULL,
                    provider VARCHAR(80) DEFAULT '' NOT NULL,
                    status VARCHAR(40) DEFAULT 'info' NOT NULL,
                    summary VARCHAR(240) DEFAULT '' NOT NULL,
                    details_json TEXT DEFAULT '{}' NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            ))
            index_statements = [
                "CREATE INDEX IF NOT EXISTS ix_posts_status_created ON posts(status, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_posts_author_created ON posts(author_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_comments_post_created ON comments(post_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_knowledge_owner_created ON knowledge_sources(owner_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_knowledge_owner_type_file ON knowledge_sources(owner_id, source_type, file_name)",
                "CREATE INDEX IF NOT EXISTS ix_profiles_owner_created ON integration_profiles(owner_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_profiles_owner_source ON integration_profiles(owner_id, source_kind)",
                "CREATE INDEX IF NOT EXISTS ix_tasks_owner_created ON automation_tasks(owner_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_tasks_owner_status_created ON automation_tasks(owner_id, status, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_tasks_status_created ON automation_tasks(status, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_runs_task_created ON automation_runs(task_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_runs_owner_created ON automation_runs(owner_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_activities_owner_created ON integration_activities(owner_id, created_at, id)",
                "CREATE INDEX IF NOT EXISTS ix_activities_owner_event_created ON integration_activities(owner_id, event_type, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_activities_owner_provider_event ON integration_activities(owner_id, provider, event_type)",
                "CREATE INDEX IF NOT EXISTS ix_activities_owner_status_created ON integration_activities(owner_id, status, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_activities_owner_task_created ON integration_activities(owner_id, automation_task_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_activities_owner_profile_created ON integration_activities(owner_id, integration_profile_id, created_at)",
            ]
            for statement in index_statements:
                conn.execute(text(statement))
