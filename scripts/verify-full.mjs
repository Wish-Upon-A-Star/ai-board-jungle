import { run, start, stop, waitFor } from "./verify-helpers.mjs";
import { postgresEnv } from "./postgres-env.mjs";

const env = postgresEnv();
const skipInstall = process.argv.includes("--skip-install");
const apiPort = process.env.AI_BOARD_VERIFY_API_PORT || "8142";
const webPort = process.env.AI_BOARD_VERIFY_WEB_PORT || "3142";
const apiBase = `http://127.0.0.1:${apiPort}`;
const appUrl = `http://127.0.0.1:${webPort}`;

run("node", ["scripts/verify-hygiene.mjs"]);
run("node", ["scripts/verify-text-integrity.mjs"]);
run("node", ["scripts/verify-frontend-helpers.mjs"]);
run("node", ["scripts/verify-template-presets.mjs"]);
run("node", ["scripts/verify-network-config.mjs"]);
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
run("node", ["scripts/verify-production-serve.mjs", "--skip-build"], { env, timeout: 120000 });
run("node", ["scripts/verify-external-serve.mjs"], { env, timeout: 120000 });
run("python", ["scripts/seed-fastapi.py"], { env });

const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", apiPort], env);
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", webPort, "--strictPort"], { VITE_API_BASE: apiBase }, { cwd: "frontend" });

try {
  await waitFor(`${apiBase}/api/health`);
  await waitFor(appUrl);
  run("node", ["scripts/verify-api-contract.mjs"], { env: { ...env, API_BASE: apiBase } });
  run("node", ["scripts/smoke-fastapi.mjs"], { env: { ...env, API_BASE: apiBase } });
  run("node", ["scripts/verify-ui-cdp.mjs"], { env: { ...env, API_BASE: apiBase, APP_URL: appUrl }, timeout: 180000 });
  console.log(`\nFULL_VERIFY_OK ${appUrl} ${apiBase}/docs`);
} finally {
  stop(api);
  stop(web);
}
