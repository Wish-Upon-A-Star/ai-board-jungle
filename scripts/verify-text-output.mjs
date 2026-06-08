import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const requiredScannedFiles = ["scripts/verify-readme-contract.mjs"];
const requiredSourceGuards = [
  { name: "redisCacheFallbackCatchesMalformedHandshake", file: "backend/app/cache.py" },
  { name: "redisCacheFallbackRagRegressionTest", file: "backend/tests/test_api.py" },
];

const result = spawnSync(process.execPath, ["scripts/verify-text-integrity.mjs"], {
  shell: false,
  encoding: "utf8",
  timeout: 120000,
});

const output = `${result.stdout || ""}${result.stderr || ""}`;
assert.equal(result.status, 0, `text integrity exited with ${result.status}\n${output}`);

const summary = JSON.parse(output);

assert.equal(summary.ok, true, "text integrity output must report ok=true");
assert.equal(typeof summary.checked, "number", "text integrity checked count must be numeric");
assert.ok(summary.checked > 0, "text integrity must scan at least one file");
assert.deepEqual(summary.requiredScannedFiles, requiredScannedFiles, "text integrity must report required scanned files");
assert.deepEqual(summary.missingRequiredFiles, [], "text integrity must report no missing required files");
assert.deepEqual(summary.sourceGuards, requiredSourceGuards, "text integrity must report cache fallback source guards");
assert.deepEqual(summary.missingSourceGuards, [], "text integrity must report no missing source guards");
assert.deepEqual(summary.hits, [], "text integrity must report no suspicious text hits");
assert.equal(
  Object.hasOwn(summary, "missingRequiredScans"),
  false,
  "successful text integrity output must not include missingRequiredScans"
);

console.log(JSON.stringify({
  ok: true,
  checked: "verify-text output",
  requiredScannedFiles: summary.requiredScannedFiles,
  missingRequiredFiles: summary.missingRequiredFiles,
  sourceGuards: summary.sourceGuards,
  missingSourceGuards: summary.missingSourceGuards,
  hits: summary.hits,
  scannedFileCount: summary.checked,
}, null, 2));
