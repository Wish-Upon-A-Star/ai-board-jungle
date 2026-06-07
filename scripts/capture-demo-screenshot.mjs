import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const port = process.env.CDP_PORT || "9223";
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";
const outputPath = process.env.SCREENSHOT_PATH || "docs/demo-screenshot.png";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    timeout.unref?.();
  });
  try {
    return await Promise.race([fetch(url, options), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve) => {
    ws.onopen = resolve;
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve) => {
        const requestId = ++id;
        pending.set(requestId, resolve);
        ws.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const [health, app, versionResponse] = await Promise.all([
    fetchWithTimeout(`${apiBase}/api/health`, {}, 5000),
    fetchWithTimeout(appUrl, {}, 5000),
    fetchWithTimeout(`http://127.0.0.1:${port}/json/version`, {}, 5000),
  ]);
  if (!health.ok) throw new Error(`FastAPI health failed: ${health.status}`);
  if (!app.ok) throw new Error(`React app failed: ${app.status}`);
  if (!versionResponse.ok) throw new Error(`CDP version failed: ${versionResponse.status}`);

  const login = await fetchWithTimeout(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  const { token } = await login.json();

  const version = await versionResponse.json();
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.call("Target.createTarget", { url: appUrl });
  await wait(1200);

  const targets = await (await fetchWithTimeout(`http://127.0.0.1:${port}/json/list`)).json();
  const appHost = new URL(appUrl).host;
  const target = targets.find((item) => item.url.includes(appHost));
  if (!target) throw new Error("UI target was not created");

  const page = await connect(target.webSocketDebuggerUrl);
  await page.call("Runtime.enable");
  await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.call("Runtime.evaluate", {
    expression: `localStorage.setItem("ai-board-token", ${JSON.stringify(token)}); location.href = ${JSON.stringify(appUrl)};`,
    awaitPromise: true,
  });
  await wait(3500);
  await page.call("Runtime.evaluate", {
    expression: `document.querySelector("#profile-settings")?.scrollIntoView({ block: "start" });`,
    awaitPromise: true,
  });
  await wait(800);

  const screenshotReadiness = await page.call("Runtime.evaluate", {
    expression: `(() => {
      const section = document.querySelector("#profile-settings");
      const text = document.body.innerText;
      const requiredText = [
        "사용자 기본 자동화 설정",
        "사용자 기본 커스텀 연결",
        "AI 제공자",
        "AI 모델",
        "GitHub",
        "Notion"
      ];
      return {
        sectionVisible: Boolean(section),
        sectionTop: section ? Math.round(section.getBoundingClientRect().top) : null,
        requiredText,
        missingText: requiredText.filter((item) => !text.includes(item)),
        hasSecretLeak: /ghp_|github_pat_|secret_[a-z0-9]|ntn_[a-z0-9]/i.test(text)
      };
    })();`,
    returnByValue: true,
  });
  const readiness = screenshotReadiness.result?.result?.value;
  if (!readiness?.sectionVisible || readiness.missingText?.length || readiness.hasSecretLeak) {
    throw new Error(`screenshot content check failed: ${JSON.stringify(readiness)}`);
  }

  const screenshot = await page.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, Buffer.from(screenshot.result.data, "base64"));
  console.log(JSON.stringify({ ok: true, outputPath }, null, 2));

  page.close();
  browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
