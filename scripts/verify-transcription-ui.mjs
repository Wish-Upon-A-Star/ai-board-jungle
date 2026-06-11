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
  const profileResponse = await apiJson("/api/integration-profiles", {
    method: "POST",
    headers: { Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({
      name: `OpenAI 전사 검증 ${Date.now()}`,
      source_kind: "custom",
      base_url: "https://api.openai.com/v1",
      api_provider: "OpenAI API",
      token_name: "OPENAI_API_KEY",
      token_value: `sk-test-transcribe-${Date.now()}`,
      auth_type: "api_key",
      ai_provider: "OpenAI",
      ai_model: "gpt-4o-mini",
      ai_api_base: "https://api.openai.com/v1",
      rag_targets: ["ai", "audio"],
    }),
  });
  const profile = profileResponse.profile;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  let transcribeCalls = 0;
  let transcribePayload = "";
  try {
    await page.route("**/api/ai/transcribe", async (route) => {
      transcribeCalls += 1;
      const request = route.request();
      if (request.method() !== "POST") {
        throw new Error(`Unexpected transcription method: ${request.method()}`);
      }
      transcribePayload = (await request.postDataBuffer()).toString("utf8");
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          text: "가짜 OpenAI 전사 결과입니다. 회의 내용을 지식자료로 저장합니다.",
          fileName: "meeting.wav",
          mimeType: "audio/wav",
          model: "gpt-4o-mini-transcribe",
          parts: 1,
          integrationProfileId: profile.id,
          integrationProfileName: profile.name,
          source: {
            id: 999001,
            title: "meeting",
            sourceType: "audio",
            fileName: "meeting.wav",
            mimeType: "audio/wav",
            instruction: "한국어 회의 음성을 업무 지시와 결정사항 중심으로 전사",
            extractedText: "가짜 OpenAI 전사 결과입니다. 회의 내용을 지식자료로 저장합니다.",
            tags: ["audio", "transcription", "openai"],
            createdAt: new Date().toISOString(),
          },
          rag: {
            answer: "전사 결과를 지식자료로 저장했습니다.",
            sources: ["meeting"],
          },
        }),
      });
    });

    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.evaluate((token) => localStorage.setItem("ai-board-token", token), login.token);
    await page.reload({ waitUntil: "networkidle" });

    await page.locator("button").filter({ hasText: "지식자료" }).first().click();
    await page.locator("#knowledge-panel").waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".transcription-settings select").first().selectOption(String(profile.id));
    await page.locator(".transcription-settings select").nth(1).selectOption("gpt-4o-mini-transcribe");
    await page.locator(".transcription-settings input").first().fill("한국어 회의 음성을 업무 지시와 결정사항 중심으로 전사");
    await page.getByText("전사 후 지식자료에 바로 저장").click();
    await page.locator('#knowledge-panel input[type="file"][accept*="audio"]').setInputFiles({
      name: "meeting.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("RIFF0000WAVEfmt "),
    });

    await page.getByText("지식자료로 바로 저장했습니다", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
    const titleValue = await page.locator("#knowledge-panel input").first().inputValue();
    const bodyValue = await page.locator("#knowledge-panel textarea").nth(1).inputValue();
    const sourceType = await page.locator("#knowledge-panel select").first().inputValue();
    if (transcribeCalls !== 1) throw new Error(`Expected one transcription call, got ${transcribeCalls}`);
    if (!transcribePayload.includes("gpt-4o-mini-transcribe")) throw new Error("Selected transcription model was not submitted");
    if (!transcribePayload.includes(String(profile.id))) throw new Error("Selected OpenAI profile id was not submitted");
    if (!transcribePayload.includes("한국어")) throw new Error("Transcription prompt was not submitted");
    if (!transcribePayload.includes("save_to_knowledge")) throw new Error("Immediate knowledge-save option was not submitted");
    if (titleValue !== "meeting") throw new Error(`Expected title to become meeting, got ${titleValue}`);
    if (sourceType !== "audio") throw new Error(`Expected source_type audio, got ${sourceType}`);
    if (!bodyValue.includes("가짜 OpenAI 전사 결과")) throw new Error(`Transcript did not fill knowledge body: ${bodyValue}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          checked: [
            "login",
            "openai_profile_select",
            "transcription_model_select",
            "prompt_submit",
            "knowledge_tab",
            "immediate_knowledge_save_checked",
            "fake_transcription_route",
            "title_autofill",
            "source_type_audio",
            "transcript_body_fill",
          ],
          appUrl,
          apiBase,
          transcribeCalls,
          profileId: profile.id,
          modelSubmitted: transcribePayload.includes("gpt-4o-mini-transcribe"),
          saveToKnowledgeSubmitted: transcribePayload.includes("save_to_knowledge"),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await fetch(`${apiBase}/api/integration-profiles/${profile.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${login.token}` },
    }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
