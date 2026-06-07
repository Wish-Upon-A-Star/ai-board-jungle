import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { serverRequiredCommands } from "./verification-command-lists.mjs";

export const readinessNote = "This readiness summary does not start FastAPI, Vite, or Chrome CDP. Run npm run verify:full:quick for end-to-end smoke.";

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

export const checks = [
  ["hygiene", "node", ["scripts/verify-hygiene.mjs"]],
  ["text", "node", ["scripts/verify-text-integrity.mjs"]],
  ["text output", "node", ["scripts/verify-text-output.mjs"]],
  ["frontend helpers", "node", ["scripts/verify-frontend-helpers.mjs"]],
  ["template presets", "node", ["scripts/verify-template-presets.mjs"]],
  ["evaluation reports", "node", ["scripts/verify-evaluation-reports.mjs"]],
  ["readme", "node", ["scripts/verify-readme.mjs"]],
  ["readme output", "node", ["scripts/verify-readme-output.mjs"], { summaryLines: 14 }],
  ["readiness import fixture", "node", ["scripts/verify-readiness-import-fixture.mjs"]],
  ["readiness output fixture", "node", ["scripts/verify-readiness-output-fixture.mjs"], { summaryLines: 130 }],
  ["command scope", "node", ["scripts/verify-command-scope.mjs"]],
  ["backend syntax", "python", ["-m", "py_compile", "backend/app/main.py", "backend/app/services.py"]],
];

export function getReadinessChecks({ forceFailCompactFixture = false } = {}) {
  const selectedChecks = checks.map((check) => [...check]);

  if (forceFailCompactFixture) {
    const fixtureCheckIndex = selectedChecks.findIndex(([name]) => name === "readiness output fixture");
    if (fixtureCheckIndex >= 0) {
      selectedChecks.splice(fixtureCheckIndex, 1);
    }
    selectedChecks.push([
      "synthetic compact failure",
      "node",
      ["-e", "console.log('synthetic injected compact failure summary'); process.exit(1);"],
      { summaryLines: 4 },
    ]);
  }

  return selectedChecks;
}

export function buildReadinessSummary({ forceFailCompactFixture = false } = {}) {
  const results = getReadinessChecks({ forceFailCompactFixture })
    .map(([name, cmd, args, opts]) => runCheck(name, cmd, args, opts));
  const failed = results.filter((item) => !item.ok);
  const serverRequired = serverRequiredCommands;
  const evaluationReportsResult = results.find((item) => item.name === "evaluation reports");
  let latestEvaluationRound = null;
  if (evaluationReportsResult?.ok) {
    try {
      latestEvaluationRound = JSON.parse(evaluationReportsResult.summary).latestRound ?? null;
    } catch {
      latestEvaluationRound = null;
    }
  }

  return {
    ok: failed.length === 0,
    checked: results.length,
    passed: results.length - failed.length,
    failed: failed.map((item) => item.name),
    latestEvaluationRound,
    serverRequired,
    note: readinessNote,
    results,
  };
}

export function formatCompactReadinessSummary(summary) {
  const lines = [
    `READINESS ${summary.ok ? "OK" : "FAILED"} ${summary.passed}/${summary.checked} passed; latest-evaluation-round: ${summary.latestEvaluationRound}; server-required: ${summary.serverRequired.join(", ")}`,
    `NOTE ${summary.note}`,
  ];

  for (const result of summary.results) {
    lines.push(`${result.ok ? "PASS" : "FAIL"} ${result.name} ${result.durationMs}ms`);
    if (!result.ok && result.summary) {
      lines.push(result.summary);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function runReadinessSummaryCli({
  compact = process.argv.includes("--compact"),
  forceFailCompactFixture = process.env.AI_BOARD_READINESS_FORCE_FAIL === "1",
} = {}) {
  const summary = buildReadinessSummary({ forceFailCompactFixture });
  if (compact) {
    process.stdout.write(formatCompactReadinessSummary(summary));
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }

  if (!summary.ok) {
    process.exitCode = 1;
  }

  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReadinessSummaryCli();
}
