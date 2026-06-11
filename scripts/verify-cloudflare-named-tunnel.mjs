import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const serveExternal = readFileSync("scripts/serve-external.mjs", "utf8");
const setupScript = readFileSync("scripts/setup-cloudflare-named-tunnel.mjs", "utf8");
const readme = readFileSync("README.md", "utf8");
const envExample = readFileSync(".env.example", "utf8");

assert.equal(packageJson.scripts["setup:cloudflare"], "node scripts/setup-cloudflare-named-tunnel.mjs");
assert.equal(packageJson.scripts["verify:cloudflare-tunnel"], "node scripts/verify-cloudflare-named-tunnel.mjs");
assert.ok(serveExternal.includes("--named-tunnel"), "serve-external must support --named-tunnel");
assert.ok(serveExternal.includes("AI_BOARD_CLOUDFLARE_TUNNEL_NAME"), "serve-external must read named tunnel env");
assert.ok(setupScript.includes("cloudflared tunnel route dns"), "setup script must print route dns command");
assert.ok(envExample.includes("AI_BOARD_CLOUDFLARE_TUNNEL_NAME"), ".env.example must document named tunnel env");
assert.ok(readme.includes("Cloudflare named tunnel"), "README must document Cloudflare named tunnel");
assert.ok(readme.includes("npm run setup:cloudflare"), "README must include setup:cloudflare");

const result = spawnSync("node", ["scripts/setup-cloudflare-named-tunnel.mjs", "--force"], {
  encoding: "utf8",
  env: {
    ...process.env,
    AI_BOARD_CLOUDFLARE_TUNNEL_NAME: "ai-board-verify",
    AI_BOARD_CLOUDFLARE_HOSTNAME: "ai-board.example.test",
    AI_BOARD_CLOUDFLARE_CONFIG_DIR: "output/cloudflare-verify",
    AI_BOARD_EXTERNAL_PORT: "8139",
  },
});
assert.equal(result.status, 0, result.stderr || result.stdout);
const payload = JSON.parse(result.stdout);
assert.equal(payload.hostname, "ai-board.example.test");
assert.equal(payload.localUrl, "http://127.0.0.1:8139");
assert.equal(payload.callbacks.figma, "https://ai-board.example.test/api/oauth/figma/callback");
assert.ok(existsSync("output/cloudflare-verify/config.yml"), "setup must create config.yml");
const config = readFileSync("output/cloudflare-verify/config.yml", "utf8");
assert.ok(config.includes("hostname: ai-board.example.test"), "config must include hostname");
assert.ok(config.includes("service: http://127.0.0.1:8139"), "config must route to the external local port");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "package scripts",
    "serve-external named tunnel mode",
    "setup script command output",
    "generated config",
    "README named tunnel instructions",
    ".env.example named tunnel variables",
  ],
  configPath: payload.configPath,
}, null, 2));
