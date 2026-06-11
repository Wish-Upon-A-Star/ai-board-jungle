import { chromium } from "playwright";

const publicUrl = (process.env.AI_BOARD_TEST_PUBLIC_URL || "https://railway-mediterranean-snap-populations.trycloudflare.com").replace(/\/$/, "");
const targetPublicBaseUrl = (process.env.AI_BOARD_TEST_SYSTEM_PUBLIC_URL || publicUrl).replace(/\/$/, "");

async function api(path, token, options = {}) {
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
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function loginToken() {
  const data = await api("/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
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

    await page.locator('button[aria-controls="settings-panel"]').click();
    const form = page.locator(".system-settings-form");
    await form.waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".public-url-state").waitFor({ state: "visible", timeout: 15000 });
    await form.locator("input").fill("https://mismatch.example.test");
    await page.locator(".public-url-state.warn").waitFor({ state: "visible", timeout: 15000 });
    await form.locator("button", { hasText: "현재 주소로 채우기" }).click();
    const filledCurrentOrigin = await form.locator("input").inputValue();
    if (filledCurrentOrigin !== publicUrl) {
      throw new Error(`current-origin fill button failed. expected=${publicUrl} actual=${filledCurrentOrigin}`);
    }
    await form.locator("input").fill(targetPublicBaseUrl);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/system/settings") && response.request().method() === "PUT"),
      form.locator("button").filter({ hasText: "외부 도메인 저장" }).click(),
    ]);
    await page.locator(".system-settings-card .form-status.ok").waitFor({ state: "visible", timeout: 15000 });

    const status = await api("/api/oauth/status", token);
    const figma = status.providers.find((provider) => provider.provider === "figma");
    const expectedCallback = `${targetPublicBaseUrl}/api/oauth/figma/callback`;
    if (!figma) throw new Error("Figma OAuth provider is missing from status response");
    if (figma.redirectUri !== expectedCallback) {
      throw new Error(`Figma redirectUri mismatch after admin setting. expected=${expectedCallback} actual=${figma.redirectUri}`);
    }
    if (status.publicOrigin.origin !== targetPublicBaseUrl) {
      throw new Error(`publicOrigin did not use admin setting. expected=${targetPublicBaseUrl} actual=${status.publicOrigin.origin}`);
    }

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "admin_login",
        "settings_tab_visible",
        "public_url_state_visible",
        "public_url_mismatch_warning",
        "fill_current_origin_button",
        "public_base_url_saved_from_ui",
        "oauth_status_uses_saved_origin",
        "figma_redirect_uri_uses_saved_origin",
      ],
      publicUrl,
      targetPublicBaseUrl,
      figmaRedirectUri: figma.redirectUri,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
