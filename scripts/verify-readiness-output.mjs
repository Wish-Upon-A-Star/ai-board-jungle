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
assert.ok(output.includes("READINESS OK 10/10 passed"), "compact output must include the readiness total");
assert.ok(output.includes(expectedServerRequiredLine), "compact output must list server-required checks");

const requiredLines = [
  "PASS hygiene",
  "PASS text",
  "PASS text output",
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
const textOutputResult = readinessSummary.results.find((item) => item.name === "text output");
assert.ok(textOutputResult, "json readiness must include text output result");
assert.ok(
  readmeResult.summary.includes(`"checklistCommands": ${expectedChecklistCommands}`),
  "readme summary must include checklistCommands count"
);
assert.ok(
  readmeResult.summary.includes(`"checklistItems": ${expectedChecklistItems}`),
  "readme summary must include checklistItems count"
);
assert.ok(
  textOutputResult.summary.includes('"scannedFileCount":'),
  "text output summary must include scannedFileCount"
);
assert.ok(
  textOutputResult.summary.includes('"requiredScannedFiles":'),
  "text output summary must include requiredScannedFiles"
);
assert.ok(
  textOutputResult.summary.includes('"scripts/verify-readme-contract.mjs"'),
  "text output summary must include the README contract helper"
);
assert.ok(
  textOutputResult.summary.includes('"missingRequiredFiles": []'),
  "text output summary must include missingRequiredFiles empty evidence"
);

const scannedFileCountMatch = textOutputResult.summary.match(/"scannedFileCount":\s*(\d+)/);
assert.ok(scannedFileCountMatch, "text output scannedFileCount must be parseable");
const scannedFileCount = Number(scannedFileCountMatch[1]);
assert.ok(scannedFileCount > 0, "text output scannedFileCount must be positive");

console.log(JSON.stringify({
  ok: true,
  checked: "verify-readiness-summary --compact",
  requiredLines,
  checklistCommands: expectedChecklistCommands,
  checklistItems: expectedChecklistItems,
  textOutputScannedFileCount: scannedFileCount,
}, null, 2));
