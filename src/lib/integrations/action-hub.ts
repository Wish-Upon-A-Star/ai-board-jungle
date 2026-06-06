import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadGitHubNotionConfig, parseGitHubRepoUrl, syncGitHubNotion } from "./github-notion";

export type HubConfig = {
  githubProjectUrl: string;
  googleCalendarId: string;
  googleAccessToken: string;
  figmaFileUrl: string;
  figmaToken: string;
  automationInstruction: string;
  lastRunAt: string;
  lastRunSummary: string;
};

export type HubAction = {
  target: "github_project" | "github_notion" | "google_calendar" | "figma" | "board";
  action: string;
  mode: "live" | "demo";
  detail: string;
};

const file = join(process.cwd(), "data", "action-hub.json");

const empty: HubConfig = {
  githubProjectUrl: "",
  googleCalendarId: "primary",
  googleAccessToken: "",
  figmaFileUrl: "",
  figmaToken: "",
  automationInstruction: "",
  lastRunAt: "",
  lastRunSummary: "",
};

export async function loadHubConfig(): Promise<HubConfig> {
  try {
    return { ...empty, ...(JSON.parse(await readFile(file, "utf-8")) as Partial<HubConfig>) };
  } catch {
    return { ...empty };
  }
}

export function publicHubConfig(config: HubConfig) {
  return {
    ...config,
    googleAccessToken: config.googleAccessToken ? "configured" : "",
    figmaToken: config.figmaToken ? "configured" : "",
  };
}

export async function saveHubConfig(input: Partial<HubConfig>) {
  const current = await loadHubConfig();
  for (const [key, value] of Object.entries(input)) {
    if ((key === "googleAccessToken" || key === "figmaToken") && value === "") continue;
    (current as Record<string, unknown>)[key] = value;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(current, null, 2), "utf-8");
  return publicHubConfig(current);
}

function parseTargets(instruction: string): HubAction["target"][] {
  const text = instruction.toLowerCase();
  const targets = new Set<HubAction["target"]>();
  if (/github|깃헙|깃허브|kanban|칸반|project/.test(text)) targets.add("github_project");
  if (/notion|노션/.test(text)) targets.add("github_notion");
  if (/calendar|캘린더|일정|google/.test(text)) targets.add("google_calendar");
  if (/figma|피그마|design|디자인/.test(text)) targets.add("figma");
  if (targets.size === 0) targets.add("board");
  return Array.from(targets);
}

async function githubProjectAction(instruction: string): Promise<HubAction> {
  const config = await loadGitHubNotionConfig();
  const repo = config.githubUrl ? parseGitHubRepoUrl(config.githubUrl) : null;
  const live = Boolean(repo && config.githubToken);
  if (!live || !repo) {
    return {
      target: "github_project",
      action: "plan_or_update_kanban",
      mode: "demo",
      detail: "GitHub token/repo가 없어서 칸반 작업을 데모 계획으로 기록했습니다.",
    };
  }
  return {
    target: "github_project",
    action: "plan_or_update_kanban",
    mode: "demo",
    detail: `GitHub Projects GraphQL live mutation은 project id가 필요합니다. 현재 repo ${repo.full} 기준 instruction을 큐에 기록했습니다: ${instruction}`,
  };
}

async function googleCalendarAction(instruction: string): Promise<HubAction> {
  const config = await loadHubConfig();
  if (!config.googleAccessToken) {
    return {
      target: "google_calendar",
      action: "create_event",
      mode: "demo",
      detail: "Google OAuth access token이 없어서 캘린더 이벤트 생성을 데모 기록으로 처리했습니다.",
    };
  }
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.googleCalendarId || "primary")}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.googleAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: instruction.slice(0, 120),
      description: `AI Board 자동 지침 실행\n\n${instruction}`,
      start: { dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      end: { dateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
    }),
  });
  if (!response.ok) throw new Error(`Google Calendar API failed ${response.status}: ${await response.text()}`);
  return { target: "google_calendar", action: "create_event", mode: "live", detail: "Google Calendar event created." };
}

async function figmaAction(instruction: string): Promise<HubAction> {
  const config = await loadHubConfig();
  if (!config.figmaToken || !config.figmaFileUrl) {
    return {
      target: "figma",
      action: "sync_design_note",
      mode: "demo",
      detail: "Figma token/file URL이 없어서 디자인 지침을 데모 기록으로 처리했습니다.",
    };
  }
  return {
    target: "figma",
    action: "sync_design_note",
    mode: "demo",
    detail: `Figma REST live write는 target node/comment 범위가 필요합니다. 현재 file URL 기준 지침을 큐에 기록했습니다: ${instruction}`,
  };
}

export async function runInstructionHub(instruction: string) {
  const actions: HubAction[] = [];
  for (const target of parseTargets(instruction)) {
    if (target === "github_project") actions.push(await githubProjectAction(instruction));
    if (target === "github_notion") actions.push({ target, action: "sync_github_notion", mode: (await syncGitHubNotion()).mode, detail: "GitHub/Notion sync executed." });
    if (target === "google_calendar") actions.push(await googleCalendarAction(instruction));
    if (target === "figma") actions.push(await figmaAction(instruction));
    if (target === "board") actions.push({ target, action: "record_instruction", mode: "demo", detail: "게시판 운영 지침으로 기록했습니다." });
  }
  const config = await loadHubConfig();
  config.automationInstruction = instruction;
  config.lastRunAt = new Date().toISOString();
  config.lastRunSummary = JSON.stringify(actions);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2), "utf-8");
  return { instruction, actions };
}
