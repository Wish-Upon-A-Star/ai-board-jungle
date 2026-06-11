import { chromium } from "playwright";

const publicUrl = (process.env.AI_BOARD_TEST_PUBLIC_URL || "https://railway-mediterranean-snap-populations.trycloudflare.com").replace(/\/$/, "");
const unique = Date.now();

async function apiJson(path, token = "", options = {}) {
  const response = await fetch(`${publicUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-ai-board-public-origin": publicUrl,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const login = await apiJson("/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const token = login.token;
  let profileId = null;
  let taskId = null;

  try {
    const profile = await apiJson("/api/integration-profiles", token, {
      method: "POST",
      body: JSON.stringify({
        name: `Activity UI GitHub ${unique}`,
        source_kind: "github",
        base_url: "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
        api_provider: "GitHub REST API",
        token_name: "GITHUB_TOKEN",
        token_value: `ghp_activity_ui_${unique}`,
        auth_type: "api_key",
        ai_provider: "OpenAI",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
        collect_limit: 1,
        collect_pages: 1,
      }),
    });
    profileId = profile.profile.id;

    const automation = await apiJson("/api/automations", token, {
      method: "POST",
      body: JSON.stringify({
        name: `Activity details UI ${unique}`,
        integration_profile_id: profileId,
        source: "GitHub repository",
        destination: "Notion board",
        interval_minutes: 10,
        instruction: "Collect repository changes and write a concise Korean summary.",
        template: "status / summary / evidence / next action",
        api_provider: "GitHub REST API",
        ai_agent: "github_notion_agent",
        template_preset: "github_notion",
        custom_template: "Korean activity verification",
      }),
    });
    taskId = automation.task.id;
    await apiJson(`/api/automations/${taskId}/run`, token, { method: "POST" });

    const activities = await apiJson(`/api/integration-activities?automation_task_id=${taskId}&event_type=automation.run&limit=3`, token);
    const activity = activities.activities.find((item) => item.automationTaskId === taskId && item.details?.changeHash);
    if (!activity) throw new Error(`No automation.run activity with changeHash for task ${taskId}`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 980 } });
    try {
      await page.goto(publicUrl, { waitUntil: "networkidle" });
      await page.evaluate((value) => localStorage.setItem("ai-board-token", value), token);
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("#workspace").waitFor({ state: "visible", timeout: 15000 });
      await page.locator('button[aria-controls="integrations-panel"]').click();
      await page.locator("#integrations-panel").waitFor({ state: "visible", timeout: 10000 });
      await page.locator(".profile-section-tabs button").nth(1).click();
      await page.locator("#integrations-panel details.advanced-panel summary").last().click();

      const row = page.locator(".activity-row").filter({ hasText: "automation.run" }).filter({ hasText: `task #${taskId}` }).first();
      await row.waitFor({ state: "visible", timeout: 15000 });
      const badgeTexts = (await row.locator(".activity-detail-badges small").allTextContents()).map((text) => text.trim());
      const expected = [
        `task #${taskId}`,
        `profile #${profileId}`,
        `hash ${String(activity.details.changeHash).slice(0, 10)}`,
        "manual",
      ];
      const missing = expected.filter((text) => !badgeTexts.includes(text));
      if (missing.length) throw new Error(`Activity detail badges missing: ${missing.join(", ")}; got ${badgeTexts.join(" | ")}`);

      const summary = await row.locator(".activity-summary p").innerText();
      if (!summary.trim()) throw new Error("Activity summary is empty");

      console.log(JSON.stringify({
        ok: true,
        publicUrl,
        taskId,
        profileId,
        activityId: activity.id,
        status: activity.status,
        checked: [
          "login",
          "fixture_profile_created",
          "fixture_automation_created",
          "fixture_automation_run_created",
          "activity_api_has_change_hash",
          "integrations_tab_opened",
          "saved_profiles_subtab_opened",
          "advanced_activity_log_opened",
          "activity_detail_badges_visible",
          "activity_summary_visible",
        ],
        badgeTexts,
      }, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    if (taskId) await apiJson(`/api/automations/${taskId}`, token, { method: "DELETE" }).catch(() => {});
    if (profileId) await apiJson(`/api/integration-profiles/${profileId}`, token, { method: "DELETE" }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
