import { chromium } from "playwright";

const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";
const unique = Date.now();
const email = `token-ux-${unique}@example.com`;
const password = "password123";
const openAiToken = `sk-user-token-ux-${unique}`;
const githubToken = `ghp_user_token_ux_${unique}`;
const notionToken = `secret_user_token_ux_${unique}`;
const automationName = `Personal GitHub to Notion token UX check ${unique}`;

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

async function clickByText(page, text, options = {}) {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: options.timeout || 10000 });
  await locator.click();
}

async function clickTab(page, text) {
  const tab = page.getByRole("tab", { name: new RegExp(text) }).first();
  await tab.waitFor({ state: "visible", timeout: 10000 });
  await tab.click();
}

async function fillManualProfileForm(page, profile) {
  const form = page.locator("#profile-manual-form");
  await form.waitFor({ state: "visible", timeout: 10000 });
  const advanced = form.locator(".manual-profile-advanced");
  if (await advanced.evaluate((node) => node.open)) {
    throw new Error("Manual profile advanced settings should stay collapsed for the basic token save flow");
  }
  await form.locator("input").nth(0).fill(profile.name);
  await form.locator("select").nth(0).selectOption(profile.sourceKind);
  await form.locator("input").nth(1).fill(profile.apiProvider);
  await form.locator("input").nth(2).fill(profile.baseUrl);
  await form.locator("input").nth(3).fill(profile.tokenName);
  await form.locator("input").nth(4).fill(profile.tokenValue);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/integration-profiles") && response.request().method() === "POST", { timeout: 15000 }),
    form.locator("button").last().click(),
  ]);
}

async function registerThroughUi(page) {
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "회원가입" }).click();
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("이름").fill("Token UX User");
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await page.locator("#workspace").waitFor({ state: "visible", timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const cleanup = { token: "", profileIds: [], taskId: null, errors: [] };
  try {
    await registerThroughUi(page);
    const token = await page.evaluate(() => localStorage.getItem("ai-board-token"));
    if (!token) throw new Error("Registration did not store an auth token");
    cleanup.token = token;

    await clickTab(page, "프로필");
    await clickByText(page, "OpenAI 키 입력");
    await fillManualProfileForm(page, {
      name: "OpenAI 개인 API 키",
      sourceKind: "custom",
      apiProvider: "OpenAI API",
      baseUrl: "https://api.openai.com/v1",
      tokenName: "OPENAI_API_KEY",
      tokenValue: openAiToken,
      aiProvider: "OpenAI",
      aiModel: "gpt-4o-mini",
      aiApiBase: "https://api.openai.com/v1",
    });

    await clickByText(page, "수동 GitHub 프로필");
    await fillManualProfileForm(page, {
      name: "GitHub 개인 저장소",
      sourceKind: "github",
      apiProvider: "GitHub REST API",
      baseUrl: "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
      tokenName: "GITHUB_TOKEN",
      tokenValue: githubToken,
      aiProvider: "OpenAI",
      aiModel: "gpt-4o-mini",
      aiApiBase: "https://api.openai.com/v1",
    });

    await clickByText(page, "수동 Notion 프로필");
    await fillManualProfileForm(page, {
      name: "Notion 개인 페이지",
      sourceKind: "notion",
      apiProvider: "Notion API",
      baseUrl: "https://app.notion.com/p/3797051c2f9981b4bad3fe6545622eb8",
      tokenName: "NOTION_TOKEN",
      tokenValue: notionToken,
      aiProvider: "OpenAI",
      aiModel: "gpt-4o-mini",
      aiApiBase: "https://api.openai.com/v1",
    });

    let profiles = (await apiJson("/api/integration-profiles", token)).profiles;
    const openAiProfile = profiles.find((profile) => profile.name === "OpenAI 개인 API 키");
    const githubProfile = profiles.find((profile) => profile.name === "GitHub 개인 저장소");
    const notionProfile = profiles.find((profile) => profile.name === "Notion 개인 페이지");
    for (const profile of [openAiProfile, githubProfile, notionProfile]) {
      if (!profile) throw new Error("Expected profile was not saved");
      if (!profile.hasToken) throw new Error(`${profile.name} does not report a saved token`);
      if (JSON.stringify(profile).includes(openAiToken) || JSON.stringify(profile).includes(githubToken) || JSON.stringify(profile).includes(notionToken)) {
        throw new Error(`${profile.name} leaked a raw token in the API response`);
      }
    }

    await page.locator('nav [role="tab"]').nth(0).click();
    const automationForm = page.locator(".automation-form");
    await automationForm.locator("select").first().selectOption(String(githubProfile.id));
    await automationForm.locator("input").first().fill(automationName);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/automations") && response.request().method() === "POST", { timeout: 15000 }),
      automationForm.locator("button").last().click(),
    ]);

    const tasks = (await apiJson("/api/automations", token)).tasks;
    const task = tasks.find((item) => item.name === automationName);
    if (!task) throw new Error("Automation created through UI was not persisted");
    cleanup.taskId = task.id;
    cleanup.profileIds = [openAiProfile.id, githubProfile.id, notionProfile.id];
    if (task.integrationProfileId !== githubProfile.id) {
      throw new Error(`Automation did not keep selected user profile: ${task.integrationProfileId} !== ${githubProfile.id}`);
    }

    await page.locator(".user-menu button").click();
    await page.locator(".auth-tabs button").nth(0).click();
    await page.locator(".auth-form input").nth(0).fill(email);
    await page.locator(".auth-form input").nth(1).fill(password);
    await page.locator(".auth-form button").click();
    await page.locator("#workspace").waitFor({ state: "visible", timeout: 15000 });
    const reloginToken = await page.evaluate(() => localStorage.getItem("ai-board-token"));
    profiles = (await apiJson("/api/integration-profiles", reloginToken)).profiles;
    if (!profiles.some((profile) => profile.name === "OpenAI 개인 API 키" && profile.hasToken && profile.tokenStorage === "encrypted")) {
      throw new Error("OpenAI API key profile did not persist across login sessions as encrypted user data");
    }

    if (cleanup.taskId) {
      await apiJson(`/api/automations/${cleanup.taskId}`, reloginToken, { method: "DELETE" }).catch((error) => cleanup.errors.push(error.message));
    }
    for (const profileId of cleanup.profileIds) {
      await apiJson(`/api/integration-profiles/${profileId}`, reloginToken, { method: "DELETE" }).catch((error) => cleanup.errors.push(error.message));
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          appUrl,
          apiBase,
          email,
          checked: [
            "non_admin_register_ui",
            "openai_api_key_profile_ui",
            "github_token_profile_ui",
            "notion_token_profile_ui",
            "basic_token_save_flow_keeps_advanced_settings_collapsed",
            "raw_token_redaction",
            "automation_uses_selected_user_profile",
            "profiles_persist_after_relogin",
          ],
          profileIds: [openAiProfile.id, githubProfile.id, notionProfile.id],
          taskId: task.id,
          cleanupErrors: cleanup.errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
