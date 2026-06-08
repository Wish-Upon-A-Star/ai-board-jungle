import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const appUrl = process.env.AI_BOARD_PLAYTEST_URL || "http://127.0.0.1:3151";
const artifactDir = "output/playwright";
mkdirSync(artifactDir, { recursive: true });

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function clickVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 10000 });
  await locator.click();
}

async function fillSelector(page, selector, value) {
  const field = page.locator(selector).first();
  await field.waitFor({ state: "visible", timeout: 10000 });
  await field.fill(value);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const findings = [];
  const email = `playtest-${Date.now()}@example.com`;

  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${artifactDir}/playtest-start-${stamp()}.png`, fullPage: true });

    await clickVisible(page.locator(".auth-tabs button").nth(1));
    await fillSelector(page, "input[placeholder='email']", email);
    await fillSelector(page, "input[placeholder='name']", "Playtest User");
    await fillSelector(page, "input[placeholder='password']", "password123");
    await clickVisible(page.locator(".auth-form button").first());
    await page.locator(".automation-form").waitFor({ state: "visible", timeout: 15000 });

    await clickVisible(page.locator(".automation-form .preset-actions button").nth(0));
    await clickVisible(page.getByRole("button", { name: "Defaults" }).first());
    await clickVisible(page.locator("#profile-settings form button").last());
    await page.waitForTimeout(500);

    await clickVisible(page.getByRole("button", { name: "MCP / Profiles" }).first());
    await clickVisible(page.locator("#integration-profiles form button").last());
    await page.locator("#integration-profiles .knowledge-item").first().waitFor({ state: "visible", timeout: 15000 });

    await clickVisible(page.getByRole("button", { name: "Automation" }).first());
    await clickVisible(page.locator(".automation-form button").last());
    await page.locator(".task-card").first().waitFor({ state: "visible", timeout: 15000 });
    await page.screenshot({ path: `${artifactDir}/playtest-after-create-${stamp()}.png`, fullPage: true });

    await clickVisible(page.locator(".task-card .task-actions button").nth(0));
    await page.waitForTimeout(500);
    await clickVisible(page.locator(".task-card .task-actions button").filter({ hasText: "Run history" }).first());
    await clickVisible(page.locator(".task-card .task-actions button").filter({ hasText: "Share" }).first());
    await clickVisible(page.locator(".scheduler-bar button").first());

    await clickVisible(page.getByRole("button", { name: "MCP / Profiles" }).first());
    await clickVisible(page.locator("#integration-profiles .knowledge-item button").first());
    const dryRun = page.getByRole("button", { name: /Dry-run write/ }).first();
    if (await dryRun.isVisible().catch(() => false)) await dryRun.click();
    await clickVisible(page.getByRole("button", { name: /Real-write audit/ }).first());
    await clickVisible(page.getByRole("button", { name: /Reset filters/ }).first());
    await clickVisible(page.getByRole("button", { name: "API" }).first());
    await clickVisible(page.locator(".api-buttons").getByRole("button", { name: /Health/ }).first());
    await clickVisible(page.locator(".api-buttons").getByRole("button", { name: /^RAG$/ }).first());
    await clickVisible(page.locator(".api-buttons").getByRole("button", { name: /MCP/ }).first());
    await clickVisible(page.locator(".api-buttons").getByRole("button", { name: /Agent Hub/ }).first());

    await clickVisible(page.getByRole("button", { name: "Automation" }).first());
    await clickVisible(page.locator(".task-card .task-actions button.danger").first());
    await clickVisible(page.locator(".task-card .task-actions button.confirm-delete").first());
    await page.screenshot({ path: `${artifactDir}/playtest-final-${stamp()}.png`, fullPage: true });

    const topError = await page.locator(".top-error, .error").allTextContents();
    for (const message of topError) {
      if (message.trim()) findings.push(message.trim());
    }

    console.log(JSON.stringify({
      ok: findings.length === 0,
      appUrl,
      email,
      checked: [
        "register",
        "save default profile settings",
        "save integration profile",
        "create automation",
        "run automation",
        "run history",
        "share automation",
        "scheduler tick",
        "collect integration RAG",
        "dry-run write",
        "activity filters",
        "API console health/RAG/MCP/Agent Hub",
        "delete automation",
      ],
      findings,
    }, null, 2));
    if (findings.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
