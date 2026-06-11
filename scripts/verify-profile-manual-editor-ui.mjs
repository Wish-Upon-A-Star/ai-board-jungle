import { chromium } from "playwright";

const publicUrl = (process.env.AI_BOARD_TEST_PUBLIC_URL || "https://railway-mediterranean-snap-populations.trycloudflare.com").replace(/\/$/, "");

async function loginToken() {
  const response = await fetch(`${publicUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-board-public-origin": publicUrl },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`login failed: ${response.status} ${JSON.stringify(data)}`);
  return data.token;
}

async function openApp(page, token) {
  await page.goto(publicUrl, { waitUntil: "networkidle" });
  await page.evaluate((value) => localStorage.setItem("ai-board-token", value), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".site-header nav button").nth(1).click();
  await page.locator(".oauth-diagnostics").waitFor({ state: "visible", timeout: 15000 });
}

async function main() {
  const token = await loginToken();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await openApp(page, token);

    const editor = page.locator(".manual-profile-editor");
    const form = page.locator("#profile-manual-form");
    await editor.waitFor({ state: "visible", timeout: 15000 });
    if (await form.isVisible()) throw new Error("manual profile form should be collapsed by default");

    await page.locator(".ai-key-actions button").first().click();
    await form.waitFor({ state: "visible", timeout: 15000 });
    const openAfterAiKey = await editor.evaluate((node) => node.open);
    if (!openAfterAiKey) throw new Error("AI key action did not open the manual profile editor");
    const aiSource = await form.locator("select").first().inputValue();
    if (aiSource !== "custom") throw new Error(`AI key action should select custom source, got ${aiSource}`);

    await openApp(page, token);
    if (await form.isVisible()) throw new Error("manual profile form should collapse again on a fresh load");

    await page.locator(".mcp-setup-actions button").nth(6).click();
    await form.waitFor({ state: "visible", timeout: 15000 });
    const openAfterFigma = await editor.evaluate((node) => node.open);
    if (!openAfterFigma) throw new Error("manual Figma action did not open the manual profile editor");
    const figmaSource = await form.locator("select").first().inputValue();
    if (figmaSource !== "figma") throw new Error(`manual Figma action should select figma source, got ${figmaSource}`);

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "profile_tab_loaded",
        "manual_editor_collapsed_by_default",
        "ai_key_action_opens_manual_editor",
        "ai_key_action_prefills_custom_profile",
        "manual_figma_action_opens_manual_editor",
        "manual_figma_action_prefills_figma_profile",
      ],
      publicUrl,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
