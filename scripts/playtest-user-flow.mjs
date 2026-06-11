import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const appUrl = process.env.AI_BOARD_PLAYTEST_URL || process.env.APP_URL || "http://127.0.0.1:3000";
const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";
const artifactDir = "output/playwright";
mkdirSync(artifactDir, { recursive: true });

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function apiJson(path, token = "", options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function clickVisible(locator, timeout = 10000) {
  await locator.waitFor({ state: "visible", timeout });
  await locator.click();
}

async function fillProfileForm(page, profile) {
  const form = page.locator("#profile-manual-form");
  await form.waitFor({ state: "visible", timeout: 10000 });
  await form.locator("input").nth(0).fill(profile.name);
  await form.locator("select").nth(0).selectOption(profile.sourceKind);
  await form.locator("input").nth(1).fill(profile.apiProvider);
  await form.locator("input").nth(2).fill(profile.baseUrl);
  await form.locator("input").nth(3).fill(profile.tokenName);
  await form.locator("input").nth(4).fill(profile.tokenValue);
  await form.locator("input").nth(5).fill(profile.aiProvider);
  await form.locator("input").nth(6).fill(profile.aiModel);
  await form.locator("input").nth(7).fill(profile.aiApiBase);
  await form.locator("select").nth(1).selectOption(profile.authType || "api_key");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/integration-profiles") && response.request().method() === "POST", { timeout: 15000 }),
    form.getByRole("button", { name: /연동 프로필 저장/ }).click(),
  ]);
}

async function clickMainTab(page, index, panelSelector) {
  await clickVisible(page.locator('nav[role="tablist"] [role="tab"]').nth(index));
  await page.locator(panelSelector).waitFor({ state: "visible", timeout: 10000 });
}

async function setSelectValue(page, selector, value) {
  await page.locator(selector).waitFor({ state: "attached", timeout: 10000 });
  const changed = await page.locator(selector).evaluate((select, nextValue) => {
    const option = Array.from(select.options).find((item) => item.value === String(nextValue));
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, String(nextValue));
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
  if (!changed) throw new Error(`Select option ${value} was not found for ${selector}`);
}

async function setInputValue(page, selector, value) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "attached", timeout: 10000 });
  await locator.evaluate((input, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(nextValue));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function submitAttachedForm(page, selector) {
  await page.locator(selector).waitFor({ state: "attached", timeout: 10000 });
  await page.locator(selector).evaluate((form) => form.requestSubmit());
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const email = `playtest-${Date.now()}@example.com`;
  const password = "password123";
  const tokenValue = `ghp_playtest_${Date.now()}`;
  const automationName = `Playtest GitHub to Notion ${Date.now()}`;
  const cleanup = { token: "", profileIds: [], taskId: null, knowledgeId: null, errors: [] };
  const findings = [];

  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${artifactDir}/playtest-start-${stamp()}.png`, fullPage: true });

    await clickVisible(page.locator(".auth-tabs button").nth(1));
    await page.locator(".auth-form input").nth(0).fill(email);
    await page.locator(".auth-form input").nth(1).fill("Playtest User");
    await page.locator(".auth-form input").nth(2).fill(password);
    await clickVisible(page.locator(".auth-form button").first());
    await page.locator("#workspace").waitFor({ state: "visible", timeout: 15000 });
    cleanup.token = await page.evaluate(() => localStorage.getItem("ai-board-token") || "");
    if (!cleanup.token) throw new Error("Registration did not store an auth token");

    await clickMainTab(page, 2, "#settings-panel");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/profile/settings") && response.request().method() === "PUT", { timeout: 15000 }),
      page.locator("#settings-panel form").getByRole("button", { name: /기본 설정 저장/ }).click(),
    ]);

    await clickMainTab(page, 1, "#integrations-panel");
    await clickVisible(page.getByRole("button", { name: /수동 GitHub 프로필/ }));
    await fillProfileForm(page, {
      name: `Playtest GitHub ${Date.now()}`,
      sourceKind: "github",
      apiProvider: "GitHub REST API",
      baseUrl: "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
      tokenName: "GITHUB_TOKEN",
      tokenValue,
      aiProvider: "OpenAI",
      aiModel: "gpt-4o-mini",
      aiApiBase: "https://api.openai.com/v1",
    });
    let profiles = (await apiJson("/api/integration-profiles", cleanup.token)).profiles;
    const githubProfile = profiles.find((profile) => profile.name.startsWith("Playtest GitHub"));
    if (!githubProfile?.hasToken) throw new Error("GitHub profile was not saved with a token");
    if (JSON.stringify(githubProfile).includes(tokenValue)) throw new Error("Raw GitHub token leaked in profile response");
    cleanup.profileIds.push(githubProfile.id);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#workspace").waitFor({ state: "visible", timeout: 15000 });

    await clickMainTab(page, 0, "#new-task");
    const automationForm = page.locator("#new-task .automation-form");
    await automationForm.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(
      (profileId) => Array.from(document.querySelectorAll("#new-task select option")).some((option) => option.value === String(profileId)),
      githubProfile.id,
      { timeout: 15000 },
    );
    await clickVisible(automationForm.locator(".preset-card").first());
    await setSelectValue(page, "#new-task .automation-form select", githubProfile.id);
    await setInputValue(page, "#new-task .automation-form input", automationName);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/automations") && response.request().method() === "POST", { timeout: 15000 }),
      submitAttachedForm(page, "#new-task .automation-form"),
    ]);
    const tasks = (await apiJson("/api/automations", cleanup.token)).tasks;
    const task = tasks.find((item) => item.name === automationName);
    if (!task) throw new Error("Automation created through UI was not persisted");
    if (task.integrationProfileId !== githubProfile.id) throw new Error("Automation did not keep the selected user profile");
    cleanup.taskId = task.id;
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#workspace").waitFor({ state: "visible", timeout: 15000 });
    await clickMainTab(page, 0, "#new-task");
    await page.screenshot({ path: `${artifactDir}/playtest-after-create-${stamp()}.png`, fullPage: true });

    const taskCard = page.locator(".task-card-v2").filter({ hasText: automationName }).first();
    await clickVisible(taskCard.locator(".task-card-main").first());
    await clickVisible(taskCard.locator(".task-actions button").first());
    await clickVisible(taskCard.getByRole("button", { name: /실행 기록/ }));
    await clickVisible(taskCard.getByRole("button", { name: /공유/ }));
    await clickVisible(page.getByRole("button", { name: /예약 실행 확인/ }).first());

    await clickMainTab(page, 3, "#knowledge-panel");
    await page.locator("#knowledge-panel input").first().fill("플레이테스트 지식자료");
    await page.locator("#knowledge-panel textarea").nth(1).fill("GitHub 변경사항은 Notion BOARD에 정리하고, Notion 요청은 GitHub 이슈로 등록합니다.");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/knowledge") && response.request().method() === "POST", { timeout: 15000 }),
      page.locator("#knowledge-panel").getByRole("button", { name: /자료 저장/ }).click(),
    ]);
    const knowledge = (await apiJson("/api/knowledge", cleanup.token)).sources.find((source) => source.title === "플레이테스트 지식자료");
    if (!knowledge) throw new Error("Knowledge source created through UI was not persisted");
    cleanup.knowledgeId = knowledge.id;

    await clickMainTab(page, 4, "#board-panel");
    await page.getByRole("button", { name: /게시글/ }).first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: /공유 자동화/ }).first().waitFor({ state: "visible", timeout: 10000 });

    await clickMainTab(page, 5, "#api-panel");
    await clickVisible(page.locator("#api-panel .check-card").first());
    await clickVisible(page.locator("#api-panel .check-card").nth(1));
    await clickVisible(page.locator("#api-panel .check-card").nth(2));
    await clickVisible(page.locator("#api-panel .check-card").nth(3));
    await page.screenshot({ path: `${artifactDir}/playtest-final-${stamp()}.png`, fullPage: true });

    const visibleErrors = await page.locator(".top-error:visible, .form-status.error:visible").allTextContents();
    for (const message of visibleErrors) {
      if (message.trim()) findings.push(message.trim());
    }

    if (cleanup.knowledgeId) {
      await apiJson(`/api/knowledge/${cleanup.knowledgeId}`, cleanup.token, { method: "DELETE" }).catch((error) => cleanup.errors.push(error.message));
    }
    if (cleanup.taskId) {
      await apiJson(`/api/automations/${cleanup.taskId}`, cleanup.token, { method: "DELETE" }).catch((error) => cleanup.errors.push(error.message));
    }
    for (const profileId of cleanup.profileIds) {
      await apiJson(`/api/integration-profiles/${profileId}`, cleanup.token, { method: "DELETE" }).catch((error) => cleanup.errors.push(error.message));
    }

    console.log(JSON.stringify({
      ok: findings.length === 0,
      appUrl,
      apiBase,
      email,
      checked: [
        "register",
        "save default profile settings",
        "save GitHub token profile",
        "raw token redaction",
        "create automation with selected profile",
        "run automation",
        "run history",
        "share automation",
        "scheduler tick",
        "save knowledge source",
        "board tabs separated",
        "API console health/RAG/MCP/Agent Hub",
        "cleanup",
      ],
      profileIds: cleanup.profileIds,
      taskId: cleanup.taskId,
      knowledgeId: cleanup.knowledgeId,
      findings,
      cleanupErrors: cleanup.errors,
    }, null, 2));
    if (findings.length || cleanup.errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
