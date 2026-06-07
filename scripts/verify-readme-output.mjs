import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertReadmeSuccessSummary } from "./verify-readme-contract.mjs";

const result = spawnSync(process.execPath, ["scripts/verify-readme.mjs"], {
  shell: false,
  encoding: "utf8",
  timeout: 120000,
});
const output = `${result.stdout || ""}${result.stderr || ""}`;
assert.equal(result.status, 0, `verify-readme exited with ${result.status}\n${output}`);

const summary = JSON.parse(output);
assertReadmeSuccessSummary(summary);

console.log(JSON.stringify({
  ok: true,
  checked: "verify-readme output",
  readmeChecked: summary.checked,
  checklistPath: summary.checklistPath,
  required: summary.required,
  commandMentions: summary.commandMentions,
  commandExplanations: summary.commandExplanations,
  checklistCommands: summary.checklistCommands,
  checklistItems: summary.checklistItems,
  screenshotOk: summary.screenshotOk,
}, null, 2));
