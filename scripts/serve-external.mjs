import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { run, start, stop, waitFor } from "./verify-helpers.mjs";
import { postgresDatabaseUrl } from "./postgres-env.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const noTunnel = args.has("--no-tunnel");
const once = args.has("--once");
const port = process.env.AI_BOARD_EXTERNAL_PORT || "8130";
const host = process.env.AI_BOARD_EXTERNAL_HOST || "127.0.0.1";
const workers = process.env.AI_BOARD_EXTERNAL_WORKERS || "1";
const dbUrl = postgresDatabaseUrl();
const localUrl = `http://127.0.0.1:${port}`;
const cacheDir = join(root, "data", "bin");
const cloudflaredPath = join(cacheDir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

function platformDownloadUrl() {
  if (process.platform === "win32") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
      : "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz";
  }
  return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
}

async function downloadCloudflared() {
  if (existsSync(cloudflaredPath)) return cloudflaredPath;
  if (process.platform === "darwin") {
    throw new Error("Install cloudflared manually on macOS for now: brew install cloudflared");
  }
  mkdirSync(cacheDir, { recursive: true });
  const url = platformDownloadUrl();
  console.log(`Downloading cloudflared: ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`cloudflared download failed: ${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(cloudflaredPath));
  if (process.platform !== "win32") {
    await chmod(cloudflaredPath, 0o755);
  }
  return cloudflaredPath;
}

async function smokeCheck() {
  await waitFor(`${localUrl}/api/health`, 60000);
  const health = await (await fetch(`${localUrl}/api/health`)).json();
  if (!health.ok) throw new Error("external serve health check returned ok=false");
  const rootResponse = await fetch(localUrl);
  const rootHtml = await rootResponse.text();
  if (!rootResponse.ok || !rootHtml.includes("<div id=\"root\"></div>")) {
    throw new Error("external serve did not return the React app shell");
  }
  console.log(JSON.stringify({
    ok: true,
    checked: ["external test port", "single-process React shell", "API health"],
    localUrl,
    tunnel: noTunnel ? "disabled" : "enabled",
  }, null, 2));
}

function startApi() {
  const uvicornArgs = [
    "-m",
    "uvicorn",
    "app.main:app",
    "--app-dir",
    "backend",
    "--host",
    host,
    "--port",
    port,
    "--proxy-headers",
    "--forwarded-allow-ips=*",
  ];
  if (workers !== "1") {
    uvicornArgs.push("--workers", workers);
  }
  return start("python", uvicornArgs, {
    PYTHONPATH: "backend",
    AI_BOARD_DATABASE_URL: dbUrl,
  }, { cwd: root });
}

function startTunnel(executable) {
  return spawn(executable, ["tunnel", "--url", localUrl, "--no-autoupdate"], {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let api;
let tunnel;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  stop(tunnel);
  stop(api);
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

if (!skipBuild) {
  run("npm", ["run", "build"], { timeout: 120000 });
}

api = startApi();

try {
  await smokeCheck();
  if (once) {
    shutdown(0);
  }

  if (noTunnel) {
    console.log(`AI Board external test server: ${localUrl}`);
    console.log("Tunnel disabled. Stop this process when finished.");
  } else {
    const cloudflared = await downloadCloudflared();
    tunnel = startTunnel(cloudflared);
    const onChunk = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        console.log(`\nAI Board public URL: ${match[0]}`);
        console.log(`AI Board local backing URL: ${localUrl}`);
      }
    };
    tunnel.stdout.on("data", onChunk);
    tunnel.stderr.on("data", onChunk);
    tunnel.on("exit", (code) => shutdown(code ?? 1));
  }

  api.on("exit", (code) => shutdown(code ?? 1));
} catch (error) {
  console.error(error);
  shutdown(1);
}
