import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serverlessCommands, serverRequiredCommands } from "./verification-command-lists.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");

function extractList(afterHeading, beforeHeading = "\n## ") {
  const start = readme.indexOf(afterHeading);
  assert.ok(start >= 0, `README missing heading text: ${afterHeading}`);
  const nextHeading = readme.indexOf(beforeHeading, start + afterHeading.length);
  const section = readme.slice(start, nextHeading === -1 ? undefined : nextHeading);
  return [...section.matchAll(/`npm run ([^`]+)`/g)].map((match) => match[1]);
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

console.log(JSON.stringify({
  ok: true,
  serverless,
  serverRequired,
}, null, 2));
