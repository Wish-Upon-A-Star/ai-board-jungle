import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

function mergedEnv(patch = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...patch }).filter(([key, value]) => key && !key.startsWith("=") && value !== undefined)
  );
}

function run(cmd, args, opts = {}) {
  console.log(`\n== ${cmd} ${args.join(" ")} ==`);
  const r = spawnSync(cmd, args, { shell: true, stdio: "inherit", env: mergedEnv(opts.env), timeout: opts.timeout ?? 120000 });
  if (r.status !== 0) {
    console.error(`FAILED ${cmd} ${args.join(" ")} status=${r.status} signal=${r.signal}`);
    process.exit(r.status ?? 1);
  }
}

function start(cmd, args, env, opts = {}) {
  const executable = cmd === "node" ? process.execPath : cmd;
  return spawn(executable, args, { shell: false, stdio: "inherit", env: mergedEnv(env), cwd: opts.cwd });
}

async function wait(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timeout ${url}`);
}

const env = { PYTHONPATH: "backend", AI_BOARD_DATABASE_URL: "sqlite:///./data/fastapi-verify.db" };
const verifyDbPath = "data/fastapi-verify.db";
function resetVerifyDb() {
  for (const path of [verifyDbPath, `${verifyDbPath}-shm`, `${verifyDbPath}-wal`]) {
    rmSync(path, { force: true });
  }
}
function stopLocalServers() {
  run("powershell", ["-NoProfile", "-Command", "\"1..8 | ForEach-Object { Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 1000 }; exit 0\""], { timeout: 30000 });
}
function stop(processHandle) {
  if (!processHandle || processHandle.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  } else {
    processHandle.kill("SIGTERM");
  }
}
stopLocalServers();
resetVerifyDb();
run("python", ["-m", "pip", "install", "-r", "backend/requirements.txt"], { timeout: 180000 });
run("python", ["-m", "pytest", "backend/tests"], { env });
run("npm", ["--prefix", "frontend", "install"], { timeout: 180000 });
run("npm", ["--prefix", "frontend", "run", "build"]);
run("python", ["scripts/seed-fastapi.py"], { env });
const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], env);
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3000", "--strictPort"], { VITE_API_BASE: "http://127.0.0.1:8000" }, { cwd: "frontend" });
try {
  await wait("http://127.0.0.1:8000/api/health");
  await wait("http://127.0.0.1:3000");
  run("node", ["scripts/smoke-fastapi.mjs"], { env });
  console.log("\nFASTAPI_REACT_VERIFY_OK http://127.0.0.1:3000 http://127.0.0.1:8000/docs");
} finally {
  stop(api);
  stop(web);
  stopLocalServers();
}
