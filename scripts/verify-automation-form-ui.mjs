import { chromium } from "playwright";

const appUrl = (process.env.AI_BOARD_TEST_PUBLIC_URL || "https://railway-mediterranean-snap-populations.trycloudflare.com").replace(/\/$/, "");

async function loginToken() {
  const response = await fetch(`${appUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-board-public-origin": appUrl },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`login failed: ${response.status} ${JSON.stringify(data)}`);
  return data.token;
}

async function main() {
  const token = await loginToken();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 950 } });
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.evaluate((value) => localStorage.setItem("ai-board-token", value), token);
    await page.reload({ waitUntil: "networkidle" });

    await page.locator("nav button").nth(0).click();
    const form = page.locator(".automation-form");
    await form.waitFor({ state: "visible", timeout: 15000 });

    const cards = form.locator(".preset-card");
    const cardCount = await cards.count();
    if (cardCount < 6) throw new Error(`Expected at least 6 preset cards, got ${cardCount}`);
    const firstCardBox = await cards.first().boundingBox();
    if (!firstCardBox || firstCardBox.width < 150 || firstCardBox.height < 70) {
      throw new Error(`Preset card is too small: ${JSON.stringify(firstCardBox)}`);
    }

    const advanced = form.locator(".advanced-section");
    if (await advanced.evaluate((node) => node.hasAttribute("open"))) {
      throw new Error("Advanced automation settings should be collapsed by default");
    }
    const visibleAdvancedInputsBefore = await advanced.locator("input:visible, textarea:visible").count();
    if (visibleAdvancedInputsBefore !== 0) throw new Error(`Advanced fields are visible before opening details: ${visibleAdvancedInputsBefore}`);

    const basicSection = form.locator("> .form-section").nth(1);
    const basicInputCount =
      (await basicSection.locator(":scope > .grid2 input:visible").count()) +
      (await basicSection.locator(".integration-profile-box select:visible").count());
    if (basicInputCount !== 3) throw new Error(`Basic automation section should show only profile/name/interval controls, got ${basicInputCount}`);
    const routePreview = form.locator(".automation-route-preview");
    await routePreview.waitFor({ state: "visible", timeout: 10000 });
    const routePreviewText = await routePreview.innerText();
    if (!routePreviewText.includes("읽기") || !routePreviewText.includes("쓰기")) {
      throw new Error(`Route preview is not readable: ${routePreviewText}`);
    }
    const routeDetails = form.locator(".route-edit-details");
    if (await routeDetails.evaluate((node) => node.open)) {
      throw new Error("Route edit details should be collapsed by default");
    }
    const visibleRouteInputsBefore = await routeDetails.locator("input:visible").count();
    if (visibleRouteInputsBefore !== 0) throw new Error(`Route edit fields are visible before opening details: ${visibleRouteInputsBefore}`);

    await cards.nth(3).click();
    const nameValue = await form.locator("input").first().inputValue();
    if (!nameValue.includes("Figma") && !nameValue.includes("Calendar")) {
      throw new Error(`Preset did not populate automation name: ${nameValue}`);
    }
    const populatedRouteText = await routePreview.innerText();
    if (!populatedRouteText.includes("Figma") || !populatedRouteText.includes("Calendar")) {
      throw new Error(`Preset did not update route preview: ${populatedRouteText}`);
    }

    await advanced.locator("summary").click();
    const visibleAdvancedInputs = await advanced.locator("input, textarea").count();
    if (visibleAdvancedInputs < 8) throw new Error(`Advanced settings did not expose expected fields: ${visibleAdvancedInputs}`);

    console.log(JSON.stringify({
      ok: true,
      appUrl,
      checked: [
        "automation_tab_visible",
        "preset_cards_sized",
        "advanced_collapsed_by_default",
        "basic_controls_reduced_to_profile_name_interval",
        "route_preview_visible",
        "route_edit_collapsed_by_default",
        "processing_method_moved_to_advanced",
        "preset_populates_form",
        "advanced_fields_open",
      ],
      cardCount,
      firstCardBox,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
