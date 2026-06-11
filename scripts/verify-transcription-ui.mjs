import { chromium } from "playwright";

const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";

async function apiJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const login = await apiJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  let transcribeCalls = 0;
  try {
    await page.route("**/api/ai/transcribe", async (route) => {
      transcribeCalls += 1;
      const request = route.request();
      if (request.method() !== "POST") {
        throw new Error(`Unexpected transcription method: ${request.method()}`);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          text: "가짜 OpenAI 전사 결과입니다. 회의 내용을 지식자료로 저장합니다.",
          fileName: "meeting.wav",
          mimeType: "audio/wav",
          model: "whisper-1",
          parts: 1,
        }),
      });
    });

    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.evaluate((token) => localStorage.setItem("ai-board-token", token), login.token);
    await page.reload({ waitUntil: "networkidle" });

    await page.locator("button").filter({ hasText: "지식자료" }).first().click();
    await page.locator("#knowledge-panel").waitFor({ state: "visible", timeout: 10000 });
    await page.locator('#knowledge-panel input[type="file"][accept*="audio"]').setInputFiles({
      name: "meeting.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("RIFF0000WAVEfmt "),
    });

    await page.getByText("전사 완료", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
    const titleValue = await page.locator("#knowledge-panel input").first().inputValue();
    const bodyValue = await page.locator("#knowledge-panel textarea").nth(1).inputValue();
    const sourceType = await page.locator("#knowledge-panel select").first().inputValue();
    if (transcribeCalls !== 1) throw new Error(`Expected one transcription call, got ${transcribeCalls}`);
    if (titleValue !== "meeting") throw new Error(`Expected title to become meeting, got ${titleValue}`);
    if (sourceType !== "audio") throw new Error(`Expected source_type audio, got ${sourceType}`);
    if (!bodyValue.includes("가짜 OpenAI 전사 결과")) throw new Error(`Transcript did not fill knowledge body: ${bodyValue}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          checked: ["login", "knowledge_tab", "fake_transcription_route", "title_autofill", "source_type_audio", "transcript_body_fill"],
          appUrl,
          apiBase,
          transcribeCalls,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
