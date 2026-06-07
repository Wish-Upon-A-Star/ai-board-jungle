import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const importProbe = `
import('./scripts/verify-readiness-summary.mjs').then((module) => {
  const requiredExports = [
    'readinessNote',
    'checks',
    'getReadinessChecks',
    'buildReadinessSummary',
    'formatCompactReadinessSummary',
    'runReadinessSummaryCli',
  ];
  for (const exportName of requiredExports) {
    if (!(exportName in module)) {
      throw new Error('missing export ' + exportName);
    }
  }
  if (typeof module.buildReadinessSummary !== 'function') {
    throw new Error('buildReadinessSummary must be a function');
  }
  if (typeof module.formatCompactReadinessSummary !== 'function') {
    throw new Error('formatCompactReadinessSummary must be a function');
  }
});
`;

const startedAt = Date.now();
const result = spawnSync(process.execPath, ["-e", importProbe], {
  shell: false,
  encoding: "utf8",
  timeout: 5000,
});
const durationMs = Date.now() - startedAt;
const stdout = result.stdout || "";
const stderr = result.stderr || "";

assert.equal(result.status, 0, `readiness summary import probe exited with ${result.status}\n${stdout}${stderr}`);
assert.equal(stdout, "", "importing verify-readiness-summary must not print JSON or compact readiness output");
assert.equal(stderr, "", "importing verify-readiness-summary must not print errors or warnings");
assert.ok(
  durationMs < 2000,
  `importing verify-readiness-summary must not run the full readiness suite; observed ${durationMs}ms`
);

console.log(JSON.stringify({
  ok: true,
  checked: "verify-readiness-summary import fixture",
  exportsChecked: [
    "readinessNote",
    "checks",
    "getReadinessChecks",
    "buildReadinessSummary",
    "formatCompactReadinessSummary",
    "runReadinessSummaryCli",
  ],
  durationMs,
  stdoutBytes: stdout.length,
  stderrBytes: stderr.length,
}, null, 2));
