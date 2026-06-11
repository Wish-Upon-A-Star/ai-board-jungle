import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const loadedConfigSources = [];
const configDiagnostics = [];
const checkConfigOnly = process.argv.includes("--check-config");
const skipMissing = process.argv.includes("--skip-missing");

function assignEnv(key, value) {
  if (!key || !value || process.env[key]) return false;
  process.env[key] = value;
  return true;
}

function looksLikeToken(value) {
  return /^(ghp_|github_pat_|ntn_|secret_|sk-|ya29\.|figd_|[A-Za-z0-9_\-.]{24,})/.test(value);
}

function loadEnvFile(path, rawTokenKey = "") {
  const diagnostic = {
    path,
    exists: existsSync(path),
    keyValueKeys: [],
    rawLines: 0,
    acceptedRawCandidates: 0,
    ignoredRawLines: 0,
    loadedKeys: [],
  };
  if (!diagnostic.exists) {
    configDiagnostics.push(diagnostic);
    return false;
  }
  const text = readFileSync(path, "utf8");
  let loaded = false;
  const rawCandidates = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.includes("=")) {
      const raw = trimmed.replace(/^["']|["']$/g, "");
      diagnostic.rawLines += 1;
      if (rawTokenKey && looksLikeToken(raw)) rawCandidates.push(raw);
      else diagnostic.ignoredRawLines += 1;
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    diagnostic.keyValueKeys.push(key);
    if (assignEnv(key, raw.replace(/^["']|["']$/g, ""))) {
      diagnostic.loadedKeys.push(key);
      loaded = true;
    }
  }
  if (rawTokenKey && !process.env[rawTokenKey] && rawCandidates.length) {
    diagnostic.acceptedRawCandidates = rawCandidates.length;
    if (assignEnv(rawTokenKey, rawCandidates[0])) {
      diagnostic.loadedKeys.push(rawTokenKey);
      loaded = true;
    }
  }
  if (loaded) loadedConfigSources.push(path);
  configDiagnostics.push(diagnostic);
  return loaded;
}

loadEnvFile(resolve(".env"));
loadEnvFile(resolve("backend/.env"));
loadEnvFile(join(homedir(), "Desktop", "ai-board-demo-codex-api-token.txt"));
loadEnvFile(join(homedir(), "Desktop", "ai-board-demo-github-api-token.txt"), "AI_BOARD_GITHUB_TOKEN");
loadEnvFile(join(homedir(), "Desktop", "ai-board-demo-notion-api-token.txt"), "AI_BOARD_NOTION_TOKEN");
loadEnvFile(join(homedir(), "Desktop", "figma.txt"), "AI_BOARD_FIGMA_TOKEN");
loadEnvFile(join(homedir(), "Desktop", "google.txt"), "AI_BOARD_GOOGLE_ACCESS_TOKEN");

function aliasEnv(target, sources) {
  if (process.env[target]) return;
  for (const source of sources) {
    if (process.env[source]) {
      process.env[target] = process.env[source];
      return;
    }
  }
}

aliasEnv("AI_BOARD_GITHUB_TOKEN", ["GITHUB_TOKEN", "GH_TOKEN"]);
aliasEnv("AI_BOARD_GITHUB_URL", ["GITHUB_REPOSITORY", "GITHUB_REPO_URL", "GITHUB_URL"]);
aliasEnv("AI_BOARD_NOTION_TOKEN", ["NOTION_TOKEN", "NOTION_API_TOKEN"]);
aliasEnv("AI_BOARD_NOTION_TASKS_URL", ["NOTION_TASKS_URL", "NOTION_DEMO_DATABASE_URL", "NOTION_DEMO_PAGE_URL", "NOTION_DEMO_PAGE_ID"]);
aliasEnv("AI_BOARD_GOOGLE_ACCESS_TOKEN", ["GOOGLE_ACCESS_TOKEN", "GOOGLE_CALENDAR_TOKEN"]);
aliasEnv("AI_BOARD_GOOGLE_CALENDAR_ID", ["GOOGLE_CALENDAR_ID", "CALENDAR_ID"]);
aliasEnv("AI_BOARD_FIGMA_TOKEN", ["FIGMA_TOKEN", "FIGMA_ACCESS_TOKEN"]);
aliasEnv("AI_BOARD_FIGMA_FILE_URL", ["FIGMA_FILE_URL", "FIGMA_DESIGN_URL", "FIGMA_FILE_KEY"]);

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const title = `[AI Board Live Test] ${runId}`;
const body = [
  "Created by scripts/test-live-integrations.mjs.",
  "Purpose: verify actual GitHub, Notion, Google Calendar, and Figma writes without using the app API.",
  `Run id: ${runId}`,
].join("\n");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function configStatus() {
  const requirements = {
    github: ["AI_BOARD_GITHUB_TOKEN", "AI_BOARD_GITHUB_URL"],
    notion: ["AI_BOARD_NOTION_TOKEN", "AI_BOARD_NOTION_TASKS_URL"],
    google_calendar: ["AI_BOARD_GOOGLE_ACCESS_TOKEN"],
    figma: ["AI_BOARD_FIGMA_TOKEN", "AI_BOARD_FIGMA_FILE_URL"],
  };
  return Object.entries(requirements).map(([service, names]) => {
    const missing = names.filter((name) => !process.env[name]);
    return {
      service,
      ready: missing.length === 0,
      missing,
      nextAction: missing.length ? expectedConfigHint(service, missing) : "",
    };
  });
}

function expectedConfigHint(service, missing) {
  const examples = {
    github: "Desktop/ai-board-demo-github-api-token.txt: GITHUB_TOKEN=... and GITHUB_REPOSITORY=Wish-Upon-A-Star/ai-board-jungle",
    notion: "Desktop/ai-board-demo-notion-api-token.txt: NOTION_TOKEN=... and NOTION_DEMO_PAGE_URL=https://app.notion.com/...",
    google_calendar: "Desktop/google.txt: GOOGLE_ACCESS_TOKEN=... or AI_BOARD_GOOGLE_ACCESS_TOKEN=...",
    figma: "Desktop/figma.txt: FIGMA_TOKEN=... and FIGMA_FILE_URL=https://www.figma.com/design/...",
  };
  return `${missing.join(", ")} missing. Add ${examples[service] || "the missing key=value pairs"}.`;
}

function publicConfigDiagnostics() {
  return configDiagnostics
    .filter((item) => item.exists)
    .map((item) => ({
      source: item.path.replace(homedir(), "~"),
      keyValueKeys: item.keyValueKeys,
      rawLines: item.rawLines,
      acceptedRawCandidates: item.acceptedRawCandidates,
      ignoredRawLines: item.ignoredRawLines,
      loadedKeys: item.loadedKeys,
    }));
}

function parseGithubRepo(url) {
  const input = String(url).trim();
  const shorthand = input.match(/^([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };
  const match = input.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (!match) throw new Error(`Cannot parse GitHub repository URL: ${url}`);
  return { owner: match[1], repo: match[2] };
}

function parseNotionId(urlOrId) {
  const raw = String(urlOrId).replace(/-/g, "");
  const matches = raw.match(/[0-9a-f]{32}/gi);
  if (!matches?.length) throw new Error(`Cannot parse Notion database id: ${urlOrId}`);
  return matches[matches.length - 1];
}

function parseFigmaFileKey(urlOrKey) {
  const match = String(urlOrKey).match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  return match ? match[1] : String(urlOrKey).trim();
}

async function fetchJson(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${label} failed ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

async function testGithub() {
  const token = requireEnv("AI_BOARD_GITHUB_TOKEN");
  const repoUrl = requireEnv("AI_BOARD_GITHUB_URL");
  const { owner, repo } = parseGithubRepo(repoUrl);
  const issue = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "ai-board-live-test",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, labels: ["ai-board-live-test"] }),
    },
    "GitHub issue create",
  );
  return { service: "github", ok: true, url: issue.html_url, id: issue.number };
}

async function testNotion() {
  const token = requireEnv("AI_BOARD_NOTION_TOKEN");
  const targetId = parseNotionId(requireEnv("AI_BOARD_NOTION_TASKS_URL"));
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };
  const databaseRead = await requestJson(`https://api.notion.com/v1/databases/${targetId}`, { headers }, "Notion database read");
  if (!databaseRead.response.ok) {
    const blocks = await fetchJson(
      `https://api.notion.com/v1/blocks/${targetId}/children`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          children: [
            {
              object: "block",
              type: "heading_3",
              heading_3: { rich_text: [{ type: "text", text: { content: title } }] },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ type: "text", text: { content: body } }] },
            },
          ],
        }),
      },
      "Notion page append",
    );
    return { service: "notion", ok: true, mode: "page_append", id: blocks.block?.id || targetId };
  }
  const database = databaseRead.data;
  const titleProperty = Object.entries(database.properties || {}).find(([, value]) => value.type === "title")?.[0] || "Name";
  const page = await fetchJson(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        parent: { database_id: targetId },
        properties: {
          [titleProperty]: { title: [{ text: { content: title } }] },
        },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: body } }] },
          },
        ],
      }),
    },
    "Notion page create",
  );
  return { service: "notion", ok: true, url: page.url, id: page.id };
}

async function testGoogleCalendar() {
  const token = requireEnv("AI_BOARD_GOOGLE_ACCESS_TOKEN");
  const calendarId = encodeURIComponent(process.env.AI_BOARD_GOOGLE_CALENDAR_ID || "primary");
  const start = new Date(Date.now() + 15 * 60 * 1000);
  const end = new Date(Date.now() + 45 * 60 * 1000);
  const event = await fetchJson(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: title,
        description: body,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    },
    "Google Calendar event create",
  );
  return { service: "google_calendar", ok: true, url: event.htmlLink, id: event.id };
}

async function testFigma() {
  const token = requireEnv("AI_BOARD_FIGMA_TOKEN");
  const fileKey = parseFigmaFileKey(requireEnv("AI_BOARD_FIGMA_FILE_URL"));
  const comment = await fetchJson(
    `https://api.figma.com/v1/files/${fileKey}/comments`,
    {
      method: "POST",
      headers: { "X-Figma-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ message: `${title}\n${body}` }),
    },
    "Figma comment create",
  );
  return { service: "figma", ok: true, url: `https://www.figma.com/file/${fileKey}?comment-id=${comment.id}`, id: comment.id };
}

function failureHint(service, message) {
  const text = String(message || "");
  if (service === "github" && /401|Bad credentials/i.test(text)) {
    return "GitHub token was loaded but rejected. Regenerate a fine-grained token for the target repository with Issues read/write access, then set GITHUB_TOKEN=... in Desktop/ai-board-demo-github-api-token.txt.";
  }
  if (service === "github" && /403|Resource not accessible|permission/i.test(text)) {
    return "GitHub token is valid but lacks permission. Grant repository Issues write access or use a token owned by an account with access to the repository.";
  }
  if (service === "notion" && /401|invalid|unauthorized/i.test(text)) {
    return "Notion token was loaded but rejected. Create a new Notion internal integration secret, share the target page/database with that integration, then set NOTION_TOKEN=... in Desktop/ai-board-demo-notion-api-token.txt.";
  }
  if (service === "notion" && /404|not found/i.test(text)) {
    return "Notion token may be valid but the target page/database is not shared with the integration. Share the page/database with the integration and keep NOTION_DEMO_PAGE_URL=... updated.";
  }
  if (service === "google_calendar" && /401|invalid|expired/i.test(text)) {
    return "Google access token was rejected or expired. Use OAuth login/refresh flow or set a fresh GOOGLE_ACCESS_TOKEN=... in Desktop/google.txt.";
  }
  if (service === "figma" && /401|403|token/i.test(text)) {
    return "Figma token was rejected or lacks file access. Set FIGMA_TOKEN=... and FIGMA_FILE_URL=... for a file the token can comment on.";
  }
  return "";
}

const tests = [
  ["github", testGithub],
  ["notion", testNotion],
  ["google_calendar", testGoogleCalendar],
  ["figma", testFigma],
];

if (checkConfigOnly) {
  const results = configStatus();
  const failed = results.filter((result) => !result.ready);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    mode: "check-config",
    loadedConfigSources: loadedConfigSources.map((source) => source.replace(homedir(), "~")),
    diagnostics: publicConfigDiagnostics(),
    results,
  }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

const results = [];
for (const [service, test] of tests) {
  try {
    const serviceConfig = configStatus().find((item) => item.service === service);
    if (skipMissing && serviceConfig && !serviceConfig.ready) {
      results.push({ service, ok: true, skipped: true, reason: `missing ${serviceConfig.missing.join(", ")}` });
      continue;
    }
    results.push(await test());
  } catch (error) {
    results.push({ service, ok: false, error: error.message, hint: failureHint(service, error.message) });
  }
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ ok: failed.length === 0, runId, results }, null, 2));
if (failed.length) process.exit(1);
