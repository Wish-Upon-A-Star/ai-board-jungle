import { run, start, stop, waitFor } from "./verify-helpers.mjs";
import { postgresEnv } from "./postgres-env.mjs";

const port = process.env.AI_BOARD_PRODUCTION_VERIFY_PORT || "8120";
const apiBase = `http://127.0.0.1:${port}`;
const skipBuild = process.argv.includes("--skip-build");
const env = {
  ...postgresEnv(),
};

async function fetchText(path) {
  const response = await fetch(`${apiBase}${path}`);
  return { response, text: await response.text() };
}

if (!skipBuild) {
  run("npm", ["run", "build"], { timeout: 120000 });
}

const api = start("python", ["-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", port], env);

try {
  await waitFor(`${apiBase}/api/health`);
  const health = await (await fetch(`${apiBase}/api/health`)).json();
  if (!health.ok) throw new Error("/api/health did not return ok=true");

  const root = await fetchText("/");
  if (!root.response.ok || !root.text.includes("<div id=\"root\"></div>")) {
    throw new Error("FastAPI did not serve the built React index at /");
  }

  const spa = await fetchText("/automations/deep-link");
  if (!spa.response.ok || !spa.text.includes("<div id=\"root\"></div>")) {
    throw new Error("FastAPI did not serve the React index for an SPA deep link");
  }

  const missingApi = await fetch(`${apiBase}/api/does-not-exist`);
  const missingApiText = await missingApi.text();
  if (missingApi.status !== 404 || missingApiText.includes("<div id=\"root\"></div>")) {
    throw new Error("Missing API routes must return API 404, not the React index");
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "frontend build",
      "FastAPI single-process static index",
      "SPA fallback",
      "API health",
      "API 404 isolation",
    ],
    url: apiBase,
  }, null, 2));
} finally {
  stop(api);
}
