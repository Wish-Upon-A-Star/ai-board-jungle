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
    await page.locator("button").filter({ hasText: "프로필" }).first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator("button").filter({ hasText: "프로필" }).first().click();
    const oauthRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.hostname === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth";
    }, { timeout: 15000 });
    await page.locator("button").filter({ hasText: "Google Calendar MCP 로그인" }).first().click();
    const currentUrl = (await oauthRequest).url();
    const parsed = new URL(currentUrl);
    const clientId = parsed.searchParams.get("client_id") || "";
    const redirectUri = parsed.searchParams.get("redirect_uri") || "";
    if (clientId.includes(":")) {
      throw new Error("Google client_id contains a label separator");
    }
    if (redirectUri !== `${publicUrl}/api/oauth/google_calendar/callback`) {
      throw new Error(`Unexpected Google redirect_uri from UI click: ${redirectUri}`);
    }
    if (parsed.searchParams.get("access_type") !== "offline") {
      throw new Error("Google OAuth request must ask for offline access");
    }
    if (parsed.searchParams.get("prompt") !== "consent") {
      throw new Error("Google OAuth request must force consent to receive refresh tokens");
    }
    if (!parsed.searchParams.get("scope")?.includes("https://www.googleapis.com/auth/calendar.events")) {
      throw new Error("Google OAuth request is missing calendar.events scope");
    }
    console.log(JSON.stringify({
      ok: true,
      checked: [
        "public_app_login",
        "account_connections_tab",
        "google_calendar_mcp_button_click",
        "google_oauth_navigation",
        "client_id_sanitized",
        "redirect_uri_matches_public_origin",
        "offline_access_requested",
        "calendar_events_scope_requested",
      ],
      publicUrl,
      redirectUri,
      clientIdMasked: `${clientId.slice(0, 4)}...${clientId.slice(-8)}`,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
