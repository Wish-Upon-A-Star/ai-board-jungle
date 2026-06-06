import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, CalendarClock, Database, GitBranch, LogOut, Play, Search, Share2, UserPlus } from "lucide-react";
import { api } from "./api";
import "./style.css";

const initialTask = {
  name: "GitHub 이슈를 Notion 업무로 동기화",
  source: "GitHub Issues",
  destination: "Notion Tasks DB",
  interval_minutes: 5,
  instruction: "새 이슈와 변경된 이슈를 요약하고 상태, 링크, 다음 액션을 Notion에 반영한다.",
  template: "업무명 / 상태 / GitHub 링크 / 요약 / 다음 액션",
  api_provider: "GitHub REST API + Notion API",
  ai_agent: "SyncPlannerAgent",
};

function Badge({ role }) {
  const admin = role === "ADMIN";
  return <span className={admin ? "role admin" : "role user"}>{admin ? "관리자" : "사용자"}</span>;
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
  const [apiPrompt, setApiPrompt] = useState("깃허브 칸반을 읽고 노션 업무와 구글 캘린더, 피그마 확인 큐로 연결해줘");
  const [sideTab, setSideTab] = useState("selected");
  const [form, setForm] = useState(initialTask);
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
      const body = authMode === "register"
        ? authForm
        : { email: authForm.email, password: authForm.password };
      const data = await api(path, { method: "POST", body: JSON.stringify(body) });
      localStorage.setItem("ai-board-token", data.token);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  async function demoLogin(email) {
    setAuthMode("login");
    setAuthForm((current) => ({ ...current, email, password: "password123" }));
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
      setSideTab("api");
      setForm(initialTask);
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
          <p>GitHub, Notion, Calendar, Figma 작업을 사용자별 자동화로 등록하고 게시판에 공유하는 운영 콘솔입니다.</p>
          <div className="auth-tabs">
            <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>로그인</button>
            <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>회원가입</button>
          </div>
          <form className="auth-form" onSubmit={submitAuth}>
            <input value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="이메일" />
            {authMode === "register" && (
              <input value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} placeholder="이름" />
            )}
            <input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="비밀번호" />
            <button>{authMode === "register" ? <UserPlus size={14} /> : null}{authMode === "register" ? "계정 만들기" : "로그인"}</button>
          </form>
          <div className="demo-actions">
            <button onClick={() => demoLogin("admin@example.com")}>관리자 데모</button>
            <button onClick={() => demoLogin("user@example.com")}>일반 사용자 데모</button>
          </div>
          {error && <p className="error">{error}</p>}
          <small>새 사용자는 회원가입 후 자기 자동화만 볼 수 있습니다. 관리자는 전체 작업을 볼 수 있습니다.</small>
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
            <p><Badge role={user.role} /> React + FastAPI + PostgreSQL + Redis 기반 AI 자동화 게시판</p>
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
                      <div><dt>API</dt><dd>{task.apiProvider}</dd></div>
                      <div><dt>AI Agent</dt><dd>{task.aiAgent}</dd></div>
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
              <div className="panel-title">자동화 등록</div>
              <form className="automation-form" onSubmit={createAutomation}>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="작업명" />
                <div className="grid2">
                  <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="어디에서" />
                  <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="어디로" />
                </div>
                <div className="grid3">
                  <input type="number" min="1" value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })} placeholder="몇 분마다" />
                  <input value={form.api_provider} onChange={(e) => setForm({ ...form, api_provider: e.target.value })} placeholder="사용 API" />
                  <input value={form.ai_agent} onChange={(e) => setForm({ ...form, ai_agent: e.target.value })} placeholder="AI Agent" />
                </div>
                <textarea value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="실행 지침" />
                <textarea value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} placeholder="결과 템플릿" />
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
                <p>위 API 실행 콘솔이나 자동화 실행 버튼을 누르면 실제 FastAPI 응답이 여기에 표시됩니다.</p>
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
