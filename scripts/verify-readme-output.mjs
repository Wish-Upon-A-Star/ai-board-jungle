import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { serverlessCommands, serverRequiredCommands } from "./verification-command-lists.mjs";

const allVerificationCommands = [...serverlessCommands, ...serverRequiredCommands];
const expectedChecklistCommands = allVerificationCommands.length;
const expectedChecklistItems = allVerificationCommands.length + 2;

const result = spawnSync(process.execPath, ["scripts/verify-readme.mjs"], {
  shell: false,
  encoding: "utf8",
  timeout: 120000,
});
const output = `${result.stdout || ""}${result.stderr || ""}`;
assert.equal(result.status, 0, `verify-readme exited with ${result.status}\n${output}`);

const summary = JSON.parse(output);
assert.equal(summary.ok, true, "verify-readme output must report ok=true");
assert.equal(summary.checked, "README.md", "verify-readme output must identify README.md");
assert.equal(summary.checklistPath, "docs/submission-checklist.md", "verify-readme output must identify the submission checklist");
assert.equal(summary.commandMentions, allVerificationCommands.length, "README command mention count must match shared command list");
assert.equal(summary.commandExplanations, allVerificationCommands.length, "README command explanation count must match shared command list");
assert.equal(summary.checklistCommands, expectedChecklistCommands, "checklist command count must match shared command list");
assert.equal(summary.checklistItems, expectedChecklistItems, "checklist item count must include demo screenshot and serverless note");
assert.equal(summary.screenshotOk, true, "README screenshot PNG check must pass");

console.log(JSON.stringify({
  ok: true,
  checked: "verify-readme output",
  commandMentions: summary.commandMentions,
  commandExplanations: summary.commandExplanations,
  checklistCommands: summary.checklistCommands,
  checklistItems: summary.checklistItems,
  screenshotOk: summary.screenshotOk,
}, null, 2));
