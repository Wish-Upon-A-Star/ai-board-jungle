import { spawnSync } from "node:child_process";
import net from "node:net";

const dbUrl = process.env.AI_BOARD_DATABASE_URL || "postgresql://ai_board:ai_board@localhost:5432/ai_board";

function hasCommand(command) {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
    shell: false,
    stdio: "ignore",
  });
  return result.status === 0;
}

function parsePostgresHostPort(url) {
  const parsed = new URL(url.replace("postgresql+psycopg://", "postgresql://"));
  return {
    host: parsed.hostname || "localhost",
    port: Number(parsed.port || "5432"),
  };
}

function checkTcp(host, targetPort, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: targetPort });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    timeout.unref?.();
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

const target = parsePostgresHostPort(dbUrl);
if (await checkTcp(target.host, target.port)) {
  console.log(JSON.stringify({ ok: true, status: "already-running", host: target.host, port: target.port }, null, 2));
  process.exit(0);
}

if (hasCommand("docker")) {
  const compose = spawnSync("docker", ["compose", "up", "-d", "postgres"], { shell: false, stdio: "inherit" });
  if (compose.status !== 0) process.exit(compose.status ?? 1);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await checkTcp(target.host, target.port, 1000)) {
      console.log(JSON.stringify({ ok: true, status: "started-with-docker-compose", host: target.host, port: target.port }, null, 2));
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Docker compose started postgres, but ${target.host}:${target.port} did not become reachable.`);
}

console.error(
  [
    "PostgreSQL is not installed or Docker is unavailable.",
    `Expected database URL: ${dbUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@")}`,
    "Install/start PostgreSQL, then rerun `npm run verify:postgres`.",
    "Windows winget option: winget install --id PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements",
    "Docker option after installing Docker Desktop: npm run setup:postgres",
  ].join("\n")
);
process.exit(1);
