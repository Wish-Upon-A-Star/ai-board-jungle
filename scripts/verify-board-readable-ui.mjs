import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";

async function apiJson(path, options = {}, token = "") {
  const headers = { "content-type": "application/json; charset=utf-8", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function createFixtures(token) {
  const suffix = Date.now();
  const post = await apiJson(
    "/api/posts",
    {
      method: "POST",
      body: JSON.stringify({
        title: `[검증] 게시판 가독성 긴 제목 ${suffix} - 팀 공지와 요청을 한눈에 구분해야 합니다`,
        content:
          "이 글은 일반 게시판 글입니다. 공유 템플릿 카드와 섞이면 안 됩니다.\n\n긴 한국어 문장, 링크, 태그가 있어도 카드 폭을 넘지 않고 두세 줄로 정리되어야 합니다. 사용자는 이 글을 눌러 본문을 펼쳐 읽을 수 있어야 합니다.",
        tags: ["board", "readability", "korean"],
      }),
    },
    token,
  );

  const automation = await apiJson(
    "/api/automations",
    {
      method: "POST",
      body: JSON.stringify({
        name: `[검증] 공유 자동화 카드 ${suffix}`,
        source: "GitHub commits",
        destination: "Notion BOARD",
        interval_minutes: 10,
        instruction: "최근 GitHub 커밋을 읽고 Notion BOARD 템플릿에 맞춰 한국어로 정리합니다.",
        template: "요약 / 변경 파일 / 위험도 / 다음 액션",
        api_provider: "GitHub webhook + Notion API",
        ai_agent: "BoardReadabilityAgent",
        ai_provider: "OpenAI",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
        api_key_strategy: "사용자별 저장 프로필 사용",
        template_preset: "github_notion",
      }),
    },
    token,
  );

  const shared = await apiJson(`/api/automations/${automation.task.id}/share`, { method: "POST" }, token);
  const boardPosts = await apiJson("/api/posts?kind=board&limit=20", {}, token);
  const automationPosts = await apiJson("/api/posts?kind=automation&limit=20", {}, token);
  if (!boardPosts.posts.some((item) => item.id === post.post.id)) {
    throw new Error(`fixture board post was not returned by kind=board: ${JSON.stringify(post.post)}`);
  }
  if (!automationPosts.posts.some((item) => item.id === shared.post.id)) {
    throw new Error(`fixture shared automation was not returned by kind=automation: ${JSON.stringify(shared.post)}`);
  }
  return { postId: post.post.id, taskId: automation.task.id, sharedPostId: shared.post.id, suffix };
}

async function cleanupFixtures(token, ids) {
  const errors = [];
  if (ids.sharedPostId) await apiJson(`/api/posts/${ids.sharedPostId}`, { method: "DELETE" }, token).catch((error) => errors.push(error.message));
  if (ids.postId) await apiJson(`/api/posts/${ids.postId}`, { method: "DELETE" }, token).catch((error) => errors.push(error.message));
  if (ids.taskId) await apiJson(`/api/automations/${ids.taskId}`, { method: "DELETE" }, token).catch((error) => errors.push(error.message));
  return errors;
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 2) {
    throw new Error(`${label} has horizontal overflow: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
  }
}

async function assertCardReadable(page, selector, label) {
  const card = page.locator(selector).first();
  try {
    await card.waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    const panelText = await page.locator("#board-panel").innerText().catch(() => "");
    throw new Error(`${label} not visible. Board panel text: ${panelText.slice(0, 1200)}`);
  }
  const result = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const title = node.querySelector(".board-post-title, .board-share-title");
    const titleRect = title?.getBoundingClientRect();
    const styles = title ? getComputedStyle(title) : null;
    return {
      width: rect.width,
      height: rect.height,
      text: node.textContent || "",
      titleWidth: titleRect?.width || 0,
      titleScrollWidth: title?.scrollWidth || 0,
      lineHeight: styles?.lineHeight || "",
      overflowWrap: styles?.overflowWrap || "",
      borderRadius: getComputedStyle(node).borderRadius,
    };
  });
  if (result.width < 260) throw new Error(`${label} is too narrow: ${result.width}`);
  if (!result.text.includes("[검증]")) throw new Error(`${label} does not contain the fixture content`);
  if (result.titleScrollWidth > result.titleWidth + 3) throw new Error(`${label} title overflows: ${result.titleScrollWidth} > ${result.titleWidth}`);
  if (Number.parseFloat(result.borderRadius) > 8) throw new Error(`${label} border radius exceeds app UI rule: ${result.borderRadius}`);
}

async function main() {
  const login = await apiJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const token = login.token;
  const fixtureIds = await createFixtures(token);
  const screenshotDir = join(process.cwd(), "output", "playwright");
  await mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.evaluate((value) => localStorage.setItem("ai-board-token", value), token);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[aria-controls="board-panel"]').click();
    await page.locator("#board-panel").waitFor({ state: "visible", timeout: 10000 });
    await assertNoHorizontalOverflow(page, "desktop posts tab");
    await assertCardReadable(page, ".board-post-card", "desktop board post card");
    await page.screenshot({ path: join(screenshotDir, "board-readable-desktop-posts.png"), fullPage: true });

    await page.getByRole("button", { name: /공유 자동화/ }).click();
    await assertNoHorizontalOverflow(page, "desktop shares tab");
    await assertCardReadable(page, ".board-share-card", "desktop shared automation card");
    const applyButtonText = await page.locator(".board-share-card button").first().innerText();
    if (!applyButtonText.includes("내 자동화에 적용")) throw new Error(`Shared automation apply button is unclear: ${applyButtonText}`);
    await page.screenshot({ path: join(screenshotDir, "board-readable-desktop-shares.png"), fullPage: true });

    await mobile.goto(appUrl, { waitUntil: "networkidle" });
    await mobile.evaluate((value) => localStorage.setItem("ai-board-token", value), token);
    await mobile.reload({ waitUntil: "networkidle" });
    await mobile.locator('[aria-controls="board-panel"]').click();
    await mobile.locator("#board-panel").waitFor({ state: "visible", timeout: 10000 });
    await assertNoHorizontalOverflow(mobile, "mobile posts tab");
    await assertCardReadable(mobile, ".board-post-card", "mobile board post card");
    await mobile.getByRole("button", { name: /공유 자동화/ }).click();
    await assertNoHorizontalOverflow(mobile, "mobile shares tab");
    await assertCardReadable(mobile, ".board-share-card", "mobile shared automation card");
    await mobile.screenshot({ path: join(screenshotDir, "board-readable-mobile-shares.png"), fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          checked: [
            "fixture_post_created",
            "fixture_automation_shared",
            "posts_and_shared_automation_tabs_separated",
            "desktop_no_horizontal_overflow",
            "mobile_no_horizontal_overflow",
            "titles_do_not_overflow",
            "apply_shared_automation_button_visible",
          ],
          screenshots: [
            "output/playwright/board-readable-desktop-posts.png",
            "output/playwright/board-readable-desktop-shares.png",
            "output/playwright/board-readable-mobile-shares.png",
          ],
          fixtureIds,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    const cleanupErrors = await cleanupFixtures(token, fixtureIds);
    if (cleanupErrors.length) throw new Error(`cleanup failed: ${cleanupErrors.join("; ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
