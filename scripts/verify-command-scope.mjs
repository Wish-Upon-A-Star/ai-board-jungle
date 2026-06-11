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
  return [...section.matchAll(/`?npm run ([A-Za-z0-9:_-]+)`?/g)].map((match) => match[1]);
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

const validSafeOrderExample = [
  "Safe local verification order:",
  "",
  "```powershell",
  ...safeLocalVerificationOrder.map((command) => `npm run ${command}`),
  "```",
].join("\n");
const reversedSafeOrderExample = [
  "Safe local verification order:",
  "",
  "```powershell",
  ...[...safeLocalVerificationOrder].reverse().map((command) => `npm run ${command}`),
  "```",
].join("\n");
const partialSafeOrderExample = [
  "Safe local verification order:",
  "",
  "```powershell",
  ...safeLocalVerificationOrder.slice(0, -1).map((command) => `npm run ${command}`),
  "```",
].join("\n");
const safeOrderNegativeScenarios = [
  "missingSafeOrderHeading",
  "reorderedSafeOrder",
  "partialSafeOrder",
];

const serverless = extractList(
  "Serverless checks do not start FastAPI, Vite, or Chrome CDP:",
  "\nServer-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials:"
);
const serverRequired = extractList(
  "Server-required checks start or expect FastAPI, Vite, Chrome CDP, or live API credentials:",
  "\nSafe local verification order:"
);
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
assert.doesNotThrow(
  () => assertSafeOrder(validSafeOrderExample, "synthetic valid safe order"),
  "synthetic safe local verification order fixture must pass"
);
assert.throws(
  () => assertSafeOrder("", "synthetic missing safe order heading"),
  /safe local verification order example/,
  "synthetic safe order fixture without heading must fail"
);
assert.throws(
  () => assertSafeOrder(reversedSafeOrderExample, "synthetic reordered safe order"),
  /must list verify:command-scope in order/,
  "synthetic safe order fixture with reversed commands must fail"
);
assert.throws(
  () => assertSafeOrder(partialSafeOrderExample, "synthetic partial safe order"),
  /must list verify:full:quick in order/,
  "synthetic safe order fixture without final server-required command must fail"
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
  safeOrderNegativeScenarios,
}, null, 2));
