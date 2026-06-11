from __future__ import annotations

import json
from typing import Any


TASKORY_TEXT_LIMIT = 20000


def normalize_taskory_export(raw_text: str, file_name: str = "") -> tuple[str, bool]:
    """Convert Taskory state/export JSON into search-friendly Korean RAG text."""
    text = raw_text.strip("\ufeff \t\r\n")
    if not text:
        return raw_text, False

    parsed = _parse_json_or_jsonl(text, file_name)
    if parsed is None:
        return raw_text, False

    records = _records_from_payload(parsed)
    if not records:
        return raw_text, False

    lines = ["Taskory 작업 자료입니다. 각 항목은 AI Board 자동화가 참고할 수 있는 작업 단위로 정리되었습니다."]
    for index, record in enumerate(records, start=1):
        title = _value(record, "title", "name", "label") or f"작업 {index}"
        path = _value(record, "path", "breadcrumb")
        kind = _value(record, "kind", "type") or "task"
        memo = _value(record, "memo", "note", "description", "content")
        status = _status_text(record)
        priority = _value(record, "priority")
        source_text = _value(record, "text")

        block = [
            f"{index}. 제목: {title}",
            f"   경로: {path}" if path else "",
            f"   종류: {kind}",
            f"   상태: {status}" if status else "",
            f"   우선순위: {priority}" if priority not in ("", None) else "",
            f"   메모: {memo}" if memo else "",
            f"   원문 요약: {source_text}" if source_text and source_text != memo else "",
        ]
        lines.extend(part for part in block if part)

    return "\n".join(lines)[:TASKORY_TEXT_LIMIT], True


def _parse_json_or_jsonl(text: str, file_name: str) -> Any | None:
    lowered = file_name.lower()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    if not lowered.endswith(".jsonl") and "\n" not in text:
        return None

    records: list[Any] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            records.append(json.loads(stripped))
        except json.JSONDecodeError:
            return None
    return records or None


def _records_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if _looks_like_taskory_record(item)]

    if not isinstance(payload, dict):
        return []

    if _looks_like_taskory_record(payload):
        return [payload]

    nodes = payload.get("nodes")
    if isinstance(nodes, dict):
        return _records_from_nodes(nodes)
    if isinstance(nodes, list):
        return [node for node in nodes if _looks_like_taskory_record(node)]

    tasks = payload.get("tasks") or payload.get("items")
    if isinstance(tasks, list):
        return [task for task in tasks if _looks_like_taskory_record(task)]

    return []


def _records_from_nodes(nodes: dict[str, Any]) -> list[dict[str, Any]]:
    parents: dict[str, str] = {}
    for node_id, node in nodes.items():
        if not isinstance(node, dict):
            continue
        for child_id in node.get("children") or []:
            parents[str(child_id)] = str(node_id)

    def path_for(node_id: str) -> str:
        titles: list[str] = []
        seen: set[str] = set()
        current = node_id
        while current and current not in seen:
            seen.add(current)
            node = nodes.get(current)
            if not isinstance(node, dict):
                break
            title = _value(node, "title", "name")
            if title and current != "root":
                titles.append(title)
            current = str(node.get("parentId") or parents.get(current) or "")
        return " > ".join(reversed(titles))

    records: list[dict[str, Any]] = []
    for node_id, node in nodes.items():
        if not isinstance(node, dict) or str(node_id) == "root":
            continue
        record = dict(node)
        record.setdefault("id", node_id)
        record.setdefault("path", path_for(str(node_id)))
        if _looks_like_taskory_record(record):
            records.append(record)
    return records


def _looks_like_taskory_record(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    keys = {str(key) for key in value.keys()}
    return bool(keys & {"title", "name", "path", "memo", "children", "isDone", "completedAt", "priority", "text"})


def _value(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if value is None:
            continue
        if isinstance(value, (list, dict)):
            continue
        string_value = str(value).strip()
        if string_value:
            return string_value
    return ""


def _status_text(record: dict[str, Any]) -> str:
    if record.get("isDone") is True or _value(record, "completedAt"):
        return "완료"
    if record.get("isToday") is True:
        return "오늘 작업"
    if record.get("archived") is True:
        return "보관됨"
    return "진행/대기"
