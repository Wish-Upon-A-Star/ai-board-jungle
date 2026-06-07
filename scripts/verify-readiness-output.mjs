import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["scripts/verify-readiness-summary.mjs", "--compact"], {
  shell: false,
  encoding: "utf8",
  timeout: 180000,
});

const output = `${result.stdout || ""}${result.stderr || ""}`;
assert.equal(result.status, 0, `compact readiness exited with ${result.status}\n${output}`);
assert.ok(output.includes("READINESS OK 8/8 passed"), "compact output must include the readiness total");
assert.ok(
  output.includes("server-required: verify:contract, smoke:http, smoke:ui, verify:fastapi, verify:full:quick, verify:full, test:live-integrations"),
  "compact output must list server-required checks"
);

const requiredLines = [
  "PASS hygiene",
  "PASS text",
  "PASS frontend helpers",
  "PASS template presets",
  "PASS evaluation reports",
  "PASS readme",
  "PASS command scope",
  "PASS backend syntax",
];

for (const line of requiredLines) {
  assert.ok(output.includes(line), `compact output missing ${line}`);
}

console.log(JSON.stringify({
  ok: true,
  checked: "verify-readiness-summary --compact",
  requiredLines,
}, null, 2));
