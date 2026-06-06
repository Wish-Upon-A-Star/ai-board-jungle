import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, CalendarClock, Database, FileText, GitBranch, KeyRound, Link2, LogOut, Play, Plus, Search, Share2, Trash2, Upload, UserPlus } from "lucide-react";
import { api } from "./api";
import { customPreset, defaultAutomation, defaultIntegration, defaultKnowledge, figmaCalendarPreset } from "./presets";
import { buildSystemReadinessCards, getRunStatus, mergePostsById, parseRunResult, summarizeRunResult } from "./viewModel";
import "./style.css";

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
  const [authForm, setAuthForm] = useState({ email: "admin@example.com", name: "데모 사용자", password: "password123" });
  const [posts, setPosts] = useState([]);
  const [postPage, setPostPage] = useState({ total: 0, limit: 8, offset: 0, nextOffset: 0, hasMore: false });
  const [tasks, setTasks] = useState([]);
  const [runHistory, setRunHistory] = useState({});
  const [expandedRuns, setExpandedRuns] = useState({});
  const [retryRunState, setRetryRunState] = useState({});
  const [deleteConfirmTaskId, setDeleteConfirmTaskId] = useState(null);
  const [integrationProfiles, setIntegrationProfiles] = useState([]);
  const [providerReadiness, setProviderReadiness] = useState([]);
  const [integrationActivities, setIntegrationActivities] = useState([]);
  const [activityPage, setActivityPage] = useState({ total: 0, limit: 12, offset: 0, nextOffset: 0, hasMore: false });
  const [activityFilters, setActivityFilters] = useState({ provider: "", status: "", event_type: "", automation_task_id: "", integration_profile_id: "", dry_run: "" });
  const [knowledgeSources, setKnowledgeSources] = useState([]);
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState("");
  const [result, setResult] = useState(null);
  const [apiResult, setApiResult] = useState(null);
  const [apiPrompt, setApiPrompt] = useState("GitHub 이슈를 읽어서 Notion 업무 DB 형식으로 넣고, 디자인 확인이 필요하면 Figma에도 코멘트를 남겨줘");
  const [sideTab, setSideTab] = useState("selected");
  const [form, setForm] = useState(defaultAutomation);
  const [knowledgeForm, setKnowledgeForm] = useState(defaultKnowledge);
  const [integrationForm, setIntegrationForm] = useState(defaultIntegration);
  const [liveWriteConfirmations, setLiveWriteConfirmations] = useState({});
  const [profileSettings, setProfileSettings] = useState(null);
  const [error, setError] = useState("");

  const myTasks = useMemo(() => tasks.filter((task) => task.owner?.id === user?.id), [tasks, user]);
  const sharedCount = posts.filter((post) => post.automationTaskId).length;
  const systemCards = buildSystemReadinessCards({ providerReadiness, knowledgeSources, tasks });

  useEffect(() => {
    if (token) loadAll();
  }, [token]);

  async function loadActivities(filters = activityFilters, offset = 0, append = false) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) params.set(key, value);
    });
    params.set("limit", "12");
    params.set("offset", String(offset));
    const data = await api(`/api/integration-activities?${params.toString()}`);
    setActivityPage({ total: data.total, limit: data.limit, offset: data.offset, nextOffset: data.nextOffset, hasMore: data.hasMore });
    setIntegrationActivities((current) => (append ? [...current, ...data.activities] : data.activities));
  }

  async function loadAll(search = q, filters = activityFilters) {
    setError("");
    try {
      const activityParams = new URLSearchParams({ limit: "12", offset: "0" });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) activityParams.set(key, value);
      });
      const [me, postData, taskData, knowledgeData, profileData, readinessData, activityData] = await Promise.all([
        api("/api/auth/me"),
        api(`/api/posts?q=${encodeURIComponent(search)}&limit=8&offset=0`),
        api("/api/automations"),
        api("/api/knowledge"),
        api("/api/integration-profiles"),
        api("/api/provider-readiness"),
        api(`/api/integration-activities?${activityParams.toString()}`),
      ]);
      setUser(me.user);
      setProfileSettings(me.profileSettings);
      setPosts(postData.posts);
      setPostPage({ total: postData.total, limit: postData.limit, offset: postData.offset, nextOffset: postData.nextOffset, hasMore: postData.hasMore });
      setTasks(taskData.tasks);
      setKnowledgeSources(knowledgeData.sources);
      setIntegrationProfiles(profileData.profiles);
      setProviderReadiness(readinessData.providers);
      setIntegrationActivities(activityData.activities);
      setActivityPage({ total: activityData.total, limit: activityData.limit, offset: activityData.offset, nextOffset: activityData.nextOffset, hasMore: activityData.hasMore });
      setSelected((current) => current || postData.posts[0] || null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadMorePosts() {
    const data = await api(`/api/posts?q=${encodeURIComponent(q)}&limit=${postPage.limit}&offset=${postPage.nextOffset}`);
    setPosts((current) => mergePostsById(current, data.posts));
    setPostPage({ total: data.total, limit: data.limit, offset: data.offset, nextOffset: data.nextOffset, hasMore: data.hasMore });
  }

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
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
    localStorage.setItem("ai-board-token", data.token);
    setToken(data.token);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("ai-board-token");
    setToken("");
    setUser(null);
  }

  async function createAutomation(event) {
    event.preventDefault();
    const payload = { ...form, interval_minutes: Number(form.interval_minutes), integration_profile_id: form.integration_profile_id ? Number(form.integration_profile_id) : null };
    const data = await api("/api/automations", { method: "POST", body: JSON.stringify(payload) });
    setResult(data.plan);
    setApiResult({ called: "automation.create", response: data });
    await loadAll();
  }

  async function runTask(task) {
    const data = await api(`/api/automations/${task.id}/run`, { method: "POST" });
    setResult(data.run.result);
    setApiResult({ called: "automation.run", response: data });
    await loadAll();
  }

  async function retryTaskFromRun(task, run) {
    const key = `${task.id}:${run.id}`;
    setRetryRunState((current) => ({ ...current, [key]: { status: "running", message: "Retrying" } }));
    await runTask(task);
    await loadTaskRuns(task);
    setRetryRunState((current) => ({ ...current, [key]: { status: "ok", message: "Retry updated" } }));
  }

  async function shareTask(task) {
    const data = await api(`/api/automations/${task.id}/share`, { method: "POST" });
    setSelected(data.post);
    setApiResult({ called: "automation.share", response: data });
    await loadAll();
  }

  async function deleteTask(task) {
    await api(`/api/automations/${task.id}`, { method: "DELETE" });
    setDeleteConfirmTaskId(null);
    await loadAll();
  }

  async function schedulerTick() {
    const data = await api("/api/automations/scheduler/tick", { method: "POST" });
    setApiResult({ called: "scheduler.tick", response: data });
    await loadAll();
  }

  async function loadTaskRuns(task, offset = 0, append = false) {
    const data = await api(`/api/automations/${task.id}/runs?limit=5&offset=${offset}`);
    setRunHistory((current) => ({
      ...current,
      [task.id]: { ...data, runs: append ? [...(current[task.id]?.runs || []), ...data.runs] : data.runs, loadedAt: new Date().toLocaleTimeString() },
    }));
    setApiResult({ called: "automation.runs", response: data });
  }

  async function callApiDemo(kind) {
    let data;
    if (kind === "health") data = await api("/api/health");
    if (kind === "rag") data = await api("/api/knowledge/rag", { method: "POST", body: JSON.stringify({ question: apiPrompt }) });
    if (kind === "mcp") data = await api("/mcp/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "automation.describe", params: {} }) });
    if (kind === "hub") data = await api("/api/integrations/hub/run", { method: "POST", body: JSON.stringify({ instruction: apiPrompt }) });
    setApiResult({ called: kind, response: data });
    setResult(data);
  }

  async function createPost(event) {
    event.preventDefault();
    const data = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: event.currentTarget.title.value, content: event.currentTarget.content.value, tags: event.currentTarget.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean) }),
    });
    setSelected(data.post);
    event.currentTarget.reset();
    await loadAll();
  }

  async function saveKnowledge(event) {
    event.preventDefault();
    let data;
    if (knowledgeForm.file) {
      const body = new FormData();
      body.set("title", knowledgeForm.title);
      body.set("source_type", knowledgeForm.source_type);
      body.set("instruction", knowledgeForm.instruction);
      body.set("tags", knowledgeForm.tags);
      body.set("file", knowledgeForm.file);
      data = await api("/api/knowledge/upload", { method: "POST", body });
    } else {
      data = await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ ...knowledgeForm, tags: knowledgeForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }),
      });
    }
    setApiResult({ called: "knowledge.save", response: data });
    setResult(data.rag);
    setKnowledgeForm({ ...defaultKnowledge });
    await loadAll();
  }

  async function saveIntegrationProfile(event) {
    event.preventDefault();
    const body = {
      ...integrationForm,
      collect_limit: Number(integrationForm.collect_limit) || 20,
      collect_pages: Number(integrationForm.collect_pages) || 2,
      rag_targets: integrationForm.rag_targets.split(",").map((item) => item.trim()).filter(Boolean),
      custom_connections: [],
    };
    const data = await api("/api/integration-profiles", { method: "POST", body: JSON.stringify(body) });
    setApiResult({ called: "integration-profile.save", response: data });
    setIntegrationForm({ ...defaultIntegration, token_value: "" });
    await loadAll();
  }

  async function collectIntegrationProfile(profile) {
    const data = await api(`/api/integration-profiles/${profile.id}/collect`, { method: "POST" });
    setApiResult({ called: "integration-profile.collect", response: data });
    await loadAll();
  }

  async function writeIntegrationProfile(profile, dryRun = true) {
    const confirmation = liveWriteConfirmations[profile.id] || "";
    const data = await api(`/api/integration-profiles/${profile.id}/write`, {
      method: "POST",
      body: JSON.stringify({ title: `AI Board ${profile.sourceKind} ${dryRun ? "write check" : "live write"}`, body: `${dryRun ? "Dry-run" : "Actual write"} from ${profile.name}.`, dry_run: dryRun, confirmation }),
    });
    setApiResult({ called: "integration-profile.write", response: data });
    await loadAll();
  }

  function applyIntegrationProfile(profileId) {
    const selectedProfile = integrationProfiles.find((profile) => String(profile.id) === String(profileId));
    if (!selectedProfile) {
      setForm({ ...form, integration_profile_id: "" });
      return;
    }
    setForm({
      ...form,
      integration_profile_id: selectedProfile.id,
      source: selectedProfile.sourceKind,
      destination: selectedProfile.sourceKind === "github" ? "Notion Tasks DB" : selectedProfile.sourceKind,
      api_provider: selectedProfile.apiProvider,
      ai_provider: selectedProfile.aiProvider,
      ai_model: selectedProfile.aiModel,
      ai_api_base: selectedProfile.aiApiBase || form.ai_api_base,
      custom_template: selectedProfile.customTemplate || form.custom_template,
    });
  }

  function updateActivityFilters(nextFilters) {
    setActivityFilters(nextFilters);
    loadActivities(nextFilters, 0, false);
  }

  if (!token || !user) {
    return (
      <main className="login-page">
        <section className="login-box">
          <div className="wordmark">AI<span>/</span>BOARD<span>&gt;</span></div>
          <p>GitHub, Notion, Figma, Google Calendar 자동화를 중심으로 한 AI 게시판입니다.</p>
          <div className="auth-tabs">
            <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>로그인</button>
            <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>회원가입</button>
          </div>
          <form className="auth-form" onSubmit={submitAuth}>
            <input value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="email" />
            {authMode === "register" ? <input value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} placeholder="name" /> : null}
            <input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="password" />
            <button>{authMode === "register" ? <UserPlus size={14} /> : null}{authMode === "register" ? "계정 만들기" : "로그인"}</button>
          </form>
          <div className="demo-actions">
            <button onClick={() => demoLogin("admin@example.com")}>관리자 데모</button>
            <button onClick={() => demoLogin("user@example.com")}>일반 사용자 데모</button>
          </div>
          {error && <p className="error">{error}</p>}
          <small>일반 사용자는 자기 자동화만 보고, 관리자는 전체 작업을 볼 수 있습니다.</small>
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
          <a href="#integration-profiles">연동</a>
          <a href="#knowledge">RAG</a>
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
            <p><Badge role={user.role} /> 사용자별 연동 프로필, API 토큰, AI 모델, RAG 지식자료를 서버에 저장하고 자동화마다 선택합니다.</p>
          </div>
        </section>

        {error && <div className="top-error">{error}</div>}

        <div className="layout">
          <aside className="stats">
            <dl>
              <div><dt>내 작업</dt><dd>{myTasks.length}</dd></div>
              <div><dt>전체 작업</dt><dd>{tasks.length}</dd></div>
              <div><dt>게시판 공유</dt><dd className="green">{sharedCount}</dd></div>
              <div><dt>Redis</dt><dd className="green">RAG 캐시</dd></div>
              <div><dt>AI 모델</dt><dd className="green">{form.ai_model}</dd></div>
              <div><dt>연동 프로필</dt><dd className="green">{integrationProfiles.length}</dd></div>
              <div><dt>지식자료</dt><dd className="green">{knowledgeSources.length}</dd></div>
              <div><dt>RAG</dt><dd className="green">검색 요약</dd></div>
              <div><dt>MCP</dt><dd>JSON-RPC</dd></div>
              <div><dt>Agent</dt><dd>도구 선택</dd></div>
              <div><dt>PostgreSQL</dt><dd>준비됨</dd></div>
            </dl>
          </aside>

          <section className="main-column">
            <article className="panel">
              <div className="panel-title row-title">
                <span>System Readiness</span>
                <span className="subtle">검증 항목과 실제 연동 준비 상태를 한눈에 확인합니다.</span>
              </div>
              <div className="system-readiness">
                {systemCards.map((card) => (
                  <div key={card.label} className={card.ok ? "system-card ready" : "system-card pending"}>
                    <strong>{card.label}</strong>
                    <span>{card.value}</span>
                  </div>
                ))}
              </div>
            </article>

            <article id="automations" className="panel">
              <div className="panel-title">사용자별 자동화 작업</div>
              <div className="task-list">
                <div className="scheduler-bar">
                  <button type="button" onClick={schedulerTick}><CalendarClock size={14} /> Scheduler tick</button>
                  <span>활성 자동화를 확인하고 입력 변경이 없으면 실행을 건너뜁니다.</span>
                </div>
                {tasks.map((task) => (
                  <section key={task.id} className="task-card">
                    <div className="task-head"><h2>{task.name}</h2><Badge role={task.owner.role} /></div>
                    <p className="owner">{task.owner.name} / {task.owner.email}</p>
                    <dl className="task-meta">
                      <div><dt>주기</dt><dd>{task.intervalMinutes}분마다</dd></div>
                      <div><dt>경로</dt><dd>{task.source} {"->"} {task.destination}</dd></div>
                      <div><dt>AI</dt><dd>{task.aiProvider} / {task.aiModel}</dd></div>
                      <div><dt>API</dt><dd>{task.apiProvider}</dd></div>
                      <div><dt>연동 프로필</dt><dd>{task.integrationProfile ? `${task.integrationProfile.name} / ${task.integrationProfile.sourceKind}` : "커스텀"}</dd></div>
                      <div><dt>템플릿</dt><dd>{task.templatePreset || "github_notion"}</dd></div>
                    </dl>
                    <div className="task-actions">
                      <button onClick={() => runTask(task)}><Play size={14} /> Run</button>
                      <button onClick={() => shareTask(task)} className="secondary"><Share2 size={14} /> Share</button>
                      <button onClick={() => loadTaskRuns(task)} className="secondary"><Database size={14} /> Run history</button>
                      {deleteConfirmTaskId === task.id ? (
                        <>
                          <button onClick={() => deleteTask(task)} className="danger confirm-delete"><Trash2 size={14} /> Confirm delete</button>
                          <button onClick={() => setDeleteConfirmTaskId(null)} className="secondary">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setDeleteConfirmTaskId(task.id)} className="danger"><Trash2 size={14} /> Delete</button>
                      )}
                    </div>
                    {runHistory[task.id] ? (
                      <div className="run-history">
                        <div className="run-history-head"><strong>Run history</strong><span>{runHistory[task.id].runs.length} / {runHistory[task.id].total} · Updated {runHistory[task.id].loadedAt}</span></div>
                        {runHistory[task.id].runs.map((run) => {
                          const key = `${task.id}:${run.id}`;
                          const expanded = expandedRuns[key];
                          const retryState = retryRunState[key];
                          return (
                            <div key={run.id} className="run-row">
                              <div className="run-row-main">
                                <span>#{run.id}</span>
                                <span>{run.createdAt}</span>
                                <span className={`run-status ${getRunStatus(run.result)}`}>{getRunStatus(run.result)}</span>
                                <p>{summarizeRunResult(run.result)}</p>
                                <button type="button" className="inline-link retry" disabled={retryState?.status === "running"} onClick={() => retryTaskFromRun(task, run)}>
                                  {retryState?.status === "running" ? "Retrying" : "Retry"}
                                </button>
                                <button type="button" className="inline-link" onClick={() => setExpandedRuns((current) => ({ ...current, [key]: !current[key] }))}>
                                  {expanded ? "Hide details" : "Details"}
                                </button>
                              </div>
                              {retryState?.message ? <div className={`run-retry-message ${retryState.status}`}>{retryState.message}</div> : null}
                              {expanded ? <pre className="run-json">{JSON.stringify(parseRunResult(run.result), null, 2)}</pre> : null}
                            </div>
                          );
                        })}
                        {runHistory[task.id].hasMore ? <button className="load-more" onClick={() => loadTaskRuns(task, runHistory[task.id].nextOffset, true)}>Load more runs</button> : null}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </article>

            <article id="new-task" className="panel">
              <div className="panel-title row-title"><span>자동화 등록</span><span className="subtle">프로필 또는 커스텀 설정을 자동화마다 선택합니다.</span></div>
              <form className="automation-form" onSubmit={createAutomation}>
                <div className="preset-actions">
                  <button type="button" onClick={() => setForm(defaultAutomation)}>GitHub + Notion</button>
                  <button type="button" onClick={() => setForm(figmaCalendarPreset)}>Figma + Google Calendar</button>
                  <button type="button" onClick={() => setForm(customPreset)}>Custom API</button>
                </div>
                <section className="integration-profile-box">
                  <div className="grid2">
                    <Field label="저장된 연동 프로필">
                      <select value={form.integration_profile_id || ""} onChange={(e) => applyIntegrationProfile(e.target.value)}>
                        <option value="">커스텀 설정 사용</option>
                        {integrationProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} / {profile.sourceKind} / {profile.aiModel}</option>)}
                      </select>
                    </Field>
                    <Field label="프로필 RAG 범위"><input value={integrationProfiles.find((profile) => String(profile.id) === String(form.integration_profile_id))?.ragTargets?.join(", ") || "선택 프로필 없음"} readOnly /></Field>
                  </div>
                </section>
                <div className="grid3 wide">
                  <Field label="작업명"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                  <Field label="주기"><input type="number" value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })} /></Field>
                  <Field label="Agent"><input value={form.ai_agent} onChange={(e) => setForm({ ...form, ai_agent: e.target.value })} /></Field>
                </div>
                <div className="grid2">
                  <Field label="출발지"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
                  <Field label="목적지"><input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></Field>
                </div>
                <div className="grid3 wide">
                  <Field label="AI 제공자"><input value={form.ai_provider} onChange={(e) => setForm({ ...form, ai_provider: e.target.value })} /></Field>
                  <Field label="AI 모델"><input value={form.ai_model} onChange={(e) => setForm({ ...form, ai_model: e.target.value })} /></Field>
                  <Field label="AI API Base"><input value={form.ai_api_base} onChange={(e) => setForm({ ...form, ai_api_base: e.target.value })} /></Field>
                </div>
                <Field label="API Provider"><input value={form.api_provider} onChange={(e) => setForm({ ...form, api_provider: e.target.value })} /></Field>
                <div className="grid2">
                  <Field label="GitHub Repo URL"><input value={form.github_repo_url} onChange={(e) => setForm({ ...form, github_repo_url: e.target.value })} /></Field>
                  <Field label="Notion DB URL"><input value={form.notion_database_url} onChange={(e) => setForm({ ...form, notion_database_url: e.target.value })} /></Field>
                </div>
                <div className="grid2">
                  <Field label="Figma File URL"><input value={form.figma_file_url} onChange={(e) => setForm({ ...form, figma_file_url: e.target.value })} /></Field>
                  <Field label="Google Calendar ID"><input value={form.calendar_id} onChange={(e) => setForm({ ...form, calendar_id: e.target.value })} /></Field>
                </div>
                <Field label="실행 지침"><textarea value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} /></Field>
                <Field label="결과 템플릿"><textarea value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} /></Field>
                <Field label="API Key 전략"><textarea value={form.api_key_strategy} onChange={(e) => setForm({ ...form, api_key_strategy: e.target.value })} /></Field>
                <button><CalendarClock size={14} /> 자동화 저장</button>
              </form>
            </article>

            <article id="integration-profiles" className="panel">
              <div className="panel-title row-title"><span>연동 프로필 목록</span><span className="subtle">사용자별 토큰, API, AI 모델, RAG 범위를 저장합니다.</span></div>
              <form className="knowledge-form" onSubmit={saveIntegrationProfile}>
                <div className="grid3 wide">
                  <Field label="프로필명"><input value={integrationForm.name} onChange={(e) => setIntegrationForm({ ...integrationForm, name: e.target.value })} /></Field>
                  <Field label="종류">
                    <select value={integrationForm.source_kind} onChange={(e) => setIntegrationForm({ ...integrationForm, source_kind: e.target.value })}>
                      <option value="github">GitHub</option>
                      <option value="notion">Notion</option>
                      <option value="figma">Figma</option>
                      <option value="google_calendar">Google Calendar</option>
                      <option value="custom">Custom API</option>
                    </select>
                  </Field>
                  <Field label="API"><input value={integrationForm.api_provider} onChange={(e) => setIntegrationForm({ ...integrationForm, api_provider: e.target.value })} /></Field>
                </div>
                <div className="grid3 wide">
                  <Field label="Base URL"><input value={integrationForm.base_url} onChange={(e) => setIntegrationForm({ ...integrationForm, base_url: e.target.value })} /></Field>
                  <Field label="토큰 이름"><input value={integrationForm.token_name} onChange={(e) => setIntegrationForm({ ...integrationForm, token_name: e.target.value })} /></Field>
                  <Field label="토큰/API Key"><input type="password" value={integrationForm.token_value} onChange={(e) => setIntegrationForm({ ...integrationForm, token_value: e.target.value })} placeholder="서버 DB에 사용자별 저장" /></Field>
                </div>
                <div className="grid3 wide">
                  <Field label="AI 제공자"><input value={integrationForm.ai_provider} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_provider: e.target.value })} /></Field>
                  <Field label="AI 모델"><input value={integrationForm.ai_model} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_model: e.target.value })} /></Field>
                  <Field label="AI API Base"><input value={integrationForm.ai_api_base} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_api_base: e.target.value })} /></Field>
                </div>
                <Field label="RAG 대상"><input value={integrationForm.rag_targets} onChange={(e) => setIntegrationForm({ ...integrationForm, rag_targets: e.target.value })} /></Field>
                <Field label="프로필 템플릿"><textarea value={integrationForm.custom_template} onChange={(e) => setIntegrationForm({ ...integrationForm, custom_template: e.target.value })} /></Field>
                <button><KeyRound size={14} /> 연동 프로필 저장</button>
              </form>
              <div className="knowledge-list">
                <div className="provider-grid">
                  {providerReadiness.map((provider) => (
                    <div key={provider.key} className={provider.ready ? "provider-card ready" : "provider-card missing"}>
                      <strong>{provider.name}</strong>
                      <span>Live Write Readiness: {provider.ready ? "ready" : "setup required"} / {provider.readyCount}/{provider.profileCount}</span>
                      <p>{provider.requiredUrl} / {provider.requiredToken} / {provider.operation}</p>
                      <small>{provider.nextAction}</small>
                    </div>
                  ))}
                </div>
                <div className="activity-log">
                  <div className="activity-head">
                    <strong>Integration Activity Log</strong>
                    <span>{integrationActivities.length} / {activityPage.total} shown</span>
                    <div className="activity-actions">
                      <button type="button" onClick={() => updateActivityFilters({ provider: "", status: "", event_type: "integration_profile.write", automation_task_id: "", integration_profile_id: "", dry_run: "false" })}>Real-write audit</button>
                      <button type="button" onClick={() => updateActivityFilters({ provider: "", status: "", event_type: "", automation_task_id: "", integration_profile_id: "", dry_run: "" })}>Reset filters</button>
                    </div>
                  </div>
                  {integrationActivities.map((activity) => (
                    <div key={activity.id} className={`activity-row ${activity.status}`}>
                      <span>{activity.eventType}</span><span>{activity.provider || "board"}</span><span>{activity.status}</span><p>{activity.summary}</p>
                    </div>
                  ))}
                  {activityPage.hasMore ? <button type="button" className="load-more" onClick={() => loadActivities(activityFilters, activityPage.nextOffset, true)}>Load more activity</button> : null}
                </div>
                {integrationProfiles.map((profile) => (
                  <div key={profile.id} className="knowledge-item">
                    <strong>{profile.name}</strong>
                    <span>{profile.sourceKind} / {profile.apiProvider} / {profile.aiModel} / token {profile.hasToken ? "저장됨" : "없음"} / {profile.tokenStorage || "empty"}</span>
                    <p>{profile.baseUrl} / RAG: {profile.ragTargets.join(", ") || "미설정"}</p>
                    {profile.lastCollect?.warnings?.length ? <p className="warning-line">{profile.lastCollect.warnings.join(" / ")}</p> : null}
                    <button type="button" onClick={() => collectIntegrationProfile(profile)}><Search size={14} /> RAG 수집 실행</button>
                    {["figma", "google_calendar"].includes(profile.sourceKind) ? (
                      <div className="live-write-controls">
                        <button type="button" onClick={() => writeIntegrationProfile(profile, true)}><Play size={14} /> Dry-run write</button>
                        <input value={liveWriteConfirmations[profile.id] || ""} onChange={(e) => setLiveWriteConfirmations({ ...liveWriteConfirmations, [profile.id]: e.target.value })} placeholder="WRITE LIVE" />
                        <button type="button" className="danger-action" disabled={(liveWriteConfirmations[profile.id] || "").trim() !== "WRITE LIVE"} onClick={() => writeIntegrationProfile(profile, false)}><Play size={14} /> Actual write</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>

            <article id="knowledge" className="panel">
              <div className="panel-title row-title"><span>RAG 지식자료</span><span className="subtle">문서, 음성, 이미지, 기타 파일 설명을 사용자별로 저장합니다.</span></div>
              <form className="knowledge-form" onSubmit={saveKnowledge}>
                <div className="grid3 wide">
                  <Field label="자료명"><input value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} /></Field>
                  <Field label="자료 종류"><select value={knowledgeForm.source_type} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, source_type: e.target.value })}><option value="document">문서</option><option value="audio">음성</option><option value="image">이미지</option><option value="spreadsheet">스프레드시트</option><option value="custom">기타</option></select></Field>
                  <Field label="태그"><input value={knowledgeForm.tags} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, tags: e.target.value })} /></Field>
                </div>
                <Field label="작성/사용 지침"><textarea value={knowledgeForm.instruction} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, instruction: e.target.value })} /></Field>
                <Field label="추출 텍스트"><textarea value={knowledgeForm.extracted_text} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, extracted_text: e.target.value })} /></Field>
                <div className="file-row">
                  <label className="file-picker"><Upload size={14} /> 파일<input type="file" onChange={(e) => setKnowledgeForm({ ...knowledgeForm, file: e.target.files?.[0] || null })} /></label>
                  <span>{knowledgeForm.file ? knowledgeForm.file.name : "파일 없이 텍스트만 저장할 수 있습니다."}</span>
                  <button><FileText size={14} /> 저장</button>
                </div>
              </form>
              <div className="knowledge-list">
                {knowledgeSources.map((source) => <div key={source.id} className="knowledge-item"><strong>{source.title}</strong><span>{source.sourceType} / {source.tags.join(", ")}</span><p>{source.instruction || source.extractedText?.slice(0, 180)}</p></div>)}
              </div>
            </article>

            <article id="board" className="panel">
              <div className="panel-title row-title">
                <span>게시판</span>
                <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" /><button onClick={() => loadAll(q)}><Search size={13} /></button></div>
              </div>
              <div className="post-list">
                {posts.map((post) => (
                  <button key={post.id} data-post-id={post.id} className={post.automationTaskId ? "post-link shared" : "post-link"} onClick={() => setSelected(post)}>
                    <span>{post.title}</span><small>{post.author.name}</small>
                  </button>
                ))}
                <div className="post-page-row">
                  <span>{posts.length} / {postPage.total}</span>
                  {postPage.hasMore ? <button type="button" onClick={loadMorePosts}>Load more posts</button> : null}
                </div>
              </div>
              <form className="write-form" onSubmit={createPost}>
                <input name="title" placeholder="제목" />
                <textarea name="content" placeholder="내용" />
                <input name="tags" placeholder="github,notion,rag" />
                <button>작성</button>
              </form>
            </article>

            <article id="api-console" className="panel">
              <div className="panel-title">API / AI 도구</div>
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
          </section>

          <aside className="result-panel">
            <div className="tabs">
              <button className={sideTab === "selected" ? "active" : ""} onClick={() => setSideTab("selected")}>선택 글</button>
              <button className={sideTab === "api" ? "active" : ""} onClick={() => setSideTab("api")}>AI 결과</button>
            </div>
            {sideTab === "selected" ? (
              selected ? <><h2>{selected.title}</h2><p>{selected.content}</p><p>{selected.tags?.map((tag) => `#${tag.tag.name}`).join(" ")}</p></> : <p>선택된 게시글이 없습니다.</p>
            ) : (
              <pre>{JSON.stringify(apiResult || result || { status: "AI 도구를 실행하면 결과가 표시됩니다." }, null, 2)}</pre>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
