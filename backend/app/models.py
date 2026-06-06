from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, String, Table, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(20), default="USER")
    profile_ai_provider: Mapped[str] = mapped_column(String(80), default="OpenAI")
    profile_ai_model: Mapped[str] = mapped_column(String(120), default="gpt-4o-mini")
    profile_ai_api_base: Mapped[str] = mapped_column(String(240), default="https://api.openai.com/v1")
    profile_api_key_strategy: Mapped[str] = mapped_column(Text, default="사용자별 환경변수 또는 서버 비밀 저장소에 보관")
    profile_template_preset: Mapped[str] = mapped_column(String(80), default="github_notion")
    profile_custom_template: Mapped[str] = mapped_column(Text, default="")
    profile_custom_connections: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    posts: Mapped[list["Post"]] = relationship(back_populates="author")
    comments: Mapped[list["Comment"]] = relationship(back_populates="author")
    automations: Mapped[list["AutomationTask"]] = relationship(back_populates="owner")
    knowledge_sources: Mapped[list["KnowledgeSource"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    integration_profiles: Mapped[list["IntegrationProfile"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180), index=True)
    content: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="PUBLISHED")
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    automation_task_id: Mapped[int | None] = mapped_column(ForeignKey("automation_tasks.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    author: Mapped[User] = relationship(back_populates="posts")
    automation_task: Mapped["AutomationTask | None"] = relationship(back_populates="shared_posts")
    comments: Mapped[list["Comment"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    tags: Mapped[list["Tag"]] = relationship(secondary=post_tags, back_populates="posts")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    post: Mapped[Post] = relationship(back_populates="comments")
    author: Mapped[User] = relationship(back_populates="comments")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    posts: Mapped[list[Post]] = relationship(secondary=post_tags, back_populates="tags")


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(180), index=True)
    source_type: Mapped[str] = mapped_column(String(40), default="document")
    file_name: Mapped[str] = mapped_column(String(240), default="")
    mime_type: Mapped[str] = mapped_column(String(120), default="")
    instruction: Mapped[str] = mapped_column(Text, default="")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    owner: Mapped[User] = relationship(back_populates="knowledge_sources")


class IntegrationProfile(Base):
    __tablename__ = "integration_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120), index=True)
    source_kind: Mapped[str] = mapped_column(String(60), default="custom")
    base_url: Mapped[str] = mapped_column(String(500), default="")
    api_provider: Mapped[str] = mapped_column(String(120), default="REST API")
    token_name: Mapped[str] = mapped_column(String(120), default="")
    token_value: Mapped[str] = mapped_column(Text, default="")
    ai_provider: Mapped[str] = mapped_column(String(80), default="OpenAI")
    ai_model: Mapped[str] = mapped_column(String(120), default="gpt-4o-mini")
    ai_api_base: Mapped[str] = mapped_column(String(240), default="https://api.openai.com/v1")
    rag_targets_json: Mapped[str] = mapped_column(Text, default="[]")
    custom_connections: Mapped[str] = mapped_column(Text, default="[]")
    custom_template: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    owner: Mapped[User] = relationship(back_populates="integration_profiles")
    automations: Mapped[list["AutomationTask"]] = relationship(back_populates="integration_profile")


class AutomationTask(Base):
    __tablename__ = "automation_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    integration_profile_id: Mapped[int | None] = mapped_column(ForeignKey("integration_profiles.id", ondelete="SET NULL"), nullable=True)
    source: Mapped[str] = mapped_column(String(120))
    destination: Mapped[str] = mapped_column(String(120))
    interval_minutes: Mapped[int] = mapped_column(default=5)
    instruction: Mapped[str] = mapped_column(Text)
    template: Mapped[str] = mapped_column(Text)
    api_provider: Mapped[str] = mapped_column(String(80), default="GitHub/Notion/Figma")
    ai_agent: Mapped[str] = mapped_column(String(80), default="AutomationPlannerAgent")
    github_repo_url: Mapped[str] = mapped_column(String(300), default="")
    github_project_url: Mapped[str] = mapped_column(String(300), default="")
    notion_database_url: Mapped[str] = mapped_column(String(300), default="")
    figma_file_url: Mapped[str] = mapped_column(String(300), default="")
    calendar_id: Mapped[str] = mapped_column(String(160), default="primary")
    ai_provider: Mapped[str] = mapped_column(String(80), default="OpenAI")
    ai_model: Mapped[str] = mapped_column(String(120), default="gpt-4o-mini")
    ai_api_base: Mapped[str] = mapped_column(String(240), default="")
    api_key_strategy: Mapped[str] = mapped_column(Text, default="사용자별 환경변수 또는 서버 비밀 저장소에 보관")
    request_template: Mapped[str] = mapped_column(Text, default="")
    github_issue_template: Mapped[str] = mapped_column(Text, default="")
    notion_template: Mapped[str] = mapped_column(Text, default="")
    figma_template: Mapped[str] = mapped_column(Text, default="")
    template_preset: Mapped[str] = mapped_column(String(80), default="github_notion")
    custom_template: Mapped[str] = mapped_column(Text, default="")
    custom_connections: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    last_result: Mapped[str] = mapped_column(Text, default="")
    last_input_hash: Mapped[str] = mapped_column(String(80), default="")
    last_run_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    owner: Mapped[User] = relationship(back_populates="automations")
    integration_profile: Mapped["IntegrationProfile | None"] = relationship(back_populates="automations")
    runs: Mapped[list["AutomationRun"]] = relationship(back_populates="task", cascade="all, delete-orphan")
    shared_posts: Mapped[list[Post]] = relationship(back_populates="automation_task")


class AutomationRun(Base):
    __tablename__ = "automation_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("automation_tasks.id", ondelete="CASCADE"))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    result: Mapped[str] = mapped_column(Text)
    created_post_id: Mapped[int | None] = mapped_column(ForeignKey("posts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    task: Mapped[AutomationTask] = relationship(back_populates="runs")
