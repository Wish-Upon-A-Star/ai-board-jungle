from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AI Board API"
    database_url: str = "sqlite:///./data/demo-fastapi.db"
    jwt_secret: str = "local-dev-secret-change-me"
    token_encryption_secret: str = ""
    token_secret_provider: str = "local"
    token_secret_command: str = ""
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    github_url: str = ""
    github_token: str = ""
    github_project_url: str = ""
    notion_tasks_url: str = ""
    notion_token: str = ""
    google_calendar_id: str = "primary"
    google_access_token: str = ""
    figma_file_url: str = ""
    figma_token: str = ""
    redis_url: str = "redis://localhost:6379/0"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="AI_BOARD_")


@lru_cache
def settings() -> Settings:
    return Settings()
