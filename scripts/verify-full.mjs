import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

function mergedEnv(patch = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...patch }).filter(([key, value]) => key && !key.startsWith("=") && value !== undefined)
  );
}

function run(cmd, args, opts = {}) {
  console.log(`\n== ${cmd} ${args.join(" ")} ==`);
  const result = spawnSync(cmd, args, {
    shell: true,
    stdio: "inherit",
    env: mergedEnv(opts.env),
    timeout: opts.timeout ?? 120000,
  });
  if (result.status !== 0) {
    console.error(`FAILED ${cmd} ${args.join(" ")} status=${result.status} signal=${result.signal}`);
    process.exit(result.status ?? 1);
  }
}

function start(cmd, args, env, opts = {}) {
  const executable = cmd === "node" ? process.execPath : cmd;
  return spawn(executable, args, { shell: false, stdio: "inherit", env: mergedEnv(env), cwd: opts.cwd });
}

async function waitFor(url, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function stop(processHandle) {
  if (!processHandle || processHandle.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  } else {
    processHandle.kill("SIGTERM");
  }
}

function stopLocalServers() {
  run("powershell", [
    "-NoProfile",
    "-Command",
    "\"1..8 | ForEach-Object { Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 1000 }; exit 0\"",
  ], { timeout: 30000 });
}

const verifyDbPath = "data/full-verify.db";
const env = { PYTHONPATH: "backend", AI_BOARD_DATABASE_URL: `sqlite:///./${verifyDbPath}` };
const skipInstall = process.argv.includes("--skip-install");

function resetVerifyDb() {
  for (const path of [verifyDbPath, `${verifyDbPath}-shm`, `${verifyDbPath}-wal`]) {
    rmSync(path, { force: true });
  }
}

stopLocalServers();
resetVerifyDb();
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
const web = start("node", ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3000"], { VITE_API_BASE: "http://127.0.0.1:8000" }, { cwd: "frontend" });

try {
  await waitFor("http://127.0.0.1:8000/api/health");
  await waitFor("http://127.0.0.1:3000");
  run("node", ["scripts/smoke-fastapi.mjs"], { env });
  run("node", ["scripts/verify-ui-cdp.mjs"], { env, timeout: 180000 });
  console.log("\nFULL_VERIFY_OK http://127.0.0.1:3000 http://127.0.0.1:8000/docs");
} finally {
  stop(api);
  stop(web);
  stopLocalServers();
}
