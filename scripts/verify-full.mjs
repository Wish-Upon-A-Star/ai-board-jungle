import { resetSqliteDb, run, start, stop, stopLocalServers, waitFor } from "./verify-helpers.mjs";

const verifyDbPath = "data/full-verify.db";
const env = { PYTHONPATH: "backend", AI_BOARD_DATABASE_URL: `sqlite:///./${verifyDbPath}` };
const skipInstall = process.argv.includes("--skip-install");

stopLocalServers();
resetSqliteDb(verifyDbPath);
run("node", ["scripts/verify-hygiene.mjs"]);
run("node", ["scripts/verify-text-integrity.mjs"]);
run("node", ["scripts/verify-frontend-helpers.mjs"]);
run("node", ["scripts/verify-template-presets.mjs"]);
run("node", ["scripts/verify-evaluation-reports.mjs"]);
run("node", ["scripts/verify-readiness-output-fixture.mjs"]);
run("node", ["scripts/verify-readiness-output.mjs"]);
run("node", ["scripts/verify-command-scope.mjs"]);
run("node", ["scripts/verify-readme.mjs"]);
run("python", ["-m", "py_compile", "backend/app/main.py", "backend/app/services.py"]);
if (!skipInstall) {
  run("python", ["-m", "pip", "install", "-r", "backend/requirements.txt"], { timeout: 180000 });
} else {
  console.log("\n== skip dependency install ==");
}
run("python", ["-m", "pytest", "backend/tests"], { env });
if (!skipInstall) {
  run("npm", ["--prefix", "frontend", "install"], { timeout: 180000 });
}
run("npm", ["--prefix", "frontend", "run", "build"]);
run("python", ["scripts/seed-fastapi.py"], { env });

const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], env);
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3000", "--strictPort"], { VITE_API_BASE: "http://127.0.0.1:8000" }, { cwd: "frontend" });

try {
  await waitFor("http://127.0.0.1:8000/api/health");
  await waitFor("http://127.0.0.1:3000");
  run("node", ["scripts/verify-api-contract.mjs"], { env });
  run("node", ["scripts/smoke-fastapi.mjs"], { env });
  run("node", ["scripts/verify-ui-cdp.mjs"], { env, timeout: 180000 });
  console.log("\nFULL_VERIFY_OK http://127.0.0.1:3000 http://127.0.0.1:8000/docs");
} finally {
  stop(api);
  stop(web);
  stopLocalServers();
}
