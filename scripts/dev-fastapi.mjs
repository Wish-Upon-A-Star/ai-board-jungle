import { start, stop } from "./verify-helpers.mjs";

const apiEnv = { PYTHONPATH: "backend", AI_BOARD_DATABASE_URL: process.env.AI_BOARD_DATABASE_URL || "sqlite:///./data/dev-fastapi.db" };
const host = process.env.AI_BOARD_HOST || "0.0.0.0";
const apiPort = process.env.AI_BOARD_API_PORT || "8000";
const webPort = process.env.AI_BOARD_WEB_PORT || "3000";
const apiBase = process.env.VITE_API_BASE || `http://127.0.0.1:${apiPort}`;

const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", host, "--port", apiPort], apiEnv);
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", host, "--port", webPort, "--strictPort"], { VITE_API_BASE: apiBase }, { cwd: "frontend" });

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
