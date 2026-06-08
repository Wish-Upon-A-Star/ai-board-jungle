import { start, stop } from "./verify-helpers.mjs";
import os from "node:os";

const apiEnv = { PYTHONPATH: "backend", AI_BOARD_DATABASE_URL: process.env.AI_BOARD_DATABASE_URL || "sqlite:///./data/dev-fastapi.db" };
const host = process.env.AI_BOARD_HOST || "0.0.0.0";
const apiPort = process.env.AI_BOARD_API_PORT || "8000";
const webPort = process.env.AI_BOARD_WEB_PORT || "3000";

function firstLanIpv4() {
  const candidates = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces || []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push(address.address);
      }
    }
  }
  return (
    candidates.find((address) => !address.startsWith("169.254.") && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address)) ||
    candidates.find((address) => !address.startsWith("169.254.")) ||
    candidates[0] ||
    "127.0.0.1"
  );
}

const publicHost = process.env.AI_BOARD_PUBLIC_HOST || firstLanIpv4();
const apiHost = host === "127.0.0.1" || host === "localhost" ? "127.0.0.1" : publicHost;
const apiBase = process.env.VITE_API_BASE || `http://${apiHost}:${apiPort}`;

const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", host, "--port", apiPort], apiEnv);
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", host, "--port", webPort, "--strictPort"], { VITE_API_BASE: apiBase }, { cwd: "frontend" });

console.log(`AI Board API bind: http://${host}:${apiPort}`);
console.log(`AI Board web bind: http://${host}:${webPort}`);
console.log(`AI Board browser URL: http://${apiHost}:${webPort}`);
console.log(`AI Board frontend API base: ${apiBase}`);

let shuttingDown = false;
function shutdown(code = 0, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stop(api);
  stop(web);
  if (signal) console.log(`\nStopped dev servers after ${signal}`);
  process.exit(code);
}

api.on("exit", (code) => shutdown(code ?? 1, "api exit"));
web.on("exit", (code) => shutdown(code ?? 1, "web exit"));
process.on("SIGINT", () => shutdown(130, "SIGINT"));
process.on("SIGTERM", () => shutdown(143, "SIGTERM"));
