const API = process.env.API_BASE || "http://127.0.0.1:8000";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertKeys(object, keys, label) {
  assert(object && typeof object === "object" && !Array.isArray(object), `${label} must be an object`);
  const missing = keys.filter((key) => !(key in object));
  assert(missing.length === 0, `${label} missing keys: ${missing.join(", ")}`);
}

async function call(path, options = {}, token = "") {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function callStatus(path, options = {}, token = "") {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

let token = "";
let profileId = null;
let taskId = null;
let originalSystemPublicBaseUrl = null;

try {
  const login = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  assert(typeof login.token === "string" && login.token.length > 20, "login token contract changed");
  token = login.token;

  const settings = await call("/api/profile/settings", {}, token);
  assertKeys(settings, ["profileSettings"], "profile settings response");
  assertKeys(settings.profileSettings, ["aiProvider", "aiModel", "apiKeyStrategy", "templatePreset", "customConnections"], "profileSettings");
  assert(Array.isArray(settings.profileSettings.customConnections), "profileSettings.customConnections must be an array");

  const systemSettings = await call("/api/system/settings", {}, token);
  assertKeys(systemSettings, ["systemSettings"], "system settings response");
  assertKeys(systemSettings.systemSettings, ["publicBaseUrl", "source"], "systemSettings");
  originalSystemPublicBaseUrl = systemSettings.systemSettings.publicBaseUrl || "";

  const contractPublicBaseUrl = "https://contract-public.example.test";
  const savedSystemSettings = await call(
    "/api/system/settings",
    { method: "PUT", body: JSON.stringify({ public_base_url: `${contractPublicBaseUrl}/` }) },
    token,
  );
  assert(savedSystemSettings.systemSettings.publicBaseUrl === contractPublicBaseUrl, "system settings must trim trailing slash");
  assert(savedSystemSettings.systemSettings.source === "database", "system settings save must report database source");
  const oauthStatusWithSavedOrigin = await call(
    "/api/oauth/status",
    { headers: { "x-ai-board-public-origin": "https://temporary-contract.trycloudflare.com" } },
    token,
  );
  assert(oauthStatusWithSavedOrigin.publicOrigin.origin === contractPublicBaseUrl, "OAuth status must prefer saved public base URL");
  for (const provider of oauthStatusWithSavedOrigin.providers) {
    assertKeys(provider, ["provider", "configured", "missing", "redirectUri", "redirectUriSource", "mcpServerUrl", "setupUrl", "scope", "baseUrl", "apiProvider"], "oauth provider item");
    assert(
      provider.redirectUri === `${contractPublicBaseUrl}/api/oauth/${provider.provider}/callback`,
      `${provider.provider} redirectUri must use saved public base URL`,
    );
    assert(provider.redirectUriSource === "database_public_base_url", `${provider.provider} redirectUriSource must report database public base URL`);
  }
  await call("/api/system/settings", { method: "PUT", body: JSON.stringify({ public_base_url: originalSystemPublicBaseUrl }) }, token);
  originalSystemPublicBaseUrl = null;

  const readiness = await call("/api/provider-readiness", {}, token);
  assert(Array.isArray(readiness.providers), "provider-readiness.providers must be an array");
  for (const provider of readiness.providers) {
    assertKeys(provider, ["key", "name", "ready", "profileCount", "readyCount", "profiles", "nextAction"], "provider readiness item");
    assert(Array.isArray(provider.profiles), "provider readiness profiles must be an array");
  }

  const webhookReadiness = await call("/api/webhook-readiness", {}, token);
  assert(Array.isArray(webhookReadiness.webhooks), "webhook-readiness.webhooks must be an array");
  const webhookProviders = new Set(webhookReadiness.webhooks.map((item) => item.provider));
  assert(webhookProviders.has("github") && webhookProviders.has("notion"), "webhook readiness must list GitHub and Notion");
  for (const webhook of webhookReadiness.webhooks) {
    assertKeys(webhook, ["provider", "name", "endpoint", "events", "signatureHeader", "secretEnv", "secretConfigured", "setupUrl", "usedByTemplates", "matchingRule", "nextAction"], "webhook readiness item");
    assert(webhook.endpoint.includes(`/api/webhooks/${webhook.provider}`), `${webhook.provider} webhook endpoint must point at provider webhook route`);
    assert(Array.isArray(webhook.usedByTemplates), `${webhook.provider} usedByTemplates must be an array`);
    assert(!JSON.stringify(webhook).includes("secret-value"), `${webhook.provider} webhook readiness must not expose secret values`);
  }

  const invalidConnection = {
    label: "Broken target",
    service: "notion",
    url: "https://www.notion.so/workspace/db",
    api: "",
    auth_key_name: " ",
    operation: "",
    template: "title: {title}",
  };
  for (const [path, body] of [
    [
      "/api/profile/settings",
      {
        ai_provider: "OpenAI",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
        api_key_strategy: "Use private user token references.",
        template_preset: "custom",
        custom_template: "title: {title}",
        custom_connections: [invalidConnection],
      },
    ],
    [
      "/api/integration-profiles",
      {
        name: "Broken contract profile",
        source_kind: "custom",
        base_url: "",
        api_provider: "Custom API",
        token_name: "CUSTOM_API_KEY",
        token_value: "secret",
        rag_targets: [],
        custom_template: "title: {title}",
        custom_connections: [invalidConnection],
      },
    ],
    [
      "/api/automations",
      {
        name: "Broken contract automation",
        source: "Custom source",
        destination: "Custom target",
        interval_minutes: 5,
        instruction: "Reject incomplete custom connection metadata.",
        template: "title / action",
        api_provider: "Custom API",
        ai_agent: "CustomWorkflowAgent",
        custom_connections: [invalidConnection],
      },
    ],
  ]) {
    const rejected = await callStatus(path, { method: path === "/api/profile/settings" ? "PUT" : "POST", body: JSON.stringify(body) }, token);
    assert(rejected.status === 422, `${path} must reject incomplete custom connection fields`);
    assert(JSON.stringify(rejected.data).includes("api, auth_key_name, operation"), `${path} validation detail changed`);
  }

  const createdProfile = await call(
    "/api/integration-profiles",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Contract GitHub profile",
        source_kind: "github",
        base_url: "https://github.com/example/example",
        api_provider: "GitHub REST API",
        token_name: "GITHUB_TOKEN",
        token_value: "",
        ai_provider: "OpenAI",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
        rag_targets: ["issues", "commits", "pull_requests"],
        collect_limit: 3,
        collect_pages: 1,
        custom_connections: [
          {
            label: "GitHub Issues",
            service: "github",
            url: "https://github.com/example/example/issues",
            api: "GitHub REST API",
            auth_key_name: "GITHUB_TOKEN",
            operation: "issue_sync",
            template: "title/status/link/summary",
          },
        ],
        custom_template: "Summarize changed issues and propose the next action.",
      }),
    },
    token,
  );
  assertKeys(createdProfile, ["profile"], "create integration profile response");
  const profile = createdProfile.profile;
  profileId = profile.id;
  assertKeys(
    profile,
    [
      "id",
      "name",
      "sourceKind",
      "baseUrl",
      "apiProvider",
      "tokenName",
      "hasToken",
      "tokenPreview",
      "tokenStorage",
      "authType",
      "mcpServerUrl",
      "mcpAuthSubject",
      "mcpScopes",
      "aiProvider",
      "aiModel",
      "ragTargets",
      "collectLimit",
      "collectPages",
      "customConnections",
      "customTemplate",
      "lastCollect",
    ],
    "integration profile",
  );
  assert(!("tokenValue" in profile) && !("token_value" in profile), "integration profile must not expose raw token values");
  assert(profile.sourceKind === "github", "integration profile sourceKind must be camelCase github");
  assert(Array.isArray(profile.ragTargets) && profile.ragTargets.includes("issues"), "integration profile ragTargets contract changed");
  assert(Array.isArray(profile.customConnections) && profile.customConnections.length === 1, "integration profile customConnections contract changed");

  const profileList = await call("/api/integration-profiles", {}, token);
  assert(Array.isArray(profileList.profiles), "integration profile list must contain profiles array");
  assert(profileList.profiles.some((item) => item.id === profileId), "created integration profile missing from list");

  const collect = await call(`/api/integration-profiles/${profileId}/collect?limit=1&pages=1`, { method: "POST" }, token);
  assertKeys(collect, ["profile", "collected", "saved", "skippedDuplicates", "warnings", "status"], "collect response");
  assert(Array.isArray(collect.saved) && Array.isArray(collect.warnings), "collect saved and warnings must be arrays");
  assert(typeof collect.collected === "number" && typeof collect.status === "string", "collect numeric/status contract changed");

  const dryWrite = await call(
    `/api/integration-profiles/${profileId}/write`,
    { method: "POST", body: JSON.stringify({ title: "Contract dry run", body: "No external write.", dry_run: true }) },
    token,
  );
  assertKeys(dryWrite, ["profile", "write"], "integration write response");
  assertKeys(dryWrite.write, ["service", "status", "dryRun"], "integration write result");
  assert(dryWrite.write.dryRun === true, "dry-run write must not become a live write");

  const automation = await call(
    "/api/automations",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Contract automation",
        integration_profile_id: profileId,
        source: "GitHub Issues",
        destination: "Notion Tasks",
        interval_minutes: 3,
        instruction: "Summarize changed GitHub issues and sync them to a Notion task table.",
        template: "title/status/github link/summary/next action",
        api_provider: "GitHub REST API + Notion API",
        ai_agent: "SyncPlannerAgent",
        template_preset: "github_notion",
        custom_template: "Use the selected integration profile.",
      }),
    },
    token,
  );
  assertKeys(automation, ["task", "plan"], "automation create response");
  taskId = automation.task.id;
  assertKeys(
    automation.task,
    ["id", "name", "integrationProfileId", "integrationProfile", "intervalMinutes", "status", "lastResult", "lastRunAt", "runs"],
    "automation task",
  );
  assert(Array.isArray(automation.task.runs), "automation task runs must be an array");
  assertKeys(automation.plan, ["taskId", "agent", "integrationProfile", "ai", "intervalMinutes", "route", "targets", "externalRagSources"], "automation plan");
  assert(automation.task.integrationProfileId === profileId, "automation did not keep selected integration profile id");
  assert(automation.plan.integrationProfile?.id === profileId, "automation plan did not include selected integration profile");
  assert(Array.isArray(automation.plan.targets) && automation.plan.targets.length > 0, "automation plan targets must be present");

  const run = await call(`/api/automations/${taskId}/run`, { method: "POST" }, token);
  assertKeys(run, ["task", "run"], "automation run response");
  assertKeys(run.run, ["id", "result", "createdPostId"], "automation immediate run");
  assertKeys(run.run.result, ["status", "targets", "agent"], "automation run result");
  assert(Array.isArray(run.run.result.targets), "automation run result targets must be an array");

  const runs = await call(`/api/automations/${taskId}/runs?limit=2&offset=0`, {}, token);
  assertKeys(runs, ["task", "runs", "total", "limit", "offset", "nextOffset", "hasMore"], "automation runs page");
  assert(Array.isArray(runs.runs) && runs.limit === 2 && typeof runs.hasMore === "boolean", "automation runs pagination contract changed");
  for (const historyRun of runs.runs) {
    assertKeys(historyRun, ["id", "taskId", "ownerId", "result", "createdPostId", "createdAt"], "automation history run");
  }

  const activities = await call(`/api/integration-activities?integration_profile_id=${profileId}&limit=5`, {}, token);
  assertKeys(activities, ["activities", "total", "limit", "offset", "nextOffset", "hasMore"], "integration activities page");
  assert(Array.isArray(activities.activities), "integration activities must be an array");
  for (const activity of activities.activities) {
    assertKeys(
      activity,
      ["id", "ownerId", "automationTaskId", "integrationProfileId", "eventType", "provider", "status", "summary", "details", "createdAt"],
      "integration activity",
    );
  }
  const writeActivity = activities.activities.find((activity) => activity.eventType === "integration_profile.write");
  assert(writeActivity && writeActivity.details?.dryRun === true, "dry-run write activity must keep details.dryRun true");

  const scheduler = await call("/api/automations/scheduler/tick?limit=1", { method: "POST" }, token);
  assertKeys(scheduler, ["checked", "due", "limit", "results"], "scheduler tick response");
  assert(Array.isArray(scheduler.results), "scheduler results must be an array");

  const mcp = await call("/mcp/rpc", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: "contract", method: "automation.describe", params: {} }),
  });
  assertKeys(mcp, ["jsonrpc", "id", "result"], "mcp response");
  assert(typeof mcp.result.summary === "string", "mcp automation.describe summary missing");

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "profile_settings",
      "provider_readiness",
      "webhook_readiness",
      "integration_profile_create_list_collect_write",
      "automation_create_run_history_tick",
      "integration_activities",
      "mcp_rpc",
      "token_redaction",
      "custom_connection_validation",
      "system_settings_public_oauth_origin",
    ],
    profileId,
    taskId,
    activityCount: activities.activities.length,
  }, null, 2));
} finally {
  const cleanupErrors = [];
  if (token && taskId) {
    await call(`/api/automations/${taskId}`, { method: "DELETE" }, token).catch((error) => cleanupErrors.push(error.message));
  }
  if (token && profileId) {
    await call(`/api/integration-profiles/${profileId}`, { method: "DELETE" }, token).catch((error) => cleanupErrors.push(error.message));
  }
  if (token && originalSystemPublicBaseUrl !== null) {
    await call("/api/system/settings", { method: "PUT", body: JSON.stringify({ public_base_url: originalSystemPublicBaseUrl }) }, token)
      .catch((error) => cleanupErrors.push(error.message));
  }
  if (cleanupErrors.length) {
    throw new Error(`contract cleanup failed: ${cleanupErrors.join("; ")}`);
  }
}
