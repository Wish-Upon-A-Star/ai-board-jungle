import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { postgresDatabaseUrl, postgresEnv, assertPostgresUrl } from "./postgres-env.mjs";
import { run, waitFor } from "./verify-helpers.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logDir = join(root, "output", "logs");
mkdirSync(logDir, { recursive: true });

const apiPort = process.env.AI_BOARD_API_PORT || "8000";
const webPort = process.env.AI_BOARD_WEB_PORT || "3000";
const host = process.env.AI_BOARD_HOST || "0.0.0.0";
const publicHost = process.env.AI_BOARD_PUBLIC_HOST || "127.0.0.1";
const apiBase = process.env.VITE_API_BASE || "";
const webUrl = `http://${publicHost}:${webPort}`;
const dbUrl = postgresDatabaseUrl();

function readKvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
}

function readRawPair(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readFirstLine(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").split(/\r?\n/).find((line) => line.trim())?.trim() || "";
}

function desktopOAuthEnv() {
  const desktop = join(process.env.USERPROFILE || "", "Desktop");
  const github = readKvFile(join(desktop, "ai-board-demo-github-api-token.txt"));
  const notion = readKvFile(join(desktop, "ai-board-demo-notion-api-token.txt"));
  const figma = readRawPair(join(desktop, "figma.txt"));
  const google = readRawPair(join(desktop, "google.txt"));
  const tunnelUrl = readFirstLine(join(root, ".cloudflare-url.txt"));
  const publicBaseUrl = tunnelUrl || process.env.AI_BOARD_PUBLIC_BASE_URL || "";
  return {
    AI_BOARD_GITHUB_OAUTH_CLIENT_ID: github.GITHUB_CLIENT_ID || process.env.AI_BOARD_GITHUB_OAUTH_CLIENT_ID || "",
    AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET:
      github.AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET || process.env.AI_BOARD_GITHUB_OAUTH_CLIENT_SECRET || "",
    AI_BOARD_NOTION_OAUTH_CLIENT_ID: notion.CLIENT_ID || process.env.AI_BOARD_NOTION_OAUTH_CLIENT_ID || "",
    AI_BOARD_NOTION_OAUTH_CLIENT_SECRET: notion.SECRET_KEY || process.env.AI_BOARD_NOTION_OAUTH_CLIENT_SECRET || "",
    AI_BOARD_FIGMA_OAUTH_CLIENT_ID: figma[0] || process.env.AI_BOARD_FIGMA_OAUTH_CLIENT_ID || "",
    AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET: figma[1] || process.env.AI_BOARD_FIGMA_OAUTH_CLIENT_SECRET || "",
    AI_BOARD_FIGMA_OAUTH_REDIRECT_URI:
      process.env.AI_BOARD_FIGMA_OAUTH_REDIRECT_URI || (publicBaseUrl ? `${publicBaseUrl}/api/oauth/figma/callback` : ""),
    AI_BOARD_GOOGLE_OAUTH_CLIENT_ID: google[0] || process.env.AI_BOARD_GOOGLE_OAUTH_CLIENT_ID || "",
    AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET: google[1] || process.env.AI_BOARD_GOOGLE_OAUTH_CLIENT_SECRET || "",
    AI_BOARD_GOOGLE_OAUTH_REDIRECT_URI:
      process.env.AI_BOARD_GOOGLE_OAUTH_REDIRECT_URI || (publicBaseUrl ? `${publicBaseUrl}/api/oauth/google_calendar/callback` : ""),
    AI_BOARD_PUBLIC_BASE_URL: publicBaseUrl,
  };
}

function parsedPostgresTarget(url) {
  const parsed = new URL(url.replace("postgresql+psycopg://", "postgresql://"));
  return { host: parsed.hostname || "localhost", port: Number(parsed.port || 5432) };
}

function canConnect(hostname, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: hostname, port, timeout: timeoutMs });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function pidsForPorts(ports) {
  const command = [
    "$ports=@(" + ports.join(",") + ");",
    "Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue",
    "| Select-Object -ExpandProperty OwningProcess -Unique",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 4);
}

function stopPids(pids) {
  for (const pid of pids) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit" });
  }
}

function startDetached(command, args, env, logName, cwd = root) {
  const out = openSync(join(logDir, `${logName}.out.log`), "a");
  const err = openSync(join(logDir, `${logName}.err.log`), "a");
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertListening(port, expectedPid, label) {
  const listeners = pidsForPorts([Number(port)]);
  if (!listeners.length) {
    throw new Error(`${label} is not listening on port ${port} after startup.`);
  }
  if (expectedPid && !listeners.includes(Number(expectedPid))) {
    throw new Error(
      `${label} started as pid ${expectedPid}, but port ${port} is owned by ${listeners.join(", ")}. ` +
      "Refusing to report live apply success for a mismatched process."
    );
  }
  return listeners;
}

async function main() {
  assertPostgresUrl(dbUrl);
  const target = parsedPostgresTarget(dbUrl);
  const postgresReady = await canConnect(target.host, target.port);
  if (!postgresReady) {
    throw new Error(
      `Refusing to restart live servers: PostgreSQL is not reachable at ${target.host}:${target.port}. ` +
      "Start PostgreSQL or set AI_BOARD_DATABASE_URL to a reachable PostgreSQL database first."
    );
  }

  run("npm", ["run", "build"], { timeout: 120000 });
  const existing = pidsForPorts([Number(apiPort), Number(webPort)]);
  if (existing.length) stopPids(existing);

  const apiPid = startDetached(
    "python",
    ["-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", host, "--port", apiPort],
    { ...postgresEnv(), ...desktopOAuthEnv(), PYTHONPATH: "backend" },
    "live-api",
  );
  const webPid = startDetached(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", host, "--port", webPort, "--strictPort"],
    { VITE_API_BASE: apiBase },
    "live-web",
    join(root, "frontend"),
  );

  await waitFor(`http://127.0.0.1:${apiPort}/api/health`, 45000);
  await waitFor(`http://127.0.0.1:${webPort}`, 45000);
  await sleep(3000);
  const apiListeners = assertListening(apiPort, apiPid, "Live API");
  const webListeners = assertListening(webPort, webPid, "Live web");

  console.log(JSON.stringify({
    ok: true,
    apiPid,
    webPid,
    apiListeners,
    webListeners,
    api: `http://${publicHost}:${apiPort}`,
    web: webUrl,
    database: `${target.host}:${target.port}`,
    logs: logDir,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
