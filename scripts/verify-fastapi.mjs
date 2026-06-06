import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

function run(cmd, args, opts = {}) {
  console.log(`\n== ${cmd} ${args.join(" ")} ==`);
  const r = spawnSync(cmd, args, { shell: true, stdio: "inherit", env: { ...process.env, ...opts.env }, timeout: opts.timeout ?? 120000 });
  if (r.status !== 0) {
    console.error(`FAILED ${cmd} ${args.join(" ")} status=${r.status} signal=${r.signal}`);
    process.exit(r.status ?? 1);
  }
}

function start(cmd, args, env) {
  const p = spawn(cmd, args, { shell: true, stdio: "inherit", env: { ...process.env, ...env } });
  return p;
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
stopLocalServers();
resetVerifyDb();
run("python", ["-m", "pip", "install", "-r", "backend/requirements.txt"], { timeout: 180000 });
run("python", ["-m", "pytest", "backend/tests"], { env });
run("npm", ["--prefix", "frontend", "install"], { timeout: 180000 });
run("npm", ["--prefix", "frontend", "run", "build"]);
run("python", ["scripts/seed-fastapi.py"], { env });
const api = start("python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], env);
const web = start("npm", ["--prefix", "frontend", "run", "dev"], { VITE_API_BASE: "http://127.0.0.1:8000" });
try {
  await wait("http://127.0.0.1:8000/api/health");
  await wait("http://127.0.0.1:3000");
  run("node", ["scripts/smoke-fastapi.mjs"], { env });
  console.log("\nFASTAPI_REACT_VERIFY_OK http://127.0.0.1:3000 http://127.0.0.1:8000/docs");
} finally {
  api.kill();
  web.kill();
  stopLocalServers();
}
