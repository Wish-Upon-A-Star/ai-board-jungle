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

async function main() {
  const token = await loginToken();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await page.goto(publicUrl, { waitUntil: "networkidle" });
    await page.evaluate((value) => localStorage.setItem("ai-board-token", value), token);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".site-header nav button").nth(1).click();
    await page.locator(".profile-section-tabs button").nth(2).click();
    const panel = page.locator(".oauth-diagnostics");
    await panel.waitFor({ state: "visible", timeout: 15000 });
    await panel.locator(".oauth-diagnostic-row").first().waitFor({ state: "visible", timeout: 15000 });
    const callbacks = await panel.locator("input").evaluateAll((inputs) => inputs.map((input) => input.value));
    const expected = [
      `${publicUrl}/api/oauth/github/callback`,
      `${publicUrl}/api/oauth/notion/callback`,
      `${publicUrl}/api/oauth/figma/callback`,
      `${publicUrl}/api/oauth/google_calendar/callback`,
    ];
    for (const callback of expected) {
      if (!callbacks.includes(callback)) throw new Error(`missing callback in diagnostics: ${callback}`);
    }
    const text = await panel.innerText();
    for (const label of ["GitHub", "Notion", "Figma", "Google Calendar"]) {
      if (!text.includes(label)) throw new Error(`missing diagnostics label: ${label}`);
    }
    if (!text.includes("file_comments:write")) throw new Error("Figma scope is not visible in diagnostics");
    if (!text.includes("calendar.events")) throw new Error("Google Calendar scope is not visible in diagnostics");
    if (!text.includes("redirect_uri_mismatch")) throw new Error("diagnostics must mention Google-style redirect_uri_mismatch");
    for (const target of [
      "GitHub OAuth App의 Authorization callback URL",
      "Notion OAuth Integration의 Redirect URI",
      "Figma OAuth App의 Redirect URI",
      "Google Cloud OAuth Client의 Authorized redirect URI",
    ]) {
      if (!text.includes(target)) throw new Error(`missing provider callback target: ${target}`);
    }
    const setupLinks = await panel.locator("a[target='_blank']").count();
    if (setupLinks < 4) throw new Error(`expected at least four provider setup links, got ${setupLinks}`);
    const checklist = panel.locator(".public-access-checklist");
    await checklist.waitFor({ state: "visible", timeout: 15000 });
    const publicOriginValue = await checklist.locator(".current-public-origin-input").inputValue();
    if (publicOriginValue !== publicUrl) throw new Error(`public access origin mismatch: ${publicOriginValue}`);
    const checklistText = await checklist.innerText();
    if (!checklistText.includes("임시 터널 주소 사용 중")) throw new Error("temporary tunnel warning must be visible");
    if (!checklistText.includes("AI_BOARD_PUBLIC_BASE_URL")) throw new Error("stable domain next action must mention AI_BOARD_PUBLIC_BASE_URL");
    if (!checklistText.includes("고정 도메인 전환 순서")) throw new Error("stable domain guide must be visible");
    if (!checklistText.includes("Cloudflare named tunnel")) throw new Error("stable domain guide must mention Cloudflare named tunnel");
    const previewCallbacks = await checklist.locator(".callback-preview-grid input").evaluateAll((inputs) => inputs.map((input) => input.value));
    for (const callback of expected) {
      if (!previewCallbacks.includes(callback)) throw new Error(`missing callback in stable domain preview: ${callback}`);
    }
    const checklistItems = await checklist.locator(":scope > ol > li").evaluateAll((items) => items.map((item) => item.innerText));
    if (checklistItems.length !== 4) throw new Error(`expected four public access checklist items, got ${checklistItems.length}`);
    if (!checklistItems.join(" ").includes("Callback URL")) throw new Error("checklist must mention Callback URL registration");
    console.log(JSON.stringify({
      ok: true,
      checked: [
        "profile_tab",
        "oauth_diagnostics_panel",
        "github_callback_visible",
        "notion_callback_visible",
        "figma_callback_visible",
        "google_calendar_callback_visible",
        "provider_setup_links_visible",
        "scopes_visible",
        "public_access_origin_visible",
        "public_access_checklist_visible",
        "stable_domain_guide_visible",
        "stable_domain_callback_preview_visible",
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
