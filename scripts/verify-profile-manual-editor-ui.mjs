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
  await page.locator(".profile-section-tabs").waitFor({ state: "visible", timeout: 15000 });
}

async function main() {
  const token = await loginToken();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await openApp(page, token);

    const connectionTiles = page.locator(".conn-status-tile");
    await connectionTiles.first().waitFor({ state: "visible", timeout: 15000 });
    const tileCount = await connectionTiles.count();
    if (tileCount !== 5) throw new Error(`expected 5 connection status tiles, got ${tileCount}`);
    const firstTileBox = await connectionTiles.first().boundingBox();
    if (!firstTileBox || firstTileBox.width < 100 || firstTileBox.height < 70) {
      throw new Error(`connection status tile is not rendered as a readable card: ${JSON.stringify(firstTileBox)}`);
    }

    const sectionTabs = page.locator(".profile-section-tabs button");
    await sectionTabs.first().waitFor({ state: "visible", timeout: 15000 });
    const tabCount = await sectionTabs.count();
    if (tabCount !== 3) throw new Error(`expected 3 profile section tabs, got ${tabCount}`);
    const connectSelected = await sectionTabs.nth(0).getAttribute("aria-selected");
    if (connectSelected !== "true") throw new Error("connect section should be selected by default");

    const choicePanel = page.locator(".connection-choice-panel");
    await choicePanel.waitFor({ state: "visible", timeout: 15000 });
    const choiceCards = choicePanel.locator("article");
    const choiceCount = await choiceCards.count();
    if (choiceCount !== 3) throw new Error(`expected 3 connection choice cards, got ${choiceCount}`);
    const aiChoiceText = await choiceCards.nth(1).innerText();
    if (!aiChoiceText.includes("AI API") || !aiChoiceText.includes("DB")) {
      throw new Error(`AI API key choice card is not explicit enough: ${aiChoiceText}`);
    }
    const choicePanelBox = await choicePanel.boundingBox();
    if (!choicePanelBox || choicePanelBox.width < 600 || choicePanelBox.height < 150) {
      throw new Error(`connection choice panel is too compressed: ${JSON.stringify(choicePanelBox)}`);
    }

    const editor = page.locator(".manual-profile-editor");
    const form = page.locator("#profile-manual-form");
    await editor.waitFor({ state: "visible", timeout: 15000 });
    if (await form.isVisible()) throw new Error("manual profile form should be collapsed by default");

    await choiceCards.nth(1).locator("button").first().click();
    await form.waitFor({ state: "visible", timeout: 15000 });
    const openAfterAiKey = await editor.evaluate((node) => node.open);
    if (!openAfterAiKey) throw new Error("AI key action did not open the manual profile editor");
    const simpleNoteText = await form.locator(".manual-profile-simple-note").innerText();
    if (!simpleNoteText.includes("기본 입력") || !simpleNoteText.includes("고급 설정")) {
      throw new Error(`manual profile simple note is not clear: ${simpleNoteText}`);
    }
    const advancedPanel = form.locator(".manual-profile-advanced");
    const advancedOpen = await advancedPanel.evaluate((node) => node.open);
    if (advancedOpen) throw new Error("manual profile advanced settings should be collapsed by default");
    const visibleBasicFields = await form.locator(":scope > .grid3.wide .field").count();
    if (visibleBasicFields !== 6) throw new Error(`expected 6 immediately visible basic fields, got ${visibleBasicFields}`);
    const aiSource = await form.locator("select").first().inputValue();
    if (aiSource !== "custom") throw new Error(`AI key action should select custom source, got ${aiSource}`);

    await sectionTabs.nth(2).click();
    await page.locator(".oauth-diagnostics").waitFor({ state: "visible", timeout: 15000 });
    if (await page.locator(".ai-key-guide").isVisible()) throw new Error("AI key guide should not be visible in diagnostics section");
    const callbackValues = await page.locator(".oauth-diagnostics input").evaluateAll((inputs) => inputs.map((input) => input.value));
    if (!callbackValues.some((value) => value.includes("/api/oauth/figma/callback"))) {
      throw new Error("diagnostics section must show the Figma callback URL");
    }

    await sectionTabs.nth(1).click();
    await page.locator(".knowledge-list").waitFor({ state: "visible", timeout: 15000 });
    if (await page.locator(".oauth-diagnostics").isVisible()) throw new Error("OAuth diagnostics should not be visible in saved profiles section");

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
        "connection_status_cards_visible",
        "profile_section_tabs_visible",
        "connect_section_selected_by_default",
        "connection_choice_panel_visible",
        "ai_api_key_choice_card_explicit",
        "manual_editor_collapsed_by_default",
        "ai_key_action_opens_manual_editor",
        "manual_profile_simple_note_visible",
        "manual_profile_advanced_collapsed",
        "manual_profile_basic_fields_limited",
        "ai_key_action_prefills_custom_profile",
        "diagnostics_section_isolated",
        "saved_profiles_section_isolated",
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
