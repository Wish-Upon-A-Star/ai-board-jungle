from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, model_validator


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=8, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PostIn(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    content: str = Field(min_length=10, max_length=8000)
    tags: list[str] = []


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=1000)


class InstructionIn(BaseModel):
    instruction: str = Field(min_length=1, max_length=4000)


class QuestionIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class LiveWriteIn(BaseModel):
    title: str = Field(default="AI Board live write", min_length=1, max_length=160)
    body: str = Field(default="Created from AI Board automation.", min_length=1, max_length=4000)
    dry_run: bool = True
    confirmation: str = Field(default="", max_length=80)
    start_minutes_from_now: int = Field(default=15, ge=0, le=10080)
    duration_minutes: int = Field(default=30, ge=5, le=1440)


class KnowledgeIn(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    source_type: str = Field(default="document", max_length=40)
    instruction: str = Field(default="", max_length=4000)
    extracted_text: str = Field(default="", max_length=20000)
    tags: list[str] = []


class CustomConnectionIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    service: str = Field(min_length=1, max_length=80)
    url: str = Field(default="", max_length=500)
    api: str = Field(default="", max_length=160)
    auth_key_name: str = Field(default="", max_length=120)
    operation: str = Field(default="", max_length=160)
    template: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def require_executable_connection_fields(self) -> "CustomConnectionIn":
        missing = [
            field
            for field in ("service", "api", "auth_key_name", "operation")
            if not str(getattr(self, field, "")).strip()
        ]
        if missing:
            raise ValueError(f"custom connection is missing required fields: {', '.join(missing)}")
        return self


class IntegrationProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    source_kind: str = Field(default="custom", max_length=60)
    base_url: str = Field(default="", max_length=500)
    api_provider: str = Field(default="REST API", max_length=120)
    token_name: str = Field(default="", max_length=120)
    token_value: str = Field(default="", max_length=4000)
    ai_provider: str = Field(default="OpenAI", min_length=2, max_length=80)
    ai_model: str = Field(default="gpt-4o-mini", min_length=2, max_length=120)
    ai_api_base: str = Field(default="", max_length=240)
    rag_targets: list[str] = []
    collect_limit: int = Field(default=20, ge=1, le=100)
    collect_pages: int = Field(default=2, ge=1, le=5)
    custom_connections: list[CustomConnectionIn] = []
    custom_template: str = Field(default="", max_length=4000)


class ProfileSettingsIn(BaseModel):
    ai_provider: str = Field(default="OpenAI", min_length=2, max_length=80)
    ai_model: str = Field(default="gpt-4o-mini", min_length=2, max_length=120)
    ai_api_base: str = Field(default="", max_length=240)
    api_key_strategy: str = Field(default="사용자별 환경변수 또는 서버 비밀 저장소에 보관", max_length=2000)
    template_preset: str = Field(default="github_notion", max_length=80)
    custom_template: str = Field(default="", max_length=4000)
    custom_connections: list[CustomConnectionIn] = []


class AutomationIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    integration_profile_id: int | None = None
    source: str = Field(min_length=2, max_length=120)
    destination: str = Field(min_length=2, max_length=120)
    interval_minutes: int = Field(ge=1, le=1440)
    instruction: str = Field(min_length=4, max_length=4000)
    template: str = Field(min_length=2, max_length=4000)
    api_provider: str = Field(min_length=2, max_length=80)
    ai_agent: str = Field(min_length=2, max_length=80)
    github_repo_url: str = Field(default="", max_length=300)
    github_project_url: str = Field(default="", max_length=300)
    notion_database_url: str = Field(default="", max_length=300)
    figma_file_url: str = Field(default="", max_length=300)
    calendar_id: str = Field(default="primary", max_length=160)
    ai_provider: str = Field(default="OpenAI", min_length=2, max_length=80)
    ai_model: str = Field(default="gpt-4o-mini", min_length=2, max_length=120)
    ai_api_base: str = Field(default="", max_length=240)
    api_key_strategy: str = Field(default="사용자별 환경변수 또는 서버 비밀 저장소에 보관", max_length=2000)
    request_template: str = Field(default="", max_length=4000)
    github_issue_template: str = Field(default="", max_length=4000)
    notion_template: str = Field(default="", max_length=4000)
    figma_template: str = Field(default="", max_length=4000)
    template_preset: str = Field(default="github_notion", max_length=80)
    custom_template: str = Field(default="", max_length=4000)
    custom_connections: list[CustomConnectionIn] = []
    status: str = "ACTIVE"
