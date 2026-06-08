import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const devFastapi = readFileSync("scripts/dev-fastapi.mjs", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const envExample = readFileSync(".env.example", "utf8");
const readme = readFileSync("README.md", "utf8");

assert.ok(devFastapi.includes('import os from "node:os"'), "dev server must inspect local network interfaces");
assert.ok(devFastapi.includes('const host = process.env.AI_BOARD_HOST || "0.0.0.0"'), "dev server must bind to all interfaces by default");
assert.ok(devFastapi.includes("process.env.AI_BOARD_PUBLIC_HOST || firstLanIpv4()"), "dev server must support explicit public host override");
assert.ok(devFastapi.includes("const apiHost = host === \"127.0.0.1\" || host === \"localhost\""), "local-only host override must keep local API base");
assert.ok(devFastapi.includes("const apiBase = process.env.VITE_API_BASE || `http://${apiHost}:${apiPort}`"), "frontend API base must default to reachable host, not hard-coded localhost");
assert.ok(devFastapi.includes("AI Board browser URL:"), "dev server must print the browser URL for other devices");
assert.equal(packageJson.scripts["dev:lan"], "node scripts/dev-fastapi.mjs", "package.json must expose dev:lan");
assert.ok(envExample.includes("AI_BOARD_PUBLIC_HOST="), ".env.example must document public host override");
assert.ok(envExample.includes("AI_BOARD_HOST=\"0.0.0.0\""), ".env.example must document external bind host");
assert.ok(readme.includes("## LAN / Other Device Access"), "README must document LAN access");
assert.ok(readme.includes("npm run dev:lan"), "README must include the LAN dev command");
assert.ok(readme.includes("AI_BOARD_PUBLIC_HOST"), "README must explain public host override");
assert.ok(readme.includes("Open the printed AI Board browser URL"), "README must tell users which URL to open");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "dev-fastapi public host detection",
    "dev:lan script",
    ".env.example LAN variables",
    "README LAN instructions",
  ],
}, null, 2));
