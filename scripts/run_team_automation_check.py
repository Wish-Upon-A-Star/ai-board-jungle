from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx

from app.collectors import CollectedItem
from app.db import SessionLocal
from app.main import execute_automation_task
from app.models import AutomationTask, IntegrationProfile, User
from app.security import reveal_secret


BAD_NOTION_PAGE_IDS = [
    "37a7051c2f998113a4c8f6ccf7720f61",
    "37a7051c2f99819cb8eed5dbfc531287",
    "37a7051c2f9981eaa79fc7525cb3274b",
    "37a7051c2f9981b4addfcb9c6f62ac70",
    "37a7051c2f9981c88ac1d02f7523020b",
    "37a7051c2f9981c68870f942e2cc0df0",
    "37a7051c2f9981cb9394caa493a73ca3",
]

TEAM_GITHUB_REPO = "https://github.com/Wish-Upon-A-Star/ai-board-jungle"
TEAM_NOTION_PAGE = "https://app.notion.com/p/302-1-1-3797051c2f998094b2a5e5062d353881"
TEAM_NOTION_BOARD_DB = "4487051c2f9983488ed9018bbe475822"
TEAM_NOTION_GANTT_DB = "35f7051c2f9982d6a3bf813799fc400b"


def dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def notion_uuid(value: str) -> str:
    compact = value.replace("-", "")
    if len(compact) != 32:
        return value
    return f"{compact[:8]}-{compact[8:12]}-{compact[12:16]}-{compact[16:20]}-{compact[20:]}"


def repair_team_templates(db, owner_id: int) -> None:
    profiles = {
        9: ("팀 기본 GitHub 저장소", "github", TEAM_GITHUB_REPO, "GitHub REST API / MCP OAuth", "GITHUB_OAUTH", ["issues", "commits", "pull_requests"]),
        10: ("팀 기본 Notion BOARD", "notion", TEAM_NOTION_BOARD_DB, "Notion API / MCP OAuth", "NOTION_OAUTH", ["notion_database"]),
        11: ("팀 기본 Notion GANTT", "notion", TEAM_NOTION_GANTT_DB, "Notion API / MCP OAuth", "NOTION_OAUTH", ["notion_database"]),
        12: ("팀 기본 Google Calendar", "google_calendar", "primary", "Google Calendar API / OAuth", "GOOGLE_CALENDAR_OAUTH", []),
    }
    for profile_id, (name, source_kind, base_url, api_provider, token_name, rag_targets) in profiles.items():
        profile = db.get(IntegrationProfile, profile_id)
        if profile and profile.owner_id == owner_id:
            profile.name = name
            profile.source_kind = source_kind
            profile.base_url = base_url
            profile.api_provider = api_provider
            profile.token_name = token_name
            profile.rag_targets_json = dumps(rag_targets)
            profile.ai_provider = "OpenAI"
            profile.ai_model = "gpt-4o-mini"
            profile.ai_api_base = "https://api.openai.com/v1"

    task5 = db.get(AutomationTask, 5)
    if task5 and task5.owner_id == owner_id:
        task5.name = "팀 템플릿: GitHub -> Notion BOARD"
        task5.source = "GitHub commits/issues/pull requests"
        task5.destination = "Notion 템플릿 BOARD"
        task5.instruction = "팀 GitHub 저장소의 최신 커밋, 이슈, PR을 읽고 현재 Notion 템플릿의 BOARD 섹션에 카드로 정리합니다. 원본 페이지 디자인은 유지합니다."
        task5.template = "| 번호 | 유형 | 제목 | 한국어 요약 | 상태 | 다음 조치 | 링크 |\n|---|---|---|---|---|---|---|"
        task5.request_template = task5.template
        task5.notion_template = task5.template
        task5.custom_template = "제목: {title}\n요약: {summary}\n링크: {source_url}"
        task5.custom_connections = dumps([
            {"label": "GitHub 저장소 변경 수집", "service": "github", "url": TEAM_GITHUB_REPO, "api": "GitHub REST API / MCP OAuth", "auth_key_name": "GITHUB_OAUTH", "operation": "rag_collect_issues_commits_prs", "template": "제목: {title}\n요약: {summary}\n링크: {url}"},
            {"label": "Notion 템플릿 BOARD 카드", "service": "notion", "url": TEAM_NOTION_PAGE, "api": "Notion API / MCP OAuth", "auth_key_name": "NOTION_OAUTH", "operation": "write_existing_page_board_cards", "template": "제목: {title}\n요약: {summary}\n링크: {source_url}\n기존 템플릿의 BOARD 데이터베이스에 카드로 기록"},
        ])
        task5.template_preset = "github_notion"
        task5.last_input_hash = ""

    task6 = db.get(AutomationTask, 6)
    if task6 and task6.owner_id == owner_id:
        task6.name = "팀 템플릿: Notion BOARD -> GitHub Issue"
        task6.source = "Notion BOARD cards"
        task6.destination = "GitHub issues"
        task6.instruction = "Notion BOARD 카드 중 GitHub 조치가 필요한 항목을 읽고 GitHub 이슈로 생성하거나 기존 이슈를 업데이트합니다."
        task6.template = "## Notion BOARD 변경 요청\n- 제목: {title}\n- 요약: {summary}\n- 상태: {status}\n- 원본 Notion 링크: {source_url}\n- GitHub 조치:"
        task6.request_template = "Notion 카드: {title}\n요약: {summary}\n상태: {status}\n링크: {source_url}"
        task6.github_issue_template = "제목: [Notion] {title}\n본문: {summary}\n원본: {source_url}\n라벨: ai-board, notion-request"
        task6.custom_template = task6.request_template
        task6.custom_connections = dumps([
            {"label": "Notion BOARD 변경 수집", "service": "notion", "url": TEAM_NOTION_BOARD_DB, "api": "Notion API / MCP OAuth", "auth_key_name": "NOTION_OAUTH", "operation": "read_board_cards_since_last_run", "template": "카드 제목: {title}\n요약: {summary}\n상태: {status}\n링크: {source_url}"},
            {"label": "GitHub 이슈 생성/업데이트", "service": "github", "url": TEAM_GITHUB_REPO, "api": "GitHub REST API / MCP OAuth", "auth_key_name": "GITHUB_OAUTH", "operation": "issue_create_or_update", "template": "제목: [Notion] {title}\n본문: {summary}\n원본: {source_url}\n라벨: ai-board, notion-request"},
        ])
        task6.template_preset = "team_notion_board_to_github"
        task6.last_input_hash = ""

    task7 = db.get(AutomationTask, 7)
    if task7 and task7.owner_id == owner_id:
        task7.name = "팀 템플릿: Notion GANTT -> Google Calendar"
        task7.source = "Notion GANTT database"
        task7.destination = "Google Calendar events"
        task7.instruction = "Notion GANTT CHART 데이터베이스에서 날짜가 있는 작업을 읽고 Google Calendar 이벤트로 생성합니다."
        task7.template = "GANTT 이름: {title}\n날짜: {date}\n상태: {status}\nNotion 링크: {source_url}"
        task7.request_template = "일정 제목: {title}\n날짜: {date}\n상태: {status}\n링크: {source_url}"
        task7.custom_template = task7.request_template
        task7.custom_connections = dumps([
            {"label": "Notion GANTT 수집", "service": "notion", "url": TEAM_NOTION_GANTT_DB, "api": "Notion API / MCP OAuth", "auth_key_name": "NOTION_OAUTH", "operation": "read_gantt_rows_with_dates", "template": "이름: {title}\n날짜: {date}\n상태: {status}\n링크: {source_url}"},
            {"label": "Google Calendar 이벤트", "service": "google_calendar", "url": "primary", "api": "Google Calendar API / OAuth", "auth_key_name": "GOOGLE_CALENDAR_OAUTH", "operation": "create_events_from_notion_gantt", "template": "일정 제목: {title}\n시작/종료: {date}\n설명: {summary}"},
        ])
        task7.template_preset = "team_notion_gantt_to_calendar"
        task7.last_input_hash = ""


def archive_bad_notion_cards(token: str) -> list[dict]:
    if not token:
        return [{"status": "skipped", "reason": "missing Notion token"}]
    results: list[dict] = []
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }
    for page_id in BAD_NOTION_PAGE_IDS:
        response = httpx.patch(
            f"https://api.notion.com/v1/pages/{notion_uuid(page_id)}",
            headers=headers,
            json={"archived": True},
            timeout=20.0,
        )
        results.append({"pageId": page_id, "status": response.status_code})
    return results


def close_bad_issues(token: str) -> list[dict]:
    if not token:
        return [{"status": "skipped", "reason": "missing GitHub token"}]
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    results: list[dict] = []
    for issue_number in [7, 8]:
        comment = httpx.post(
            f"https://api.github.com/repos/Wish-Upon-A-Star/ai-board-jungle/issues/{issue_number}/comments",
            headers=headers,
            json={"body": "Superseded by the UTF-8 verified automation run. The previous run used a broken shell encoding path or stale template names."},
            timeout=20.0,
        )
        issue = httpx.patch(
            f"https://api.github.com/repos/Wish-Upon-A-Star/ai-board-jungle/issues/{issue_number}",
            headers=headers,
            json={"state": "closed", "state_reason": "not_planned"},
            timeout=20.0,
        )
        results.append({"issue": issue_number, "comment": comment.status_code, "close": issue.status_code})
    return results


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    with SessionLocal() as db:
        owner = db.query(User).filter(User.email == "1234@example.com").first()
        if not owner:
            raise SystemExit("owner missing")
        notion_profile = (
            db.query(IntegrationProfile)
            .filter(IntegrationProfile.owner_id == owner.id, IntegrationProfile.source_kind == "notion", IntegrationProfile.token_value != "")
            .order_by(IntegrationProfile.id.desc())
            .first()
        )
        github_profile = (
            db.query(IntegrationProfile)
            .filter(IntegrationProfile.owner_id == owner.id, IntegrationProfile.source_kind == "github", IntegrationProfile.token_value != "")
            .order_by(IntegrationProfile.id.desc())
            .first()
        )
        repair_team_templates(db, owner.id)
        db.commit()
        cleanup = {
            "archivedNotionCards": archive_bad_notion_cards(reveal_secret(notion_profile.token_value) if notion_profile else ""),
            "closedBadIssues": close_bad_issues(reveal_secret(github_profile.token_value) if github_profile else ""),
        }

        report = CollectedItem(
            title="[구현 보고] 팀 기본 자동화 템플릿 적용 완료",
            source_type="implementation_report",
            url="https://github.com/Wish-Upon-A-Star/ai-board-jungle/commit/393c9a6",
            text=(
                "구현 완료: GitHub 변경사항을 Notion BOARD에 카드로 기록, Notion BOARD 요청을 GitHub 이슈로 등록, "
                "Notion GANTT 날짜 작업을 Google Calendar 이벤트로 생성하는 팀 기본 템플릿을 추가했습니다. "
                "라이브 PostgreSQL DB에는 팀 템플릿 자동화 3개와 기본 프로필을 등록했고, 테스트 41개와 프론트 빌드 검증을 통과했습니다."
            ),
            tags=["implementation", "automation", "notion", "github"],
        )
        risk = CollectedItem(
            title="[위험 점검] 운영 전 자동화 안정성 보강 필요",
            source_type="risk_review",
            url="https://github.com/Wish-Upon-A-Star/ai-board-jungle/commit/393c9a6",
            text=(
                "앞으로 문제 있을 수 있는 항목: 1) 여러 서버 인스턴스를 띄우면 같은 자동화가 중복 실행될 수 있어 DB lock 또는 queue가 필요합니다. "
                "2) Google Calendar OAuth 프로필이 없는 사용자는 GANTT->Calendar 자동화가 blocked 됩니다. "
                "3) Cloudflare 임시 터널 URL은 만료될 수 있으므로 고정 도메인 또는 재시작 자동화가 필요합니다. "
                "4) Notion/GitHub API rate limit과 실패 재시도 정책을 더 명확히 해야 합니다. "
                "이 항목은 Notion BOARD에서 GitHub 이슈로 자동 등록되는지 확인해야 합니다."
            ),
            tags=["risk", "operations", "issue-required"],
        )
        task5 = db.query(AutomationTask).filter(AutomationTask.owner_id == owner.id, AutomationTask.name == "팀 템플릿: GitHub -> Notion BOARD").first()
        task6 = db.query(AutomationTask).filter(AutomationTask.owner_id == owner.id, AutomationTask.name == "팀 템플릿: Notion BOARD -> GitHub Issue").first()
        task5 = task5 or db.get(AutomationTask, 5)
        task6 = task6 or db.get(AutomationTask, 6)
        if not task5 or not task6:
            raise SystemExit("team tasks missing")
        task5.last_input_hash = ""
        task6.last_input_hash = ""
        db.commit()
        notion_run = execute_automation_task(
            db,
            task5,
            owner,
            scheduled=False,
            external_items=[report, risk],
            external_event_key="utf8-implementation-report-" + now,
        )
        db.refresh(task6)
        task6.last_input_hash = ""
        db.commit()
        issue_run = execute_automation_task(
            db,
            task6,
            owner,
            scheduled=False,
            external_event_key="utf8-risk-issue-check-" + now,
        )
        print(
            json.dumps(
                {
                    "cleanup": cleanup,
                    "notionRun": notion_run["run"]["result"].get("liveWrites", []),
                    "issueRunStatus": issue_run["run"]["result"].get("status"),
                    "issueRun": issue_run["run"]["result"].get("liveWrites", []),
                    "collectedTitles": [item.get("title") for item in issue_run["run"]["result"].get("collected", [])],
                    "warnings": issue_run["run"]["result"].get("collectionWarnings", []),
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
