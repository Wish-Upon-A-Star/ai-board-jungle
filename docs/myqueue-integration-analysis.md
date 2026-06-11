# myqueue(Taskory) 연동 분석

## 확인 대상

- 저장소: `Wish-Upon-A-Star/myqueue`
- 로컬 클론: `D:\myqueue`
- 확인 커밋: `85b04f8 Add Taskory sync replacement verifier`
- 성격: Python/customtkinter 기반 Taskory 데스크톱 작업 관리 앱

## AI Board와 바로 연동할 수 있는 지점

1. `task-explorer-state.json`
   - Taskory의 원본 작업 상태 파일입니다.
   - AI Board는 이 JSON을 `taskory` 지식자료로 업로드하면 작업 제목, 경로, 메모, 상태를 RAG 문맥으로 정규화합니다.

2. `scripts/export_taskory_for_ai_board.py`
   - Taskory 상태를 AI Board 친화 JSONL로 내보냅니다.
   - 각 작업은 `title`, `path`, `memo`, `flags`, `priority`, `text`를 포함합니다.
   - 한국어 메모와 경로가 UTF-8로 보존되는지 `npm run verify:myqueue-integration`에서 검증합니다.

3. `scripts/sync_taskory_to_ai_board.py`
   - Taskory 상태 파일 해시가 바뀐 경우에만 AI Board `/api/knowledge/upload`로 업로드합니다.
   - 업로드가 성공한 뒤 이전 Taskory 지식자료를 교체하므로 RAG 자료가 중복 누적되지 않습니다.
   - 업로드 실패 시 기존 자료와 마지막 동기화 해시는 유지됩니다.

## AI Board에 반영한 검증

- `scripts/verify-myqueue-integration.mjs`
  - `D:\myqueue\scripts\export_taskory_for_ai_board.py`를 실제로 실행합니다.
  - 샘플 Taskory 상태를 JSONL로 내보냅니다.
  - AI Board `normalize_taskory_export`가 JSONL을 감지하고 한국어 제목/메모/완료 상태를 보존하는지 확인합니다.

## 추천 사용 흐름

1. Taskory에서 작업을 정리합니다.
2. `python D:\myqueue\scripts\export_taskory_for_ai_board.py task-explorer-state.json -o taskory-ai-board.jsonl`을 실행합니다.
3. AI Board `지식자료` 탭에서 자료 종류를 `Taskory 작업 내보내기`로 선택하고 JSONL을 업로드합니다.
4. 자동화의 RAG 대상에 `taskory` 또는 업로드 자료명을 넣습니다.
5. GitHub/Notion/Figma/Calendar 자동화가 Taskory 작업 맥락을 참고해 실행됩니다.

## 다음 개선 후보

- AI Board UI에서 Taskory 동기화 상태, 마지막 업로드 시간, 작업 수를 프로필 카드처럼 보여주기.
- Taskory watcher를 AI Board 안에서 관리하는 전용 통합 프로필 추가.
- Taskory 작업을 GitHub issue 또는 Notion BOARD 카드로 생성하는 템플릿 프리셋 추가.
