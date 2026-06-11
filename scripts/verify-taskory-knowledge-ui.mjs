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
  const title = `Taskory UI 검증 ${Date.now()}`;
  const create = await apiJson("/api/knowledge", {
    method: "POST",
    headers: { Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({
      title,
      source_type: "taskory",
      instruction: "Taskory 작업을 AI Board 자동화 RAG 근거로 사용합니다.",
      extracted_text: "GitHub 변경사항 요약\nNotion 보고서 반영\n최근 커밋과 이슈를 한국어로 정리합니다.",
      tags: ["taskory", "myqueue", "automation"],
    }),
  });
  const sourceId = create.source.id;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.evaluate((token) => localStorage.setItem("ai-board-token", token), login.token);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("button").filter({ hasText: "지식자료" }).first().click();
    await page.locator("#knowledge-panel").waitFor({ state: "visible", timeout: 10000 });

    await page.getByText("Taskory / myqueue").waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("작업 자료가 연결됨", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("taskory 또는 자료명").waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("sync_taskory_to_ai_board.py --watch", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".rag-source-card").filter({ hasText: title }).first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("#taskory").waitFor({ state: "visible", timeout: 10000 });

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "login",
        "temporary_taskory_knowledge_created",
        "knowledge_tab_opened",
        "taskory_status_card_visible",
        "taskory_rag_target_visible",
        "taskory_sync_command_visible",
        "taskory_source_card_visible",
      ],
      appUrl,
      apiBase,
      sourceId,
      title,
    }, null, 2));
  } finally {
    await browser.close();
    await fetch(`${apiBase}/api/knowledge/${sourceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${login.token}` },
    }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
