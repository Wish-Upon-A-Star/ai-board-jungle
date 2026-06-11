import { chromium } from "playwright";

const appUrl = (process.env.AI_BOARD_TEST_PUBLIC_URL || "https://railway-mediterranean-snap-populations.trycloudflare.com").replace(/\/$/, "");
const unique = Date.now();

async function apiJson(path, token = "", options = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-ai-board-public-origin": appUrl,
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
  const automation = await apiJson("/api/automations", token, {
    method: "POST",
    body: JSON.stringify({
      name: `UI readability automation ${unique}`,
      source: "GitHub commits/issues/pull requests",
      destination: "Notion BOARD and GitHub Issues",
      interval_minutes: 10,
      instruction: "Summarize GitHub changes, write Korean Notion cards, and create GitHub issues for risks.",
      template: "상태 / 변경 요약 / 근거 링크 / 다음 액션",
      api_provider: "GitHub REST API + Notion API",
      ai_agent: "github_notion_agent",
      template_preset: "github_notion",
      custom_template: "Korean automation report card",
    }),
  });
  const taskId = automation.task.id;
  try {
    await apiJson(`/api/automations/${taskId}/run`, token, { method: "POST" });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 950 } });
    try {
      await page.goto(appUrl, { waitUntil: "networkidle" });
      await page.evaluate((value) => localStorage.setItem("ai-board-token", value), token);
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("nav button").nth(0).click();

      const taskCard = page.locator(".task-card-v2").filter({ hasText: automation.task.name }).first();
      await taskCard.waitFor({ state: "visible", timeout: 15000 });
      const cardBox = await taskCard.boundingBox();
      if (!cardBox || cardBox.width < 600 || cardBox.height < 90) {
        throw new Error(`Automation card layout is too compressed: ${JSON.stringify(cardBox)}`);
      }

      const flowBox = await taskCard.locator(".task-card-flow").boundingBox();
      if (!flowBox || flowBox.height > 90) throw new Error(`Automation flow is too tall or missing: ${JSON.stringify(flowBox)}`);
      const pillText = await taskCard.locator(".run-pill").first().innerText();
      if (!pillText.trim()) throw new Error("Run status pill is empty");

      await taskCard.locator(".task-card-main").click();
      await taskCard.locator(".task-detail-meta").waitFor({ state: "visible", timeout: 5000 });
      const detailItems = await taskCard.locator(".task-detail-meta span").count();
      if (detailItems < 4) throw new Error(`Expected task detail metadata, got ${detailItems}`);

      await taskCard.locator(".task-actions button").nth(2).click();
      await taskCard.locator(".run-history").waitFor({ state: "visible", timeout: 10000 });
      const runRow = taskCard.locator(".run-row").first();
      await runRow.waitFor({ state: "visible", timeout: 10000 });
      const runBox = await runRow.boundingBox();
      if (!runBox || runBox.width < 560 || runBox.height < 42) throw new Error(`Run row layout is too compressed: ${JSON.stringify(runBox)}`);
      const summary = await runRow.locator("p").first().innerText();
      if (summary.trim().length < 8) throw new Error(`Run summary is not readable: ${summary}`);
      await runRow.locator(".run-overview").waitFor({ state: "visible", timeout: 5000 });
      const overviewCount = await runRow.locator(".run-overview div").count();
      if (overviewCount < 2) throw new Error(`Run overview should show readable key facts, got ${overviewCount}`);
      const technicalVisibleBefore = await runRow.locator(".run-technical-detail:visible").count();
      if (technicalVisibleBefore !== 0) throw new Error("Technical JSON detail should be collapsed by default");
      await runRow.getByRole("button", { name: "기술 상세" }).click();
      await runRow.locator(".run-technical-detail").waitFor({ state: "visible", timeout: 5000 });
      const jsonText = await runRow.locator(".run-json").innerText();
      if (!jsonText.includes("targets")) throw new Error("Expanded technical detail does not expose run JSON");

      console.log(JSON.stringify({
        ok: true,
        appUrl,
        taskId,
        checked: [
          "fixture_automation_created",
          "fixture_automation_run_created",
          "task_card_visible",
          "task_flow_readable",
          "status_pill_visible",
          "detail_metadata_visible",
          "run_history_visible",
          "run_row_readable",
          "run_overview_key_facts_visible",
          "technical_detail_collapsed_by_default",
          "technical_detail_expands_json",
        ],
        cardBox,
        runBox,
      }, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    if (taskId) {
      await apiJson(`/api/automations/${taskId}`, token, { method: "DELETE" }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
