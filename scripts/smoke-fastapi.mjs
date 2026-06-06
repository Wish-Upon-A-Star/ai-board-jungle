const API = "http://127.0.0.1:8000";

async function call(path, options = {}, token = "") {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status} ${JSON.stringify(data)}`);
  return data;
}

let token = "";
let postId = null;
let taskId = null;
let sharedPostId = null;

try {
  const login = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  token = login.token;

  const post = await call(
    "/api/posts",
    {
      method: "POST",
      body: JSON.stringify({
        title: "검증용 GitHub Notion 연동 게시글",
        content: "GitHub Kanban, Notion, Calendar, Figma 연결 흐름을 검증합니다.",
        tags: ["github", "notion", "figma"],
      }),
    },
    token,
  );
  postId = post.post.id;

  await call(`/api/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ content: "검증 댓글" }) }, token);

  const automation = await call(
    "/api/automations",
    {
      method: "POST",
      body: JSON.stringify({
        name: "검증용 GitHub Notion 자동화",
        source: "GitHub Issues",
        destination: "Notion Tasks",
        interval_minutes: 2,
        instruction: "변경된 이슈를 요약해 노션 업무에 반영한다.",
        template: "제목 / 상태 / 링크 / 요약",
        api_provider: "GitHub REST API + Notion API",
        ai_agent: "SyncPlannerAgent",
      }),
    },
    token,
  );
  taskId = automation.task.id;

  const run = await call(`/api/automations/${taskId}/run`, { method: "POST" }, token);
  const shared = await call(`/api/automations/${taskId}/share`, { method: "POST" }, token);
  sharedPostId = shared.post.id;

  const rag = await call("/api/ai/rag", { method: "POST", body: JSON.stringify({ question: "GitHub Notion 연결" }) });
  const hub = await call("/api/integrations/hub/run", {
    method: "POST",
    body: JSON.stringify({ instruction: "깃허브 칸반을 읽고 구글 캘린더와 피그마도 연결해줘" }),
  });

  console.log(JSON.stringify({
    ok: true,
    checked: ["fastapi", "react_api", "auth", "posts", "comments", "automation_create", "automation_run", "automation_share", "rag", "hub"],
    postId,
    taskId,
    sharedPostId,
    runTargets: run.run.result.targets.map((x) => x.target),
    hubTargets: hub.actions.map((x) => x.target),
    ragSources: rag.sources,
  }, null, 2));
} finally {
  const cleanupErrors = [];
  if (token && sharedPostId) {
    await call(`/api/posts/${sharedPostId}`, { method: "DELETE" }, token).catch((error) => cleanupErrors.push(error.message));
  }
  if (token && postId) {
    await call(`/api/posts/${postId}`, { method: "DELETE" }, token).catch((error) => cleanupErrors.push(error.message));
  }
  if (token && taskId) {
    await call(`/api/automations/${taskId}`, { method: "DELETE" }, token).catch((error) => cleanupErrors.push(error.message));
  }
  if (cleanupErrors.length) {
    throw new Error(`smoke cleanup failed: ${cleanupErrors.join("; ")}`);
  }
}
