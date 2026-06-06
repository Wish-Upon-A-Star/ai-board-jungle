from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


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


class AutomationIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    source: str = Field(min_length=2, max_length=120)
    destination: str = Field(min_length=2, max_length=120)
    interval_minutes: int = Field(ge=1, le=1440)
    instruction: str = Field(min_length=4, max_length=4000)
    template: str = Field(min_length=2, max_length=4000)
    api_provider: str = Field(min_length=2, max_length=80)
    ai_agent: str = Field(min_length=2, max_length=80)
    status: str = "ACTIVE"
