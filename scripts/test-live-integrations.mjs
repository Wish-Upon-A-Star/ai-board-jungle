import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(resolve(".env"));
loadEnvFile(resolve("backend/.env"));

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

function parseGithubRepo(url) {
  const match = String(url).match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#]|$)/i);
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
  const databaseId = parseNotionId(requireEnv("AI_BOARD_NOTION_TASKS_URL"));
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };
  const database = await fetchJson(`https://api.notion.com/v1/databases/${databaseId}`, { headers }, "Notion database read");
  const titleProperty = Object.entries(database.properties || {}).find(([, value]) => value.type === "title")?.[0] || "Name";
  const page = await fetchJson(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        parent: { database_id: databaseId },
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

const tests = [
  ["github", testGithub],
  ["notion", testNotion],
  ["google_calendar", testGoogleCalendar],
  ["figma", testFigma],
];
const results = [];
for (const [service, test] of tests) {
  try {
    results.push(await test());
  } catch (error) {
    results.push({ service, ok: false, error: error.message });
  }
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ ok: failed.length === 0, runId, results }, null, 2));
if (failed.length) process.exit(1);
