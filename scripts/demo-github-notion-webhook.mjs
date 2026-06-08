import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const apiBase = process.env.AI_BOARD_DEMO_API_BASE || "http://127.0.0.1:8000";
const desktop = join(homedir(), "Desktop");
const tokenFiles = [
  join(desktop, "ai-board-demo-codex-api-token.txt"),
  join(desktop, "ai-board-demo-github-api-token.txt"),
  join(desktop, "ai-board-demo-notion-api-token.txt"),
];

function loadPairs(path) {
  if (!existsSync(path)) return {};
  const pairs = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    pairs[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return pairs;
}

function loadDemoConfig() {
  const config = {};
  for (const file of tokenFiles) Object.assign(config, loadPairs(file));
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.startsWith("AI_BOARD_")) config[key] = value;
  }
  return config;
}

function requireValue(config, key) {
  const value = config[key] || "";
  if (!value || value.startsWith("PASTE_") || value.endsWith("_HERE") || value.includes("<public-ai-board-url>")) {
    throw new Error(`Missing demo value ${key}. Fill it in the desktop token txt files before running this script.`);
  }
  return value;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function sign(secret, body) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function main() {
  const config = loadDemoConfig();
  const githubToken = requireValue(config, "GITHUB_TOKEN");
  const notionToken = requireValue(config, "NOTION_TOKEN");
  const githubRepo = requireValue(config, "GITHUB_REPOSITORY");
  const notionPageUrl = requireValue(config, "NOTION_DEMO_PAGE_URL");
  const webhookSecret = requireValue(config, "AI_BOARD_GITHUB_WEBHOOK_SECRET");
  const password = config.AI_BOARD_DEMO_PASSWORD || `Demo-${randomUUID()}!`;
  const email = config.AI_BOARD_DEMO_EMAIL || `ai-board-demo-${Date.now()}@example.com`;

  const health = await request("/api/health");
  const register = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name: "AI Board Demo User", password }),
  });
  const auth = { Authorization: `Bearer ${register.token}` };

  const githubProfile = await request("/api/integration-profiles", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Demo GitHub webhook source",
      source_kind: "github",
      base_url: githubRepo,
      api_provider: "GitHub REST API",
      token_name: "GITHUB_TOKEN",
      token_value: githubToken,
      rag_targets: ["commits"],
      collect_limit: 20,
      collect_pages: 1,
    }),
  });

  await request("/api/integration-profiles", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Demo Notion small page target",
      source_kind: "notion",
      base_url: notionPageUrl,
      api_provider: "Notion API",
      token_name: "NOTION_TOKEN",
      token_value: notionToken,
      rag_targets: ["notion_pages"],
      collect_limit: 10,
      collect_pages: 1,
    }),
  });

  const automation = await request("/api/automations", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Demo GitHub commits to Notion page",
      integration_profile_id: githubProfile.profile.id,
      source: "GitHub push webhook",
      destination: "Small Notion demo page",
      interval_minutes: 5,
      instruction: "Append GitHub push commit summaries to the small Notion demo page.",
      template: "commit / author / link / next action",
      api_provider: "GitHub webhook + Notion API",
      ai_agent: "WebhookCommitAgent",
      github_repo_url: githubRepo,
      template_preset: "github_notion",
      custom_connections: [
        {
          label: "Small Notion demo page",
          service: "notion",
          url: notionPageUrl,
          api: "Notion API",
          auth_key_name: "NOTION_TOKEN",
          operation: "append_page_update",
          template: "commit: {title}\nsummary: {summary}\nlink: {url}",
        },
      ],
    }),
  });

  const commitSha = randomUUID().replace(/-/g, "");
  const payload = {
    repository: {
      full_name: githubRepo.replace(/\.git$/, "").split("github.com/").pop()?.replace(/^[:/]/, "") || "Wish-Upon-A-Star/ai-board-jungle",
      html_url: githubRepo,
      clone_url: githubRepo,
    },
    commits: [
      {
        id: commitSha,
        message: `AI Board demo webhook commit ${new Date().toISOString()}`,
        url: `${githubRepo.replace(/\/$/, "")}/commit/${commitSha.slice(0, 12)}`,
        author: { name: "AI Board Demo" },
      },
    ],
  };
  const body = JSON.stringify(payload);
  const webhook = await request("/api/webhooks/github", {
    method: "POST",
    headers: {
      "X-GitHub-Event": "push",
      "X-Hub-Signature-256": sign(webhookSecret, body),
    },
    body,
  });

  console.log(JSON.stringify({
    ok: true,
    apiBase,
    health,
    email,
    password,
    webhookSecret,
    githubProfileId: githubProfile.profile.id,
    automationTaskId: automation.task.id,
    notionPageUrl,
    webhook,
    next: [
      "If webhook.matched is 0, confirm the repository URL in the GitHub profile matches the payload repository.",
      "If the Notion write is failed/blocked in Integration Activity, share the Notion page with the Notion integration and verify NOTION_TOKEN.",
      "Use the generated email/password to inspect the created profiles, automation, run history, and activity log in the UI.",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
