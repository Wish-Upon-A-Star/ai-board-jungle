import net from "node:net";

const port = process.env.CDP_PORT || "9223";
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";
const cdpProfileName = "CDP Figma dry-run profile";
const cdpKnowledgeTitle = "CDP verification document";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    timeout.unref?.();
  });
  try {
    return await Promise.race([fetch(url, options), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function preflight() {
  const checkTcpPort = (host, targetPort, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port: targetPort });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("timeout"));
      }, timeoutMs);
      timeout.unref?.();
      socket.once("connect", () => {
        clearTimeout(timeout);
        socket.end();
        resolve(true);
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  const checks = [
    {
      name: "FastAPI backend",
      url: `${apiBase}/api/health`,
      fix: "Run `npm run verify:fastapi` for managed verification or `npm start` before CDP smoke.",
    },
    {
      name: "React frontend",
      url: appUrl,
      fix: "Run `npm --prefix frontend run dev` with VITE_API_BASE pointing at the backend.",
    },
    {
      name: "Chrome CDP",
      url: `http://127.0.0.1:${port}/json/version`,
      tcpPort: Number(port),
      fix: "Start Chrome/Edge with remote debugging on the selected CDP_PORT, for example port 9223.",
    },
  ];
  const failures = [];
  for (const check of checks) {
    try {
      if (check.tcpPort) {
        await checkTcpPort("127.0.0.1", check.tcpPort);
      } else {
        const response = await fetchWithTimeout(check.url, {}, 4000);
        if (!response.ok) failures.push({ ...check, status: response.status });
      }
    } catch (error) {
      failures.push({ ...check, status: error.message });
    }
  }
  if (failures.length) {
    const message = failures
      .map((failure) => `- ${failure.name} unavailable at ${failure.url} (${failure.status}). ${failure.fix}`)
      .join("\n");
    throw new Error(`CDP preflight failed:\n${message}`);
  }
}

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
  await preflight();
  const version = await (await fetchWithTimeout(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.call("Target.createTarget", { url: appUrl });
  await wait(2500);

  const targets = await (await fetchWithTimeout(`http://127.0.0.1:${port}/json/list`)).json();
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
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const apiJson = async (path, options = {}) => {
    const response = await fetchWithTimeout(`${apiBase}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    return response.json();
  };

  const profileData = await apiJson("/api/integration-profiles");
  const cdpProfiles = profileData.profiles.filter((profile) => profile.name === cdpProfileName && profile.sourceKind === "figma");
  for (const duplicateProfile of cdpProfiles.slice(1)) {
    await apiJson(`/api/integration-profiles/${duplicateProfile.id}`, { method: "DELETE" });
  }
  if (!cdpProfiles.length) {
    await apiJson("/api/integration-profiles", {
      method: "POST",
      body: JSON.stringify({
        name: cdpProfileName,
        source_kind: "figma",
        base_url: "https://www.figma.com/design/cdp-test/ai-board",
        api_provider: "Figma REST API",
        token_name: "FIGMA_TOKEN",
        token_value: "",
        ai_provider: "OpenAI",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
        rag_targets: ["figma_comments"],
        collect_limit: 5,
        collect_pages: 1,
        custom_connections: [],
        custom_template: "Figma dry-run verification",
      }),
    });
  }

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
    "Delete",
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
  const loadMorePostsClicked = await evalJs(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.innerText.includes("Load more posts"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(loadMorePostsClicked ? 1200 : 100);
  const postIdsUnique = await evalJs(`(() => {
    const ids = Array.from(document.querySelectorAll("[data-post-id]")).map((item) => item.getAttribute("data-post-id"));
    return ids.length === new Set(ids).size;
  })()`);
  if (!postIdsUnique) missing.push("unique post ids");

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
  const postPageApi = await apiJson("/api/posts?limit=1&offset=0").then(
    (data) => Array.isArray(data.posts) && data.limit === 1 && typeof data.total === "number" && typeof data.hasMore === "boolean"
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
  const knowledgeCreate = await apiJson("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({
      title: cdpKnowledgeTitle,
      source_type: "document",
      instruction: "Use this for UI smoke verification.",
      extracted_text: "GitHub Notion Figma Calendar automation verification.",
      tags: ["cdp", "verification"],
    }),
  });
  const knowledgeSaved = Boolean(knowledgeCreate.source);
  const knowledgeDeleted = knowledgeCreate.source
    ? await apiJson(`/api/knowledge/${knowledgeCreate.source.id}`, { method: "DELETE" }).then((data) => data.ok === true)
    : false;
  const healthOk = await fetchWithTimeout(`${apiBase}/api/health`).then((response) => response.ok);
  const mcpOk = await fetchWithTimeout(`${apiBase}/mcp/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "weather.lookup", params: { location: "Seoul" } }),
  }).then((response) => response.ok);
  const hubOk = await fetchWithTimeout(`${apiBase}/api/integrations/hub/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: "Summarize GitHub Notion automation status" }),
  }).then((response) => response.ok);
  const validationErrorVisible = await evalJs(`(async () => {
    const mod = await import("/src/api.js");
    try {
      await mod.api("/api/automations", {
        method: "POST",
        body: JSON.stringify({
          name: "Broken UI validation",
          source: "Custom source",
          destination: "Custom target",
          interval_minutes: 5,
          instruction: "Reject incomplete custom connection metadata.",
          template: "title / action",
          api_provider: "Custom API",
          ai_agent: "CustomWorkflowAgent",
          custom_connections: [{
            label: "Broken target",
            service: "notion",
            url: "https://www.notion.so/workspace/db",
            api: "",
            auth_key_name: " ",
            operation: "",
            template: "title: {title}"
          }]
        })
      });
      return false;
    } catch (error) {
      return error.message.includes("입력값을 확인하세요") &&
        Array.isArray(error.validationIssues) &&
        error.validationIssues.some((issue) => issue.field.includes("custom_connections") && issue.message.includes("api, auth_key_name, operation"));
    }
  })()`);

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
  const runRetryVisible = retryClicked && text.includes("Retry") && text.includes("Updated") && text.includes("Retry updated");
  const deleteClicked = await evalJs(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.innerText.trim() === "Delete");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await wait(500);
  text = await bodyText();
  const deleteConfirmVisible = deleteClicked && text.includes("Confirm delete") && text.includes("Cancel");

  const result = {
    missing,
    integrationProfileApi,
    collectorApi,
    readinessApi,
    liveWriteApi,
    activityApi,
    activityFilterApi,
    activityPageApi,
    postPageApi,
    realWriteAuditApi,
    schedulerApi,
    automationRunsApi,
    knowledgeSaved,
    knowledgeDeleted,
    healthOk,
    mcpOk,
    hubOk,
    validationErrorVisible,
    runHistoryVisible,
    runDetailsVisible,
    runRetryVisible,
    deleteConfirmVisible,
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
    !postPageApi ||
    !realWriteAuditApi ||
    !schedulerApi ||
    !automationRunsApi ||
    !knowledgeSaved ||
    !knowledgeDeleted ||
    !healthOk ||
    !mcpOk ||
    !hubOk ||
    !validationErrorVisible ||
    !runHistoryVisible ||
    !runDetailsVisible ||
    !runRetryVisible ||
    !deleteConfirmVisible
  ) {
    throw new Error("CDP verification failed");
  }

  page.close();
  browser.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
