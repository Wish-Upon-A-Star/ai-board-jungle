import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const devFastapi = readFileSync("scripts/dev-fastapi.mjs", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const envExample = readFileSync(".env.example", "utf8");
const readme = readFileSync("README.md", "utf8");
const serveExternal = readFileSync("scripts/serve-external.mjs", "utf8");
const postgresEnv = readFileSync("scripts/postgres-env.mjs", "utf8");
const verifyFastapi = readFileSync("scripts/verify-fastapi.mjs", "utf8");
const verifyFull = readFileSync("scripts/verify-full.mjs", "utf8");

assert.ok(devFastapi.includes('import os from "node:os"'), "dev server must inspect local network interfaces");
assert.ok(devFastapi.includes('const host = process.env.AI_BOARD_HOST || "0.0.0.0"'), "dev server must bind to all interfaces by default");
assert.ok(devFastapi.includes("process.env.AI_BOARD_PUBLIC_HOST || firstLanIpv4()"), "dev server must support explicit public host override");
assert.ok(devFastapi.includes('!address.startsWith("169.254.")'), "dev server must avoid link-local addresses when a usable LAN IP exists");
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
assert.ok(readme.includes("Cloudflare quick tunnel"), "README must explain Cloudflare quick tunnel external access");
assert.ok(readme.includes("OAuth callback 진단"), "README must point users to the in-app OAuth callback diagnostics");
assert.ok(readme.includes("Cloudflare named tunnel"), "README must recommend a stable domain for repeated external use");
assert.ok(readme.includes("/api/oauth/figma/callback"), "README must document Figma OAuth callback");
assert.ok(readme.includes("/api/oauth/google_calendar/callback"), "README must document Google Calendar OAuth callback");
assert.equal(packageJson.scripts["serve:external"], "node scripts/serve-external.mjs", "package.json must expose serve:external");
assert.equal(packageJson.scripts["verify:external-serve"], "node scripts/verify-external-serve.mjs", "package.json must expose verify:external-serve");
assert.equal(packageJson.scripts["setup:cloudflare"], "node scripts/setup-cloudflare-named-tunnel.mjs", "package.json must expose setup:cloudflare");
assert.equal(packageJson.scripts["verify:cloudflare-tunnel"], "node scripts/verify-cloudflare-named-tunnel.mjs", "package.json must expose verify:cloudflare-tunnel");
assert.ok(serveExternal.includes("AI_BOARD_EXTERNAL_PORT"), "external serve must use a configurable non-dev port");
assert.ok(serveExternal.includes("--named-tunnel"), "external serve must support named Cloudflare tunnels");
assert.ok(devFastapi.includes("postgresEnv()"), "dev server must use PostgreSQL by default");
assert.ok(serveExternal.includes("postgresDatabaseUrl()"), "external server must use PostgreSQL by default");
assert.ok(postgresEnv.includes("postgresql://ai_board:ai_board@localhost:5432/ai_board"), "shared PostgreSQL default URL must be explicit");
assert.ok(serveExternal.includes("AI Board public URL:"), "external serve must print the public tunnel URL");
assert.ok(!serveExternal.includes("stopLocalServers"), "external serve must not stop the running LAN/dev server");
assert.ok(!verifyFastapi.includes("stopLocalServers"), "verify:fastapi must not stop the current 3000/8000 server");
assert.ok(!verifyFull.includes("stopLocalServers"), "verify:full must not stop the current 3000/8000 server");
assert.ok(verifyFastapi.includes('"8141"') && verifyFastapi.includes('"3141"'), "verify:fastapi must use isolated default ports");
assert.ok(verifyFull.includes('"8142"') && verifyFull.includes('"3142"'), "verify:full must use isolated default ports");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "dev-fastapi public host detection",
    "link-local LAN IP avoidance",
    "dev:lan script",
    ".env.example LAN variables",
    "README LAN instructions",
    "external tunnel serve script",
    "Cloudflare named tunnel setup contract",
    "PostgreSQL-first runtime defaults",
    "non-destructive verification ports",
  ],
}, null, 2));
