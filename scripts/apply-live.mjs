import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { mkdirSync, openSync } from "node:fs";
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
    postgresEnv(),
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

  console.log(JSON.stringify({
    ok: true,
    apiPid,
    webPid,
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
