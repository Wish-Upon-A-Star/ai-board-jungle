import { existsSync, readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const checklistPath = "docs/submission-checklist.md";
const checklist = existsSync(checklistPath) ? readFileSync(checklistPath, "utf8") : "";

const requiredSnippets = [
  "## 목차",
  "## 과제 제출물 매핑",
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
  "docs/evaluation-reports",
  "docs/demo-screenshot.png",
  "docs/submission-checklist.md",
  "| 제출 요구 | README 위치 | 구현/검증 근거 |",
];

const suspiciousPatterns = [
  /\uFFFD/,
  /[?]{2,}/,
  /\u00c2|\u00c3|\u00e2|\u00ec|\u00ed/,
];

const missing = requiredSnippets.filter((snippet) => !readme.includes(snippet));
const suspicious = suspiciousPatterns.filter((pattern) => pattern.test(readme)).map(String);
const checklistRequired = [
  "npm run demo:screenshot",
  "npm run verify:hygiene",
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
