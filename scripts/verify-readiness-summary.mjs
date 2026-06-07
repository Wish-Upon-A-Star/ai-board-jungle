import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { serverRequiredCommands } from "./verification-command-lists.mjs";

const compact = process.argv.includes("--compact");

function commandFor(cmd, args) {
  if (cmd === "node") return { executable: process.execPath, args };
  if (cmd === "npm") {
    const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(npmCli)) return { executable: process.execPath, args: [npmCli, ...args] };
    return { executable: process.platform === "win32" ? "npm.cmd" : "npm", args };
  }
  return { executable: cmd, args };
}

function runCheck(name, cmd, args, opts = {}) {
  const command = commandFor(cmd, args);
  const startedAt = Date.now();
  const result = spawnSync(command.executable, command.args, {
    shell: false,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout ?? 120000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    name,
    ok: result.status === 0,
    status: result.status,
    durationMs: Date.now() - startedAt,
    summary: output
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-(opts.summaryLines ?? 8))
      .join("\n"),
  };
}

const checks = [
  ["hygiene", "node", ["scripts/verify-hygiene.mjs"]],
  ["text", "node", ["scripts/verify-text-integrity.mjs"]],
  ["text output", "node", ["scripts/verify-text-output.mjs"]],
  ["frontend helpers", "node", ["scripts/verify-frontend-helpers.mjs"]],
  ["template presets", "node", ["scripts/verify-template-presets.mjs"]],
  ["evaluation reports", "node", ["scripts/verify-evaluation-reports.mjs"]],
  ["readme", "node", ["scripts/verify-readme.mjs"]],
  ["readme output", "node", ["scripts/verify-readme-output.mjs"], { summaryLines: 14 }],
  ["readiness output fixture", "node", ["scripts/verify-readiness-output-fixture.mjs"], { summaryLines: 90 }],
  ["command scope", "node", ["scripts/verify-command-scope.mjs"]],
  ["backend syntax", "python", ["-m", "py_compile", "backend/app/main.py", "backend/app/services.py"]],
];

const results = checks.map(([name, cmd, args, opts]) => runCheck(name, cmd, args, opts));
const failed = results.filter((item) => !item.ok);
const serverRequired = serverRequiredCommands;
const readinessNote = "This readiness summary does not start FastAPI, Vite, or Chrome CDP. Run npm run verify:full:quick for end-to-end smoke.";
const evaluationReportsResult = results.find((item) => item.name === "evaluation reports");
let latestEvaluationRound = null;
if (evaluationReportsResult?.ok) {
  try {
    latestEvaluationRound = JSON.parse(evaluationReportsResult.summary).latestRound ?? null;
  } catch {
    latestEvaluationRound = null;
  }
}

const summary = {
  ok: failed.length === 0,
  checked: results.length,
  passed: results.length - failed.length,
  failed: failed.map((item) => item.name),
  latestEvaluationRound,
  serverRequired,
  note: readinessNote,
  results,
};

if (compact) {
  console.log(`READINESS ${summary.ok ? "OK" : "FAILED"} ${summary.passed}/${summary.checked} passed; latest-evaluation-round: ${latestEvaluationRound}; server-required: ${serverRequired.join(", ")}`);
  console.log(`NOTE ${readinessNote}`);
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name} ${result.durationMs}ms`);
    if (!result.ok && result.summary) {
      console.log(result.summary);
    }
  }
} else {
  console.log(JSON.stringify(summary, null, 2));
}

if (failed.length) {
  process.exit(1);
}
