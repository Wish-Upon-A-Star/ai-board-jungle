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
    await page.locator("button").filter({ hasText: "프로필" }).first().click();
    const panel = page.locator(".oauth-diagnostics");
    await panel.getByText("OAuth callback 진단").waitFor({ state: "visible", timeout: 15000 });
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
    for (const label of ["GitHub", "Notion", "Figma", "Google Calendar", "개발자 설정 열기"]) {
      if (!text.includes(label)) throw new Error(`missing diagnostics label: ${label}`);
    }
    if (!text.includes("file_comments:write")) throw new Error("Figma scope is not visible in diagnostics");
    if (!text.includes("calendar.events")) throw new Error("Google Calendar scope is not visible in diagnostics");
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
