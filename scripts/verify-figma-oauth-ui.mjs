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
      return url.hostname === "www.figma.com" && url.pathname === "/oauth";
    }, { timeout: 15000 });
    await page.locator("button").filter({ hasText: "Figma MCP 로그인" }).first().click();
    const currentUrl = (await oauthRequest).url();
    const parsed = new URL(currentUrl);
    const clientId = parsed.searchParams.get("client_id") || "";
    const redirectUri = parsed.searchParams.get("redirect_uri") || "";
    if (parsed.hostname !== "www.figma.com" || parsed.pathname !== "/oauth") {
      throw new Error(`Unexpected Figma OAuth destination: ${currentUrl}`);
    }
    if (clientId.includes(":")) {
      throw new Error("Figma client_id contains a label separator");
    }
    if (redirectUri !== `${publicUrl}/api/oauth/figma/callback`) {
      throw new Error(`Unexpected redirect_uri from UI click: ${redirectUri}`);
    }
    console.log(JSON.stringify({
      ok: true,
      checked: [
        "public_app_login",
        "account_connections_tab",
        "figma_mcp_button_click",
        "figma_oauth_navigation",
        "client_id_sanitized",
        "redirect_uri_matches_public_origin",
      ],
      publicUrl,
      redirectUri,
      clientIdMasked: `${clientId.slice(0, 4)}...${clientId.slice(-4)}`,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
