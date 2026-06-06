import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");

const requiredSnippets = [
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
];

const suspiciousPatterns = [
  /\uFFFD/,
  /[?]{2,}/,
  /\u00c2|\u00c3|\u00e2|\u00ec|\u00ed/,
];

const missing = requiredSnippets.filter((snippet) => !readme.includes(snippet));
const suspicious = suspiciousPatterns.filter((pattern) => pattern.test(readme)).map(String);

if (missing.length || suspicious.length) {
  console.error(JSON.stringify({ ok: false, missing, suspicious }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: "README.md", required: requiredSnippets.length }, null, 2));
