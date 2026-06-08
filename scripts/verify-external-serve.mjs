import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run } from "./verify-helpers.mjs";

const serveExternal = readFileSync("scripts/serve-external.mjs", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");

assert.equal(packageJson.scripts["serve:external"], "node scripts/serve-external.mjs", "package.json must expose serve:external");
assert.equal(packageJson.scripts["verify:external-serve"], "node scripts/verify-external-serve.mjs", "package.json must expose verify:external-serve");
assert.ok(serveExternal.includes("AI_BOARD_EXTERNAL_PORT"), "external serve must use a separate configurable port");
assert.ok(serveExternal.includes('"8130"'), "external serve default port must avoid 3000/8000");
assert.ok(serveExternal.includes("cloudflared"), "external serve must support a public tunnel");
assert.ok(!serveExternal.includes("stopLocalServers"), "external serve must not stop the current dev server");
assert.ok(readme.includes("## External Public Access"), "README must document external access");
assert.ok(readme.includes("npm run serve:external"), "README must include the external serve command");
assert.ok(readme.includes("6-10"), "README must document the expected small-team load");

run("node", ["scripts/serve-external.mjs", "--skip-build", "--no-tunnel", "--once"], {
  env: {
    AI_BOARD_EXTERNAL_PORT: "8131",
    AI_BOARD_DATABASE_URL: "sqlite:///./data/external-serve-verify.db",
  },
  timeout: 120000,
});

console.log(JSON.stringify({
  ok: true,
  checked: [
    "external serve script contract",
    "separate test port",
    "no current server shutdown",
    "single-process external smoke",
    "README external instructions",
  ],
}, null, 2));
