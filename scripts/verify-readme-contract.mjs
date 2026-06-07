import assert from "node:assert/strict";
import { serverlessCommands, serverRequiredCommands } from "./verification-command-lists.mjs";

export const allVerificationCommands = [...serverlessCommands, ...serverRequiredCommands];
export const expectedChecklistCommands = allVerificationCommands.length;
export const expectedChecklistItems = allVerificationCommands.length + 2;

export function buildReadmeSuccessSummary({ checklistPath, required, screenshotOk }) {
  return {
    ok: true,
    checked: "README.md",
    checklistPath,
    required,
    commandMentions: allVerificationCommands.length,
    commandExplanations: allVerificationCommands.length,
    checklistCommands: expectedChecklistCommands,
    checklistItems: expectedChecklistItems,
    screenshotOk,
  };
}

export function assertReadmeSuccessSummary(summary) {
  assert.equal(summary.ok, true, "verify-readme output must report ok=true");
  assert.equal(summary.checked, "README.md", "verify-readme output must identify README.md");
  assert.equal(summary.checklistPath, "docs/submission-checklist.md", "verify-readme output must identify the submission checklist");
  assert.equal(summary.commandMentions, allVerificationCommands.length, "README command mention count must match shared command list");
  assert.equal(summary.commandExplanations, allVerificationCommands.length, "README command explanation count must match shared command list");
  assert.equal(summary.checklistCommands, expectedChecklistCommands, "checklist command count must match shared command list");
  assert.equal(summary.checklistItems, expectedChecklistItems, "checklist item count must include demo screenshot and serverless note");
  assert.equal(summary.screenshotOk, true, "README screenshot PNG check must pass");
}
