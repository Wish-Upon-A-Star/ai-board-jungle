const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

let cookie = "";

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = Date.now();
  await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: `smoke-${suffix}@example.com`, name: "스모크", password: "password123" }),
  });
  const me = await request("/api/auth/me");
  assert(me.user?.email?.startsWith("smoke-"), "registered user session missing");

  const created = await request("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      title: "RAG MCP Agent 자동 검증 게시글",
      content: "자동화 검증을 위해 작성한 게시글입니다. RAG 추천, MCP 브리핑, Agent 검토가 모두 연결되어야 합니다.",
      tags: ["rag", "mcp", "agent"],
    }),
  });
  assert(created.post?.id, "post creation failed");

  const list = await request("/api/posts?q=자동");
  assert(Array.isArray(list.posts) && list.posts.length >= 1, "post search failed");

  const comment = await request(`/api/posts/${created.post.id}/comments`, {
    method: "POST",
    body: JSON.stringify({ content: "자동화 댓글 검증" }),
  });
  assert(comment.comment?.id, "comment creation failed");

  const rag = await request("/api/ai/rag", {
    method: "POST",
    body: JSON.stringify({ question: "RAG 자동 검증 게시글과 비슷한 글 알려줘" }),
  });
  assert(Array.isArray(rag.recommendations), "rag recommendations missing");

  const agent = await request("/api/ai/agent/moderate", {
    method: "POST",
    body: JSON.stringify({ title: "Agent 검증", content: "정상적인 게시글을 Agent가 검토합니다." }),
  });
  assert(["publish", "hold", "revise"].includes(agent.decision), "agent decision invalid");

  const mcp = await request("/api/ai/mcp/weather", { method: "POST" });
  assert(typeof mcp.summary === "string" && mcp.summary.length > 0, "mcp weather summary missing");

  const integrationSaved = await request("/api/integrations/github-notion", {
    method: "POST",
    body: JSON.stringify({
      githubUrl: "https://github.com/octocat/Hello-World",
      notionTasksUrl: "https://www.notion.so/workspace/Tasks-12345678123412341234123456789abc",
      intervalMinutes: 1,
    }),
  });
  assert(integrationSaved.config?.githubUrl?.includes("github.com"), "integration config save failed");

  const registered = await request("/api/integrations/github-notion/register-automation", { method: "POST" });
  assert(registered.config?.autoSyncEnabled === true, "integration automation registration failed");

  const synced = await request("/api/integrations/github-notion/sync", { method: "POST" });
  assert(synced.summary?.mode === "demo", "integration demo sync failed");

  const hubSaved = await request("/api/integrations/hub", {
    method: "POST",
    body: JSON.stringify({
      githubProjectUrl: "https://github.com/orgs/octocat/projects/1",
      googleCalendarId: "primary",
      figmaFileUrl: "https://www.figma.com/design/abc123/Demo",
    }),
  });
  assert(hubSaved.config?.githubProjectUrl?.includes("github.com"), "hub config save failed");

  const hubRun = await request("/api/integrations/hub/run", {
    method: "POST",
    body: JSON.stringify({
      instruction: "깃헙 칸반에 과제 작업을 넣고 노션에 동기화하고 구글 캘린더에도 넣고 피그마 확인 작업도 만들어줘.",
    }),
  });
  assert(Array.isArray(hubRun.actions) && hubRun.actions.length >= 4, "instruction hub did not route all targets");

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "register",
          "session",
          "post_create",
          "search",
          "comment",
          "rag",
          "agent",
          "mcp",
          "github_notion_config",
          "github_notion_automation",
          "github_notion_sync",
          "github_kanban",
          "google_calendar",
          "figma",
          "instruction_hub",
        ],
        postId: created.post.id,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
