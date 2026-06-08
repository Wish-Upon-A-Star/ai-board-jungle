import { run, start, stop, waitFor } from "./verify-helpers.mjs";
import { postgresEnv } from "./postgres-env.mjs";

const env = postgresEnv();
const apiPort = process.env.AI_BOARD_VERIFY_API_PORT || "8141";
const webPort = process.env.AI_BOARD_VERIFY_WEB_PORT || "3141";
const apiBase = `http://127.0.0.1:${apiPort}`;
const appUrl = `http://127.0.0.1:${webPort}`;

run("node", ["scripts/verify-template-presets.mjs"]);
run("python", ["-m", "pip", "install", "-r", "backend/requirements.txt"], { timeout: 180000 });
run("python", ["-m", "pytest", "backend/tests"], { env });
run("npm", ["--prefix", "frontend", "install"], { timeout: 180000 });
run("npm", ["--prefix", "frontend", "run", "build"]);
run("python", ["scripts/seed-fastapi.py"], { env });
const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", apiPort], env);
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", webPort, "--strictPort"], { VITE_API_BASE: apiBase }, { cwd: "frontend" });
try {
  await waitFor(`${apiBase}/api/health`);
  await waitFor(appUrl);
  run("node", ["scripts/smoke-fastapi.mjs"], { env: { ...env, API_BASE: apiBase } });
  console.log(`\nFASTAPI_REACT_VERIFY_OK ${appUrl} ${apiBase}/docs`);
} finally {
  stop(api);
  stop(web);
}
