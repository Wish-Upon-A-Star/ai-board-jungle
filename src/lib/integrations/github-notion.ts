import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type GitHubNotionConfig = {
  githubUrl: string;
  notionTasksUrl: string;
  notionCommitsUrl: string;
  githubToken: string;
  notionToken: string;
  webhookSecret: string;
  autoSyncEnabled: boolean;
  intervalMinutes: number;
  lastRegisteredAt: string;
  lastSyncAt: string;
  lastSyncSummary: string;
};

export type SyncSummary = {
  mode: "live" | "demo";
  repo?: string;
  notionDatabaseId?: string;
  issuesSeen: number;
  commitsSeen: number;
  notionPagesTouched: number;
  githubIssuesTouched: number;
  warnings: string[];
};

const file = join(process.cwd(), "data", "github-notion.json");

const emptyConfig: GitHubNotionConfig = {
  githubUrl: "",
  notionTasksUrl: "",
  notionCommitsUrl: "",
  githubToken: "",
  notionToken: "",
  webhookSecret: "",
  autoSyncEnabled: false,
  intervalMinutes: 30,
  lastRegisteredAt: "",
  lastSyncAt: "",
  lastSyncSummary: "",
};

export async function loadGitHubNotionConfig(): Promise<GitHubNotionConfig> {
  try {
    return { ...emptyConfig, ...(JSON.parse(await readFile(file, "utf-8")) as Partial<GitHubNotionConfig>) };
  } catch {
    return { ...emptyConfig };
  }
}

export async function saveGitHubNotionConfig(input: Partial<GitHubNotionConfig>) {
  const current = await loadGitHubNotionConfig();
  const secretFields = new Set(["githubToken", "notionToken", "webhookSecret"]);
  for (const [key, value] of Object.entries(input)) {
    if (secretFields.has(key) && value === "") continue;
    (current as Record<string, unknown>)[key] = value;
  }
  current.intervalMinutes = Math.max(1, Math.min(1440, Number(current.intervalMinutes || 1)));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(current, null, 2), "utf-8");
  return publicGitHubNotionConfig(current);
}

export function publicGitHubNotionConfig(config: GitHubNotionConfig) {
  return {
    ...config,
    githubToken: config.githubToken ? "configured" : "",
    notionToken: config.notionToken ? "configured" : "",
    webhookSecret: config.webhookSecret ? "configured" : "",
  };
}

export function parseGitHubRepoUrl(url: string) {
  const match = url.trim().match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)(?:[/?#].*)?$/);
  if (!match) throw new Error("GitHub repository URL must look like https://github.com/owner/repo");
  return { owner: match[1], repo: match[2].replace(/\.git$/, ""), full: `${match[1]}/${match[2].replace(/\.git$/, "")}` };
}

export function parseNotionDatabaseId(urlOrId: string) {
  const compact = urlOrId.trim().replaceAll("-", "");
  const direct = compact.match(/^[0-9a-fA-F]{32}$/);
  if (direct) return compact.toLowerCase();
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) throw new Error("Notion database URL must contain a 32 character database id");
  return match[0].toLowerCase();
}

async function githubFetch<T>(config: GitHubNotionConfig, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function notionFetch<T>(config: GitHubNotionConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.notionToken}`,
      "Notion-Version": "2022-06-28",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Notion API failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function plainText(property: { type?: string; title?: Array<{ plain_text?: string; text?: { content?: string } }>; rich_text?: Array<{ plain_text?: string; text?: { content?: string } }>; select?: { name?: string }; number?: number }) {
  if (property.type === "title") return (property.title || []).map((part) => part.plain_text || part.text?.content || "").join("");
  if (property.type === "rich_text") return (property.rich_text || []).map((part) => part.plain_text || part.text?.content || "").join("");
  if (property.type === "select") return property.select?.name || "";
  if (property.type === "number") return String(property.number || "");
  return "";
}

function issuePageProperties(repoFull: string, issue: { number: number; title: string; state: string; html_url: string }) {
  return {
    Name: { title: [{ text: { content: issue.title.slice(0, 2000) } }] },
    "GitHub ID": { rich_text: [{ text: { content: `${repoFull}#${issue.number}` } }] },
    Repo: { rich_text: [{ text: { content: repoFull } }] },
    Number: { number: issue.number },
    State: { select: { name: issue.state } },
    URL: { url: issue.html_url },
  };
}

async function existingNotionPages(config: GitHubNotionConfig, databaseId: string) {
  const payload = await notionFetch<{ results: Array<{ id: string; properties: Record<string, unknown> }> }>(config, `/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 100 }),
  });
  const indexed = new Map<string, { id: string; properties: Record<string, unknown> }>();
  for (const page of payload.results || []) {
    const githubId = plainText(page.properties["GitHub ID"] as Parameters<typeof plainText>[0]);
    if (githubId) indexed.set(githubId, page);
  }
  return indexed;
}

export async function syncGitHubNotion() {
  const config = await loadGitHubNotionConfig();
  const warnings: string[] = [];
  const repo = config.githubUrl ? parseGitHubRepoUrl(config.githubUrl) : null;
  const notionDatabaseId = config.notionTasksUrl ? parseNotionDatabaseId(config.notionTasksUrl) : "";
  const liveReady = Boolean(repo && notionDatabaseId && config.githubToken && config.notionToken);

  let summary: SyncSummary;
  if (!liveReady || !repo) {
    warnings.push("Live sync needs GitHub URL, Notion DB URL, GitHub token, and Notion token. Demo sync recorded only.");
    summary = { mode: "demo", repo: repo?.full, notionDatabaseId, issuesSeen: 0, commitsSeen: 0, notionPagesTouched: 0, githubIssuesTouched: 0, warnings };
  } else {
    const issues = await githubFetch<Array<{ number: number; title: string; state: string; html_url: string }>>(
      config,
      `/repos/${repo.owner}/${repo.repo}/issues?state=all&per_page=20`,
    );
    const commits = await githubFetch<Array<unknown>>(config, `/repos/${repo.owner}/${repo.repo}/commits?per_page=10`);
    await notionFetch(config, `/databases/${notionDatabaseId}`);
    const pages = await existingNotionPages(config, notionDatabaseId);
    let notionTouched = 0;
    for (const issue of issues.slice(0, 10)) {
      const githubId = `${repo.full}#${issue.number}`;
      const existing = pages.get(githubId);
      if (existing) {
        await notionFetch(config, `/pages/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: issuePageProperties(repo.full, issue) }),
        });
      } else {
        await notionFetch(config, "/pages", {
          method: "POST",
          body: JSON.stringify({
            parent: { database_id: notionDatabaseId },
            properties: issuePageProperties(repo.full, issue),
          }),
        });
      }
      notionTouched += 1;
    }
    const refreshedPages = await existingNotionPages(config, notionDatabaseId);
    let githubTouched = 0;
    for (const page of refreshedPages.values()) {
      const pageRepo = plainText(page.properties.Repo as Parameters<typeof plainText>[0]);
      const number = Number(plainText(page.properties.Number as Parameters<typeof plainText>[0]));
      const title = plainText(page.properties.Name as Parameters<typeof plainText>[0]);
      const state = plainText(page.properties.State as Parameters<typeof plainText>[0]);
      if (pageRepo !== repo.full || !number || !title) continue;
      await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${number}`, {
        method: "PATCH",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ title, state: state === "closed" ? "closed" : "open" }),
      });
      githubTouched += 1;
    }
    summary = {
      mode: "live",
      repo: repo.full,
      notionDatabaseId,
      issuesSeen: issues.length,
      commitsSeen: commits.length,
      notionPagesTouched: notionTouched,
      githubIssuesTouched: githubTouched,
      warnings,
    };
  }

  const next = await loadGitHubNotionConfig();
  next.lastSyncAt = new Date().toISOString();
  next.lastSyncSummary = JSON.stringify(summary);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2), "utf-8");
  return summary;
}
