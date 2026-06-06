import { spawn } from "node:child_process";

const env = { ...process.env, PYTHONPATH: "backend", AI_BOARD_DATABASE_URL: process.env.AI_BOARD_DATABASE_URL || "sqlite:///./data/dev-fastapi.db" };
const host = process.env.AI_BOARD_HOST || "0.0.0.0";
const api = spawn("python", ["-m", "uvicorn", "app.main:app", "--host", host, "--port", "8000"], { stdio: "inherit", env });
const web = spawn("npm", ["--prefix", "frontend", "run", "dev", "--", "--host", host, "--port", "3000"], { shell: true, stdio: "inherit", env: process.env });

function shutdown(code = 0) {
  api.kill();
  web.kill();
  process.exit(code);
}

api.on("exit", (code) => shutdown(code ?? 1));
web.on("exit", (code) => shutdown(code ?? 1));
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
