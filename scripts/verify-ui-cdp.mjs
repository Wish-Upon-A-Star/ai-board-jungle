const port = process.env.CDP_PORT || "9223";
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve) => {
    ws.onopen = resolve;
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve) => {
        const requestId = ++id;
        pending.set(requestId, resolve);
        ws.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.call("Target.createTarget", { url: appUrl });
  await wait(2500);

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const appHost = new URL(appUrl).host;
  const target = targets.find((item) => item.url.includes(appHost));
  if (!target) throw new Error("UI target was not created");

  const page = await connect(target.webSocketDebuggerUrl);
  await page.call("Runtime.enable");

  const evalJs = async (expression) => {
    const result = await page.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result.result.value;
  };
  const bodyText = () => evalJs("document.body.innerText");

  const login = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  const loginJson = await login.json();
  const token = loginJson.token;

  await evalJs(`localStorage.setItem("ai-board-token", ${JSON.stringify(token)}); location.reload();`);
  await wait(3000);

  let text = await bodyText();
  const requiredUi = [
    "AI/BOARD>",
    "Scheduler tick",
    "Run history",
    "GitHub",
    "Notion",
    "RAG",
    "MCP",
    "Agent",
    "Redis",
    "PostgreSQL",
    "Dry-run write",
    "Actual write",
    "Integration Activity Log",
    "Real-write audit",
    "Google Calendar",
    "Figma",
    "Health",
  ];
  const missing = requiredUi.filter((item) => !text.includes(item));
  const hasLiveWritePlaceholder = await evalJs(
    `Boolean(Array.from(document.querySelectorAll("input")).find((input) => input.placeholder === "WRITE LIVE"))`
  );
  if (!hasLiveWritePlaceholder) missing.push("WRITE LIVE");

  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const apiJson = async (path, options = {}) => {
    const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    return response.json();
  };

  const integrationProfileApi = await apiJson("/api/integration-profiles").then((data) => Array.isArray(data.profiles));
  const readinessApi = await apiJson("/api/provider-readiness").then((data) => Array.isArray(data.providers));
  const collectorApi = await apiJson("/api/integration-profiles").then(async (data) => {
    const profile = data.profiles[0];
    if (!profile) return false;
    const collected = await apiJson(`/api/integration-profiles/${profile.id}/collect`, { method: "POST" });
    return Boolean(collected.profile && typeof collected.collected === "number" && typeof collected.status === "string");
  });
  const liveWriteApi = await apiJson("/api/integration-profiles").then(async (data) => {
    const profile = data.profiles[0];
    if (!profile) return false;
    const dryRun = await apiJson(`/api/integration-profiles/${profile.id}/write`, {
      method: "POST",
      body: JSON.stringify({ title: "CDP dry-run", body: "CDP dry-run body", dry_run: true }),
    });
    return dryRun.write?.dryRun === true || dryRun.write?.status === "dry-run";
  });
  const activityApi = await apiJson("/api/integration-activities").then((data) => Array.isArray(data.activities));
  const activityFilterApi = await apiJson("/api/integration-activities?event_type=integration_profile.write&dry_run=true").then((data) =>
    Array.isArray(data.activities)
  );
  const activityPageApi = await apiJson("/api/integration-activities?limit=1&offset=0").then(
    (data) => Array.isArray(data.activities) && data.limit === 1 && typeof data.total === "number" && typeof data.hasMore === "boolean"
  );
  const realWriteAuditApi = await apiJson("/api/integration-activities?event_type=integration_profile.write&dry_run=false").then((data) =>
    Array.isArray(data.activities)
  );
  const schedulerApi = await apiJson("/api/automations/scheduler/tick?limit=5", { method: "POST" }).then((data) => Array.isArray(data.results));
  const automationRunsApi = await apiJson("/api/automations").then(async (data) => {
    const task = data.tasks[0];
    if (!task) return false;
    const runs = await apiJson(`/api/automations/${task.id}/runs?limit=2&offset=0`);
    return Array.isArray(runs.runs) && runs.limit === 2 && typeof runs.total === "number" && typeof runs.hasMore === "boolean";
  });
  const knowledgeSaved = await apiJson("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({
      title: "CDP verification document",
      source_type: "document",
      instruction: "Use this for UI smoke verification.",
      extracted_text: "GitHub Notion Figma Calendar automation verification.",
      tags: ["cdp", "verification"],
    }),
  }).then((data) => Boolean(data.source));
  const healthOk = await fetch(`${apiBase}/api/health`).then((response) => response.ok);
  const mcpOk = await fetch(`${apiBase}/mcp/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "weather.lookup", params: { location: "Seoul" } }),
  }).then((response) => response.ok);
  const hubOk = await fetch(`${apiBase}/api/integrations/hub/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: "Summarize GitHub Notion automation status" }),
  }).then((response) => response.ok);

  const runClicked = await evalJs(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.innerText.includes("Run history"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(1500);
  const detailClicked = await evalJs(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.innerText.includes("Details"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(500);
  const retryClicked = await evalJs(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.innerText.includes("Retry"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(1200);
  text = await bodyText();
  const runHistoryVisible = runClicked && text.includes("Run history");
  const runDetailsVisible = detailClicked && text.includes("Hide details") && text.includes("status");
  const runRetryVisible = retryClicked && text.includes("Retry") && text.includes("Updated");

  const result = {
    missing,
    integrationProfileApi,
    collectorApi,
    readinessApi,
    liveWriteApi,
    activityApi,
    activityFilterApi,
    activityPageApi,
    realWriteAuditApi,
    schedulerApi,
    automationRunsApi,
    knowledgeSaved,
    healthOk,
    mcpOk,
    hubOk,
    runHistoryVisible,
    runDetailsVisible,
    runRetryVisible,
    sample: text.slice(0, 1200),
  };
  console.log(JSON.stringify(result, null, 2));

  if (
    missing.length ||
    !integrationProfileApi ||
    !collectorApi ||
    !readinessApi ||
    !liveWriteApi ||
    !activityApi ||
    !activityFilterApi ||
    !activityPageApi ||
    !realWriteAuditApi ||
    !schedulerApi ||
    !automationRunsApi ||
    !knowledgeSaved ||
    !healthOk ||
    !mcpOk ||
    !hubOk ||
    !runHistoryVisible ||
    !runDetailsVisible ||
    !runRetryVisible
  ) {
    throw new Error("CDP verification failed");
  }

  page.close();
  browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
