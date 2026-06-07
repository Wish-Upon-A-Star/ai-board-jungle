import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { serverRequiredCommands } from "./verification-command-lists.mjs";
import { expectedChecklistCommands, expectedChecklistItems } from "./verify-readme-contract.mjs";

const expectedServerRequiredLine = `server-required: ${serverRequiredCommands.join(", ")}`;

const result = spawnSync(process.execPath, ["scripts/verify-readiness-summary.mjs", "--compact"], {
  shell: false,
  encoding: "utf8",
  timeout: 180000,
});

const output = `${result.stdout || ""}${result.stderr || ""}`;
assert.equal(result.status, 0, `compact readiness exited with ${result.status}\n${output}`);
assert.ok(output.includes("READINESS OK 9/9 passed"), "compact output must include the readiness total");
assert.ok(output.includes(expectedServerRequiredLine), "compact output must list server-required checks");

const requiredLines = [
  "PASS hygiene",
  "PASS text",
  "PASS frontend helpers",
  "PASS template presets",
  "PASS evaluation reports",
  "PASS readme",
  "PASS readme output",
  "PASS command scope",
  "PASS backend syntax",
];

for (const line of requiredLines) {
  assert.ok(output.includes(line), `compact output missing ${line}`);
}

const jsonResult = spawnSync(process.execPath, ["scripts/verify-readiness-summary.mjs"], {
  shell: false,
  encoding: "utf8",
  timeout: 180000,
});
const jsonOutput = `${jsonResult.stdout || ""}${jsonResult.stderr || ""}`;
assert.equal(jsonResult.status, 0, `json readiness exited with ${jsonResult.status}\n${jsonOutput}`);

const readinessSummary = JSON.parse(jsonOutput);
const readmeResult = readinessSummary.results.find((item) => item.name === "readme");
assert.ok(readmeResult, "json readiness must include readme result");
assert.ok(
  readmeResult.summary.includes(`"checklistCommands": ${expectedChecklistCommands}`),
  "readme summary must include checklistCommands count"
);
assert.ok(
  readmeResult.summary.includes(`"checklistItems": ${expectedChecklistItems}`),
  "readme summary must include checklistItems count"
);

console.log(JSON.stringify({
  ok: true,
  checked: "verify-readiness-summary --compact",
  requiredLines,
  checklistCommands: expectedChecklistCommands,
  checklistItems: expectedChecklistItems,
}, null, 2));
