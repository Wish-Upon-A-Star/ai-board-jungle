import { spawn, spawnSync } from "node:child_process";

type Child = ReturnType<typeof spawn>;

const children: Child[] = [];

type EnvPatch = Record<string, string>;

function run(command: string, args: string[], options: { timeoutMs?: number; env?: EnvPatch } = {}) {
  console.log(`\n== ${command} ${args.join(" ")} ==`);
  const result = spawnSync(command, args, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
    timeout: options.timeoutMs ?? 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

function start(command: string, args: string[], env: EnvPatch = {}) {
  console.log(`\n== start ${command} ${args.join(" ")} ==`);
  const child = spawn(command, args, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function waitFor(url: string, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function cleanup() {
  for (const child of children.reverse()) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // ignore cleanup failure
    }
  }
}

function stopPort(port: number) {
  if (process.platform !== "win32") return;
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
    ],
    { shell: false, stdio: "ignore" },
  );
}

function stopPidFile(name: string) {
  if (process.platform !== "win32") return;
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `if (Test-Path '${name}') { Stop-Process -Id ([int](Get-Content '${name}')) -Force -ErrorAction SilentlyContinue; Remove-Item '${name}' -Force -ErrorAction SilentlyContinue }`],
    { shell: false, stdio: "ignore" },
  );
}

function stopStaleProjectNodeProcesses() {
  if (process.platform !== "win32") return;
  const escapedCwd = process.cwd().replaceAll("'", "''");
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.ProcessId -ne ${process.pid} -and (($_.CommandLine -like '*${escapedCwd}*' -and $_.CommandLine -notlike '*scripts/auto-verify.ts*') -or $_.CommandLine -like '*npm-cli.js run mcp:server*' -or $_.CommandLine -like '*npm-cli.js run dev -- --hostname 127.0.0.1 --port 3000*' -or $_.CommandLine -like '*scripts/mcp-server.ts*' -or $_.CommandLine -like '*next*dev --hostname 127.0.0.1 --port 3000*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    { shell: false, stdio: "ignore" },
  );
  spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 2"], { shell: false, stdio: "ignore" });
}

async function main() {
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  const env = {
    AI_BOARD_DEMO_MODE: "1",
    MCP_SERVER_URL: "http://127.0.0.1:8788/rpc",
    JWT_SECRET: "local-auto-verify-secret-change-me",
  };

  stopPort(3000);
  stopPort(8788);
  stopPidFile(".devserver.pid");
  stopPidFile(".mcpserver.pid");
  stopStaleProjectNodeProcesses();

  run("npm", ["run", "prisma:generate"], { timeoutMs: 90_000, env });
  run("npm", ["test"], { timeoutMs: 90_000, env });
  run("npm", ["run", "lint"], { timeoutMs: 90_000, env });
  run("npm", ["run", "build"], { timeoutMs: 120_000, env });
  run("npm", ["run", "demo:seed"], { timeoutMs: 90_000, env });

  start("npm", ["run", "mcp:server"], { ...env, MCP_PORT: "8788" });
  await waitFor("http://127.0.0.1:8788/rpc").catch(async () => {
    const response = await fetch("http://127.0.0.1:8788/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "health", method: "weather.lookup", params: { location: "Seoul" } }),
    });
    if (!response.ok) throw new Error(`MCP health failed ${response.status}`);
  });

  start("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"], env);
  await waitFor("http://127.0.0.1:3000/login", 45_000);
  run("npm", ["run", "smoke:http"], { timeoutMs: 120_000, env: { ...env, SMOKE_BASE_URL: "http://127.0.0.1:3000" } });

  console.log("\nAUTO_VERIFY_OK http://127.0.0.1:3000");
  cleanup();
  process.exit(0);
}

main()
  .catch((error) => {
    console.error("\nAUTO_VERIFY_FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
