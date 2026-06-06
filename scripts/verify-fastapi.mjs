import { resetSqliteDb, run, start, stop, stopLocalServers, waitFor } from "./verify-helpers.mjs";

const env = { PYTHONPATH: "backend", AI_BOARD_DATABASE_URL: "sqlite:///./data/fastapi-verify.db" };
const verifyDbPath = "data/fastapi-verify.db";
stopLocalServers();
resetSqliteDb(verifyDbPath);
run("python", ["-m", "pip", "install", "-r", "backend/requirements.txt"], { timeout: 180000 });
run("python", ["-m", "pytest", "backend/tests"], { env });
run("npm", ["--prefix", "frontend", "install"], { timeout: 180000 });
run("npm", ["--prefix", "frontend", "run", "build"]);
run("python", ["scripts/seed-fastapi.py"], { env });
const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], env);
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3000", "--strictPort"], { VITE_API_BASE: "http://127.0.0.1:8000" }, { cwd: "frontend" });
try {
  await waitFor("http://127.0.0.1:8000/api/health");
  await waitFor("http://127.0.0.1:3000");
  run("node", ["scripts/smoke-fastapi.mjs"], { env });
  console.log("\nFASTAPI_REACT_VERIFY_OK http://127.0.0.1:3000 http://127.0.0.1:8000/docs");
} finally {
  stop(api);
  stop(web);
  stopLocalServers();
}
