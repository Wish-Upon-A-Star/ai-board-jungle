from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import IntegrationProfile, KnowledgeSource, User
from .services import summarize


@dataclass
class CollectedItem:
    title: str
    source_type: str
    url: str
    text: str
    tags: list[str]


def parse_github_repo(url: str) -> tuple[str, str] | None:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.strip("/").split("/") if part]
    if parsed.netloc.lower() != "github.com" or len(parts) < 2:
        return None
    return parts[0], parts[1].removesuffix(".git")


def github_headers(token: str) -> dict:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def collect_github(profile: IntegrationProfile, limit: int = 8) -> tuple[list[CollectedItem], list[str]]:
    repo = parse_github_repo(profile.base_url)
    if not repo:
        return [], ["GitHub base URL은 https://github.com/<owner>/<repo> 형식이어야 합니다."]
    if not profile.token_value:
        return [], ["GitHub token이 없어 실제 API 수집을 건너뜁니다."]

    owner, name = repo
    targets = set(json.loads(profile.rag_targets_json or "[]"))
    issues_url = f"https://api.github.com/repos/{owner}/{name}/issues?state=all&per_page={limit}"
    commits_url = f"https://api.github.com/repos/{owner}/{name}/commits?per_page={limit}"
    pulls_url = f"https://api.github.com/repos/{owner}/{name}/pulls?state=all&per_page={limit}"
    items: list[CollectedItem] = []
    warnings: list[str] = []

    with httpx.Client(headers=github_headers(profile.token_value), timeout=15.0) as client:
        if "issues" in targets:
            response = client.get(issues_url)
            if response.is_success:
                for issue in response.json():
                    if "pull_request" in issue:
                        continue
                    labels = [label.get("name", "") for label in issue.get("labels", [])]
                    text = f"{issue.get('title', '')}\n{issue.get('body') or ''}\nstate: {issue.get('state')}\nlabels: {', '.join(labels)}"
                    items.append(CollectedItem(issue.get("title", "GitHub issue"), "github_issue", issue.get("html_url", ""), text, ["github", "issue", *labels]))
            else:
                warnings.append(f"GitHub issues 수집 실패: {response.status_code}")

        if "commits" in targets:
            response = client.get(commits_url)
            if response.is_success:
                for commit in response.json():
                    info = commit.get("commit", {})
                    message = info.get("message", "")
                    sha = commit.get("sha", "")[:12]
                    author = (info.get("author") or {}).get("name", "")
                    text = f"{message}\nsha: {sha}\nauthor: {author}\nurl: {commit.get('html_url', '')}"
                    items.append(CollectedItem(f"Commit {sha}: {message.splitlines()[0] if message else 'no message'}", "github_commit", commit.get("html_url", ""), text, ["github", "commit"]))
            else:
                warnings.append(f"GitHub commits 수집 실패: {response.status_code}")

        if "pull_requests" in targets:
            response = client.get(pulls_url)
            if response.is_success:
                for pull in response.json():
                    text = f"{pull.get('title', '')}\n{pull.get('body') or ''}\nstate: {pull.get('state')}\nmerged: {pull.get('merged_at') is not None}"
                    items.append(CollectedItem(pull.get("title", "GitHub pull request"), "github_pull_request", pull.get("html_url", ""), text, ["github", "pull_request"]))
            else:
                warnings.append(f"GitHub pull requests 수집 실패: {response.status_code}")

    return items, warnings


def notion_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }


def extract_notion_id(value: str) -> str:
    compact = value.replace("-", "")
    match = re.search(r"([0-9a-fA-F]{32})", compact)
    return match.group(1) if match else value.strip()


def notion_title(properties: dict) -> str:
    for prop in properties.values():
        if prop.get("type") == "title":
            title = "".join(part.get("plain_text", "") for part in prop.get("title", []))
            if title:
                return title
    return "Notion page"


def collect_notion(profile: IntegrationProfile, limit: int = 8) -> tuple[list[CollectedItem], list[str]]:
    if not profile.token_value:
        return [], ["Notion token이 없어 실제 API 수집을 건너뜁니다."]

    targets = set(json.loads(profile.rag_targets_json or "[]"))
    notion_id = extract_notion_id(profile.base_url)
    items: list[CollectedItem] = []
    warnings: list[str] = []

    with httpx.Client(headers=notion_headers(profile.token_value), timeout=15.0) as client:
        if "notion_database" in targets:
            response = client.post(f"https://api.notion.com/v1/databases/{notion_id}/query", json={"page_size": limit})
            if response.is_success:
                for page in response.json().get("results", []):
                    title = notion_title(page.get("properties", {}))
                    text = json.dumps(page.get("properties", {}), ensure_ascii=False)
                    items.append(CollectedItem(title, "notion_database_page", page.get("url", ""), text, ["notion", "database"]))
            else:
                warnings.append(f"Notion database 수집 실패: {response.status_code}")

        if "notion_pages" in targets:
            page_response = client.get(f"https://api.notion.com/v1/pages/{notion_id}")
            block_response = client.get(f"https://api.notion.com/v1/blocks/{notion_id}/children?page_size={limit}")
            if page_response.is_success:
                page = page_response.json()
                title = notion_title(page.get("properties", {}))
                blocks = block_response.json().get("results", []) if block_response.is_success else []
                block_text = json.dumps(blocks, ensure_ascii=False)
                items.append(CollectedItem(title, "notion_page", page.get("url", ""), block_text, ["notion", "page"]))
            else:
                warnings.append(f"Notion page 수집 실패: {page_response.status_code}")

    return items, warnings


def collect_profile_items(profile: IntegrationProfile, limit: int = 8) -> tuple[list[CollectedItem], list[str]]:
    if profile.source_kind == "github":
        return collect_github(profile, limit)
    if profile.source_kind == "notion":
        return collect_notion(profile, limit)
    return [], [f"{profile.source_kind} 수집기는 아직 커스텀 API 계획만 지원합니다."]


def save_collected_items(db: Session, user: User, profile: IntegrationProfile, items: list[CollectedItem]) -> list[KnowledgeSource]:
    saved: list[KnowledgeSource] = []
    for item in items:
        existing = db.scalar(
            select(KnowledgeSource.id).where(
                KnowledgeSource.owner_id == user.id,
                KnowledgeSource.source_type == item.source_type,
                KnowledgeSource.file_name == item.url,
            )
        )
        if existing:
            continue
        title = f"[{profile.name}] {item.title}"[:180]
        source = KnowledgeSource(
            owner_id=user.id,
            title=title,
            source_type=item.source_type,
            file_name=item.url,
            mime_type="external/api",
            instruction=f"{profile.name} 연동 프로필에서 수집한 RAG 근거입니다.",
            extracted_text=summarize(item.title, item.text) + "\n\n" + item.text[:12000],
            tags_json=json.dumps(item.tags, ensure_ascii=False),
        )
        db.add(source)
        saved.append(source)
    db.commit()
    for source in saved:
        db.refresh(source)
    return saved
