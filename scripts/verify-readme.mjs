import { existsSync, readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const checklistPath = "docs/submission-checklist.md";
const checklist = existsSync(checklistPath) ? readFileSync(checklistPath, "utf8") : "";

const requiredSnippets = [
  "## 목차",
  "## 과제 제출물 매핑",
  "## 프로젝트 개요",
  "## 주요 구현 기능",
  "## 전체 아키텍처 구조",
  "## AI 활용 기능과 구조",
  "## 사용자별 연동과 자동화",
  "## 실행 방법",
  "## 검증과 데모",
  "## 실제 외부 연동 검증 기록",
  "## 회고와 개선 아이디어",
  "React",
  "FastAPI",
  "PostgreSQL-ready SQLAlchemy",
  "Redis",
  "GitHub issues/commits/pull requests",
  "Notion database/pages",
  "Retrieval-Augmented Generation",
  "POST /mcp/rpc",
  "AI Agent",
  "npm run verify:full",
  "npm run verify:contract",
  "docs/evaluation-reports",
  "docs/demo-screenshot.png",
  "docs/submission-checklist.md",
  "| 제출 요구 | README 위치 | 구현/검증 근거 |",
];

const suspiciousPatterns = [
  /\uFFFD/,
  /\u00c2|\u00c3|\u00e2|\u00ec|\u00ed/,
  /[\u5bc3\u8e42\uf9de\u6e90\u79fb\u5ac4\u91c9]/,
];

const missing = requiredSnippets.filter((snippet) => !readme.includes(snippet));
const suspicious = suspiciousPatterns.filter((pattern) => pattern.test(readme)).map(String);
const checklistRequired = [
  "npm run demo:screenshot",
  "npm run verify:hygiene",
  "npm run verify:text",
  "npm run verify:frontend-helpers",
  "npm run verify:contract",
  "npm run verify:readme",
  "npm run verify:full:quick",
];
const checklistMissing = checklistRequired.filter((snippet) => !checklist.includes(snippet));
const screenshotPath = "docs/demo-screenshot.png";
const screenshotOk =
  existsSync(screenshotPath) && readFileSync(screenshotPath).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

if (missing.length || suspicious.length || checklistMissing.length || !screenshotOk) {
  console.error(JSON.stringify({ ok: false, missing, suspicious, checklistMissing, screenshotOk }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: "README.md", checklistPath, required: requiredSnippets.length, screenshotOk }, null, 2));
