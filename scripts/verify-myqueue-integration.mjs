import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const myqueueDir = process.env.MYQUEUE_REPO_DIR || (process.platform === "win32" ? "D:\\myqueue" : "/tmp/myqueue");
const exporter = join(myqueueDir, "scripts", "export_taskory_for_ai_board.py");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function main() {
  const temp = mkdtempSync(join(tmpdir(), "ai-board-myqueue-"));
  try {
    const statePath = join(temp, "task-explorer-state.json");
    const exportPath = join(temp, "taskory-ai-board.jsonl");
    const state = {
      nodes: {
        root: { id: "root", title: "root", children: ["project"] },
        project: {
          id: "project",
          parentId: "root",
          title: "AI Board 연동",
          memo: "Taskory 작업을 RAG와 자동화 입력으로 동기화합니다.",
          children: ["github", "notion"],
          isCustomFolder: true,
        },
        github: {
          id: "github",
          parentId: "project",
          title: "GitHub 변경사항 요약",
          memo: "최근 커밋과 이슈를 한국어로 정리합니다.",
          priority: 1,
          isToday: true,
          children: [],
        },
        notion: {
          id: "notion",
          parentId: "project",
          title: "Notion 보고서 반영",
          memo: "요청 템플릿을 유지하면서 BOARD에 기록합니다.",
          completedAt: "2026-06-11T12:00:00Z",
          completed: true,
          children: [],
        },
      },
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

    run("python", [exporter, statePath, "-o", exportPath], { cwd: myqueueDir });
    const exported = readFileSync(exportPath, "utf8");
    const records = exported.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    if (records.length !== 3) throw new Error(`Expected 3 Taskory records, got ${records.length}`);
    if (!exported.includes("최근 커밋과 이슈를 한국어로 정리합니다.")) {
      throw new Error("Taskory exporter did not preserve Korean memo text");
    }
    if (!records.some((record) => Array.isArray(record.path) && record.path.join(" > ").includes("AI Board 연동"))) {
      throw new Error("Taskory exporter did not include breadcrumb path data");
    }

    const verifier = [
      "import json, pathlib",
      "from app.taskory_import import normalize_taskory_export",
      `raw = pathlib.Path(${JSON.stringify(exportPath)}).read_text(encoding='utf-8')`,
      "normalized, detected = normalize_taskory_export(raw, 'taskory-ai-board.jsonl')",
      "assert detected is True",
      "assert 'GitHub 변경사항 요약' in normalized",
      "assert '최근 커밋과 이슈를 한국어로 정리합니다.' in normalized",
      "assert 'Notion 보고서 반영' in normalized",
      "assert '완료' in normalized",
      "print(json.dumps({'detected': detected, 'chars': len(normalized)}, ensure_ascii=False))",
    ].join("\n");
    const normalized = run("python", ["-c", verifier], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: join(repoRoot, "backend") },
    });
    const normalizedResult = JSON.parse(normalized);

    console.log(
      JSON.stringify(
        {
          ok: true,
          checked: [
            "myqueue_exporter_runs",
            "jsonl_record_count",
            "korean_text_preserved",
            "breadcrumb_path_preserved",
            "ai_board_taskory_normalizer_detects_export",
            "ai_board_taskory_normalizer_preserves_korean",
          ],
          myqueueDir,
          exporter,
          records: records.length,
          normalizedChars: normalizedResult.chars,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main();
