import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, CalendarClock, Database, GitBranch, KeyRound, Link2, LogOut, Play, Search, Share2, UserPlus } from "lucide-react";
import { api } from "./api";
import "./style.css";

const githubNotionPreset = {
  name: "GitHub 이슈를 Notion 업무로 동기화",
  source: "GitHub Issues",
  destination: "Notion Tasks DB",
  interval_minutes: 5,
  instruction: "새 이슈와 변경된 이슈를 읽고, 누락된 업무는 GitHub 이슈로 등록하며, 이슈 상태를 Notion 업무 DB에 같은 양식으로 반영한다.",
  template: "업무명 / 상태 / GitHub 링크 / 요약 / 담당자 / 마감일 / 다음 액션",
  api_provider: "GitHub REST API + Notion API",
  ai_agent: "SyncPlannerAgent",
  github_repo_url: "https://github.com/<owner>/<repo>",
  github_project_url: "https://github.com/users/<owner>/projects/<number>",
  notion_database_url: "https://www.notion.so/<workspace>/<database-id>",
  figma_file_url: "",
  calendar_id: "primary",
  ai_provider: "OpenAI",
  ai_model: "gpt-4o-mini",
  ai_api_base: "https://api.openai.com/v1",
  api_key_strategy: "사용자별 GitHub/Notion/AI 토큰을 .env 또는 서버 비밀 저장소에 저장하고 작업 소유자 기준으로 주입",
  request_template: "요청 제목: {title}\n요청 이유: {reason}\n담당자: {assignee}\n마감일: {due_date}\n관련 링크: {source_url}",
  github_issue_template: "제목: {title}\n본문: {summary}\n라벨: {labels}\n담당자: {assignee}\n마감일: {due_date}",
  notion_template: "업무명: {title}\n상태: {status}\nGitHub 링크: {github_url}\n요약: {summary}\n담당자: {assignee}\n마감일: {due_date}\n다음 액션: {next_action}",
  figma_template: "",
};

const figmaCalendarPreset = {
  ...githubNotionPreset,
  name: "게시판 요청을 Calendar/Figma 확인 큐로 변환",
  source: "AI Board Posts",
  destination: "Google Calendar + Figma Review",
  interval_minutes: 15,
  instruction: "게시판 요청에서 디자인 확인과 마감일을 추출해 캘린더 일정과 Figma 코멘트/섹션으로 만든다.",
  api_provider: "Google Calendar API + Figma API",
  ai_agent: "ReviewRouteAgent",
  github_repo_url: "",
  github_project_url: "",
  notion_database_url: "",
  figma_file_url: "https://www.figma.com/design/<fileKey>/<fileName>",
  request_template: "일정 제목: {title}\n시작: {start}\n종료: {end}\n설명: {summary}\n링크: {source_url}",
  github_issue_template: "",
  notion_template: "",
  figma_template: "섹션명: {title}\n확인 기준: {checklist}\n관련 게시글: {post_url}\n담당자: {owner}",
};

function Badge({ role }) {
  const admin = role === "ADMIN";
  return <span className={admin ? "role admin" : "role user"}>{admin ? "관리자" : "사용자"}</span>;
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("ai-board-token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "admin@example.com", name: "새 사용자", password: "password123" });
  const [posts, setPosts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState("");
  const [result, setResult] = useState(null);
  const [apiResult, setApiResult] = useState(null);
  const [apiPrompt, setApiPrompt] = useState("GitHub 이슈를 읽어서 Notion 업무 DB 양식으로 넣고, 디자인 확인이 필요하면 Figma에도 코멘트를 남겨줘.");
  const [sideTab, setSideTab] = useState("selected");
  const [form, setForm] = useState(githubNotionPreset);
  const [error, setError] = useState("");

  const myTasks = useMemo(() => tasks.filter((task) => task.owner.id === user?.id), [tasks, user]);
  const sharedCount = posts.filter((post) => post.automationTaskId).length;

  async function loadAll(query = q) {
    const [postData, taskData] = await Promise.all([
      api(`/api/posts?q=${encodeURIComponent(query)}`),
      api("/api/automations"),
    ]);
    setPosts(postData.posts);
    setTasks(taskData.tasks);
    if (!selected && postData.posts[0]) setSelected(postData.posts[0]);
  }

  useEffect(() => {
    if (!token) return;
    api("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem("ai-board-token");
        setToken("");
        setUser(null);
      });
  }, [token]);

  useEffect(() => {
    if (user) loadAll("").catch((err) => setError(err.message));
  }, [user]);

  async function submitAuth(event) {
    event.preventDefault();
    setError("");
    try {
      const path = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = authMode === "register" ? authForm : { email: authForm.email, password: authForm.password };
      const data = await api(path, { method: "POST", body: JSON.stringify(body) });
      localStorage.setItem("ai-board-token", data.token);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  async function demoLogin(email) {
    setError("");
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
      localStorage.setItem("ai-board-token", data.token);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    localStorage.removeItem("ai-board-token");
    setToken("");
    setUser(null);
    setTasks([]);
    setPosts([]);
  }

  async function createAutomation(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/api/automations", { method: "POST", body: JSON.stringify(form) });
      setResult(data);
      setApiResult(data);
      setSideTab("api");
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function runTask(task) {
    const data = await api(`/api/automations/${task.id}/run`, { method: "POST" });
    setResult(data);
    setApiResult(data);
    setSideTab("api");
    await loadAll();
  }

  async function shareTask(task) {
    const data = await api(`/api/automations/${task.id}/share`, { method: "POST" });
    setResult(data);
    setApiResult(data);
    setSideTab("api");
    await loadAll();
  }

  async function callApiDemo(kind) {
    setError("");
    try {
      let data;
      if (kind === "health") {
        data = await api("/api/health");
      } else if (kind === "rag") {
        data = await api("/api/ai/rag", { method: "POST", body: JSON.stringify({ question: apiPrompt }) });
      } else if (kind === "mcp") {
        data = await api("/mcp/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "automation.describe", params: {} }) });
      } else {
        data = await api("/api/integrations/hub/run", { method: "POST", body: JSON.stringify({ instruction: apiPrompt }) });
      }
      setApiResult({ called: kind, response: data });
      setSideTab("api");
    } catch (err) {
      setError(err.message);
      setApiResult({ called: kind, error: err.message });
      setSideTab("api");
    }
  }

  if (!token || !user) {
    return (
      <main className="login-page">
        <section className="login-box">
          <div className="wordmark">AI<span>/</span>BOARD<span>&gt;</span></div>
          <p>각 사용자가 자기 GitHub, Notion, Figma, Calendar, AI 모델을 연결하는 자동화 게시판입니다.</p>
          <div className="auth-tabs">
            <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>로그인</button>
            <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>회원가입</button>
          </div>
          <form className="auth-form" onSubmit={submitAuth}>
            <input value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="이메일" />
            {authMode === "register" && <input value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} placeholder="이름" />}
            <input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="비밀번호" />
            <button>{authMode === "register" ? <UserPlus size={14} /> : null}{authMode === "register" ? "계정 만들기" : "로그인"}</button>
          </form>
          <div className="demo-actions">
            <button onClick={() => demoLogin("admin@example.com")}>관리자 데모</button>
            <button onClick={() => demoLogin("user@example.com")}>일반 사용자 데모</button>
          </div>
          {error && <p className="error">{error}</p>}
          <small>새 사용자는 자기 자동화만 볼 수 있고, 관리자만 전체 작업을 봅니다.</small>
        </section>
      </main>
    );
  }

  return (
    <div className="page">
      <header className="site-header">
        <div className="wordmark">AI<span>/</span>BOARD<span>&gt;</span></div>
        <nav>
          <a href="#automations" className="active">자동화</a>
          <a href="#new-task">등록</a>
          <a href="#api-console">API</a>
          <a href="#board">게시판</a>
        </nav>
        <div className="user-menu">{user.email} <Badge role={user.role} /> <button onClick={logout}><LogOut size={13} /> 로그아웃</button></div>
      </header>

      <main className="container">
        <section className="profile-head">
          <div className={user.role === "ADMIN" ? "avatar admin" : "avatar user"}>{user.role === "ADMIN" ? "A" : "U"}</div>
          <div>
            <h1>{user.name}</h1>
            <p><Badge role={user.role} /> 사용자별 사이트/API/AI 모델을 입력해 실행하는 자동화 게시판</p>
          </div>
        </section>

        {error && <div className="top-error">{error}</div>}

        <div className="layout">
          <aside className="stats">
            <dl>
              <div><dt>내 작업</dt><dd>{myTasks.length}</dd></div>
              <div><dt>보이는 작업</dt><dd>{tasks.length}</dd></div>
              <div><dt>게시판 공유</dt><dd className="green">{sharedCount}</dd></div>
              <div><dt>Redis</dt><dd className="green">RAG 캐시</dd></div>
              <div><dt>AI 모델</dt><dd className="green">{form.ai_model}</dd></div>
              <div><dt>RAG</dt><dd className="green">검색/요약</dd></div>
              <div><dt>MCP</dt><dd>JSON-RPC</dd></div>
              <div><dt>Agent</dt><dd>도구 선택</dd></div>
              <div><dt>PostgreSQL</dt><dd>준비됨</dd></div>
            </dl>
          </aside>

          <section className="main-column">
            <article id="automations" className="panel">
              <div className="panel-title">사용자별 자동화 작업</div>
              <div className="task-list">
                {tasks.map((task) => (
                  <section key={task.id} className="task-card">
                    <div className="task-head">
                      <h2>{task.name}</h2>
                      <Badge role={task.owner.role} />
                    </div>
                    <p className="owner">{task.owner.name} / {task.owner.email}</p>
                    <dl className="task-meta">
                      <div><dt>주기</dt><dd>{task.intervalMinutes}분마다</dd></div>
                      <div><dt>경로</dt><dd>{task.source} {"->"} {task.destination}</dd></div>
                      <div><dt>AI</dt><dd>{task.aiProvider} / {task.aiModel}</dd></div>
                      <div><dt>API</dt><dd>{task.apiProvider}</dd></div>
                      <div><dt>GitHub</dt><dd>{task.githubRepoUrl || task.githubProjectUrl || "미설정"}</dd></div>
                      <div><dt>Notion</dt><dd>{task.notionDatabaseUrl || "미설정"}</dd></div>
                      <div><dt>Figma</dt><dd>{task.figmaFileUrl || "미설정"}</dd></div>
                      <div><dt>Calendar</dt><dd>{task.calendarId || "primary"}</dd></div>
                      <div><dt>템플릿</dt><dd>{task.template}</dd></div>
                      <div><dt>지침</dt><dd>{task.instruction}</dd></div>
                    </dl>
                    <div className="task-actions">
                      <button onClick={() => runTask(task)}><Play size={14} /> 실행</button>
                      <button onClick={() => shareTask(task)} className="secondary"><Share2 size={14} /> 게시판 공유</button>
                    </div>
                  </section>
                ))}
              </div>
            </article>

            <article id="new-task" className="panel">
              <div className="panel-title row-title">
                <span>자동화 등록</span>
                <div className="preset-actions">
                  <button type="button" onClick={() => setForm(githubNotionPreset)}>GitHub -> Notion 예시</button>
                  <button type="button" onClick={() => setForm(figmaCalendarPreset)}>Figma/Calendar 예시</button>
                </div>
              </div>
              <form className="automation-form" onSubmit={createAutomation}>
                <Field label="작업명"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <div className="grid2">
                  <Field label="어디에서"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
                  <Field label="어디로"><input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></Field>
                </div>
                <div className="grid3">
                  <Field label="몇 분마다"><input type="number" min="1" value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })} /></Field>
                  <Field label="AI 제공자"><input value={form.ai_provider} onChange={(e) => setForm({ ...form, ai_provider: e.target.value })} /></Field>
                  <Field label="AI 모델"><input value={form.ai_model} onChange={(e) => setForm({ ...form, ai_model: e.target.value })} /></Field>
                </div>
                <Field label="AI API Base"><input value={form.ai_api_base} onChange={(e) => setForm({ ...form, ai_api_base: e.target.value })} placeholder="https://api.openai.com/v1 또는 사내 gateway URL" /></Field>
                <Field label="사용 API"><input value={form.api_provider} onChange={(e) => setForm({ ...form, api_provider: e.target.value })} /></Field>
                <Field label="AI Agent"><input value={form.ai_agent} onChange={(e) => setForm({ ...form, ai_agent: e.target.value })} /></Field>
                <div className="grid2">
                  <Field label="GitHub Repo URL"><input value={form.github_repo_url} onChange={(e) => setForm({ ...form, github_repo_url: e.target.value })} /></Field>
                  <Field label="GitHub Project URL"><input value={form.github_project_url} onChange={(e) => setForm({ ...form, github_project_url: e.target.value })} /></Field>
                </div>
                <div className="grid2">
                  <Field label="Notion DB URL"><input value={form.notion_database_url} onChange={(e) => setForm({ ...form, notion_database_url: e.target.value })} /></Field>
                  <Field label="Figma File URL"><input value={form.figma_file_url} onChange={(e) => setForm({ ...form, figma_file_url: e.target.value })} /></Field>
                </div>
                <Field label="Google Calendar ID"><input value={form.calendar_id} onChange={(e) => setForm({ ...form, calendar_id: e.target.value })} /></Field>
                <Field label="API Key 관리"><textarea value={form.api_key_strategy} onChange={(e) => setForm({ ...form, api_key_strategy: e.target.value })} /></Field>
                <Field label="실행 지침"><textarea value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} /></Field>
                <Field label="기본 결과 템플릿"><textarea value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} /></Field>
                <Field label="요청/일정 템플릿"><textarea value={form.request_template} onChange={(e) => setForm({ ...form, request_template: e.target.value })} /></Field>
                <div className="grid3 wide">
                  <Field label="GitHub 이슈 템플릿"><textarea value={form.github_issue_template} onChange={(e) => setForm({ ...form, github_issue_template: e.target.value })} /></Field>
                  <Field label="Notion 반영 템플릿"><textarea value={form.notion_template} onChange={(e) => setForm({ ...form, notion_template: e.target.value })} /></Field>
                  <Field label="Figma 작업 템플릿"><textarea value={form.figma_template} onChange={(e) => setForm({ ...form, figma_template: e.target.value })} /></Field>
                </div>
                <button><CalendarClock size={14} /> 자동화 저장</button>
              </form>
            </article>

            <article id="api-console" className="panel">
              <div className="panel-title">API 실행 콘솔</div>
              <div className="api-console">
                <textarea value={apiPrompt} onChange={(e) => setApiPrompt(e.target.value)} />
                <div className="api-buttons">
                  <button onClick={() => callApiDemo("health")}><Database size={14} /> Health</button>
                  <button onClick={() => callApiDemo("rag")}><Search size={14} /> RAG</button>
                  <button onClick={() => callApiDemo("mcp")}><GitBranch size={14} /> MCP</button>
                  <button onClick={() => callApiDemo("hub")}><Bot size={14} /> Agent Hub</button>
                </div>
              </div>
            </article>

            <article id="board" className="panel">
              <div className="panel-title row-title">
                <span>게시판 공유 이력</span>
                <div className="search">
                  <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="검색" />
                  <button onClick={() => loadAll(q)}><Search size={14} /></button>
                </div>
              </div>
              <div className="post-list">
                {posts.map((post) => (
                  <button key={post.id} className={post.automationTaskId ? "post-link shared" : "post-link"} onClick={() => { setSelected(post); setSideTab("selected"); }}>
                    <span>{post.title}</span>
                    <small>{post.author.name} {post.tags.map((t) => `#${t.tag.name}`).join(" ")}</small>
                  </button>
                ))}
              </div>
            </article>
          </section>

          <aside id="result" className="result-panel">
            <div className="tabs">
              <button className={sideTab === "selected" ? "active" : ""} onClick={() => setSideTab("selected")}>선택</button>
              <button className={sideTab === "api" ? "active" : ""} onClick={() => setSideTab("api")}>API</button>
            </div>
            {sideTab === "selected" ? (
              <>
                <h2>{selected?.title || "선택한 게시글"}</h2>
                <p>{selected?.content || "게시글을 선택하면 내용이 표시됩니다."}</p>
              </>
            ) : (
              <>
                <h2>API 실행 결과</h2>
                <p>자동화 실행 또는 API 버튼 호출 결과입니다.</p>
              </>
            )}
            <div className="panel-title compact"><Bot size={14} /> Agent/Automation Result</div>
            <pre>{JSON.stringify(sideTab === "api" ? apiResult || result || { docs: "http://127.0.0.1:8000/docs" } : result || { status: "대기 중" }, null, 2)}</pre>
          </aside>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
