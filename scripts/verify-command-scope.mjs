import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  serverlessCommands,
  serverRequiredCommands,
  safeLocalVerificationOrder,
  serverRequiredConcurrencyNote,
  serverRequiredExclusivePorts,
} from "./verification-command-lists.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");
const submissionChecklist = readFileSync("docs/submission-checklist.md", "utf8");

function extractList(afterHeading, beforeHeading = "\n## ") {
  const start = readme.indexOf(afterHeading);
  assert.ok(start >= 0, `README missing heading text: ${afterHeading}`);
  const nextHeading = readme.indexOf(beforeHeading, start + afterHeading.length);
  const section = readme.slice(start, nextHeading === -1 ? undefined : nextHeading);
  return [...section.matchAll(/`npm run ([^`]+)`/g)].map((match) => match[1]);
}

function assertSafeOrder(content, label) {
  const headingIndex = content.indexOf("Safe local verification order:");
  assert.ok(headingIndex >= 0, `${label} must include a safe local verification order example`);
  let previousIndex = headingIndex;
  for (const command of safeLocalVerificationOrder) {
    const commandIndex = content.indexOf(`npm run ${command}`, previousIndex);
    assert.ok(commandIndex > previousIndex, `${label} safe local verification order must list ${command} in order`);
    previousIndex = commandIndex;
  }
}

const serverless = extractList(
  "Serverless checks do not start FastAPI, Vite, or Chrome CDP:",
  "\nServer-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials:"
);
const serverRequired = extractList("Server-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials:");
const scriptNames = new Set(Object.keys(packageJson.scripts || {}));

assert.deepEqual(serverless, serverlessCommands, "README serverless command list must match expected order");
assert.deepEqual(serverRequired, serverRequiredCommands, "README server-required command list must match expected order");

for (const command of [...serverless, ...serverRequired]) {
  assert.ok(scriptNames.has(command), `package.json missing script ${command}`);
}

const overlap = serverless.filter((command) => serverRequired.includes(command));
assert.deepEqual(overlap, [], "serverless and server-required command lists must not overlap");
for (const command of safeLocalVerificationOrder) {
  assert.ok(scriptNames.has(command), `package.json missing safe verification order script ${command}`);
}
assert.ok(
  readme.includes(serverRequiredConcurrencyNote),
  "README must warn that server-required checks run sequentially"
);
assert.ok(
  submissionChecklist.includes(serverRequiredConcurrencyNote),
  "submission checklist must warn that server-required checks run sequentially"
);
assertSafeOrder(readme, "README");
assertSafeOrder(submissionChecklist, "submission checklist");

console.log(JSON.stringify({
  ok: true,
  serverless,
  serverRequired,
  serverRequiredExclusivePorts,
  serverRequiredConcurrencyNote,
  safeLocalVerificationOrder,
}, null, 2));
