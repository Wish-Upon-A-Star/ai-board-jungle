import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, CalendarClock, Database, FileText, GitBranch, KeyRound, Link2, LogOut, Play, Plus, Search, Share2, Trash2, Upload, UserPlus } from "lucide-react";
import { api } from "./api";
import "./style.css";

const githubNotionPreset = {
  name: "GitHub 이슈를 Notion 업무로 동기화",
  integration_profile_id: "",
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
  template_preset: "github_notion",
  custom_template: "업무명: {title}\n상태: {status}\n원본 링크: {source_url}\n요약: {summary}\n다음 액션: {next_action}",
  custom_connections: [
    {
      label: "GitHub 이슈",
      service: "github",
      url: "https://github.com/<owner>/<repo>",
      api: "GitHub REST API",
      auth_key_name: "GITHUB_TOKEN",
      operation: "changed_issues_to_tasks",
      template: "제목: {title}\n본문: {summary}\n라벨: {labels}\n담당자: {assignee}",
    },
    {
      label: "업무 DB",
      service: "notion",
      url: "https://www.notion.so/<workspace>/<database-id>",
      api: "Notion API",
      auth_key_name: "NOTION_TOKEN",
      operation: "upsert_task_page",
      template: "업무명: {title}\n상태: {status}\nGitHub 링크: {github_url}\n요약: {summary}",
    },
  ],
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
  template_preset: "figma_calendar",
  custom_template: "일정 제목: {title}\n디자인 링크: {figma_url}\n확인 기준: {checklist}\n담당자: {owner}",
  custom_connections: [
    {
      label: "디자인 파일",
      service: "figma",
      url: "https://www.figma.com/design/<fileKey>/<fileName>",
      api: "Figma REST API 또는 Figma MCP",
      auth_key_name: "FIGMA_TOKEN",
      operation: "create_review_comment",
      template: "섹션명: {title}\n확인 기준: {checklist}\n관련 게시글: {post_url}",
    },
    {
      label: "일정",
      service: "google_calendar",
      url: "primary",
      api: "Google Calendar API",
      auth_key_name: "GOOGLE_CALENDAR_TOKEN",
      operation: "create_event",
      template: "일정 제목: {title}\n시작: {start}\n종료: {end}\n설명: {summary}",
    },
  ],
};

const blankConnection = {
  label: "새 연결",
  service: "custom",
  url: "",
  api: "Custom REST API",
  auth_key_name: "CUSTOM_API_KEY",
  operation: "custom_action",
  template: "필드명: {value}\n링크: {source_url}\n다음 액션: {next_action}",
};

const customPreset = {
  ...githubNotionPreset,
  name: "커스텀 사이트/API 자동화",
  source: "사용자 입력 소스",
  destination: "사용자 입력 대상",
  instruction: "연결 목록의 변경사항을 감지하고, 선택한 템플릿에 맞춰 필요한 사이트/API에 반영한다.",
  template: "원본 / 변경 내용 / 대상 API / 결과 / 다음 액션",
  api_provider: "사용자 지정 API",
  ai_agent: "CustomWorkflowAgent",
  github_repo_url: "",
  github_project_url: "",
  notion_database_url: "",
  figma_file_url: "",
  calendar_id: "",
  template_preset: "custom",
  custom_template: "원본: {source}\n변경: {changes}\n대상: {target}\n요약: {summary}\n다음 액션: {next_action}",
  custom_connections: [{ ...blankConnection }],
};

const activityProviders = ["github", "notion", "figma", "google_calendar", "custom", "board", "GitHub REST API + Notion API", "GitHub REST API + 사용자 지정 업무 DB API"];
const activityStatuses = ["ok", "changed", "skipped", "ready", "failed", "blocked", "collected", "unchanged", "no-data"];
const activityEvents = ["integration_profile.created", "integration_profile.collect", "integration_profile.write", "automation.created", "automation.run", "automation.shared"];

function Badge({ role }) {
  const admin = role === "ADMIN";
  return <span className={admin ? "role admin" : "role user"}>{admin ? "관리자" : "사용자"}</span>;
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function parseRunResult(result) {
  if (!result) return {};
  if (typeof result === "object") return result;
  try {
    return JSON.parse(result);
  } catch {
    return { raw: String(result) };
  }
}

function summarizeRunResult(result) {
  const data = parseRunResult(result);
  const agent = data.agent || data.aiAgent || "agent";
  const route = data.route || [data.source, data.destination].filter(Boolean).join(" -> ");
  const targetCount = Array.isArray(data.targets) ? data.targets.length : 0;
  const ragCount = Array.isArray(data.externalRagSources) ? data.externalRagSources.length : 0;
  const parts = [agent];
  if (route) parts.push(route);
  if (targetCount) parts.push(`${targetCount} targets`);
  if (ragCount) parts.push(`${ragCount} RAG sources`);
  return parts.join(" / ");
}

function getRunStatus(result) {
  const data = parseRunResult(result);
  return String(data.status || data.run?.status || data.raw || "unknown").toLowerCase();
}

function prettyRunResult(result) {
  const data = parseRunResult(result);
  if (data.raw) return data.raw;
  return JSON.stringify(data, null, 2);
}

function runRowStateKey(taskId, runId) {
  return `${taskId}:${runId}`;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("ai-board-token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "admin@example.com", name: "새 사용자", password: "password123" });
  const [posts, setPosts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [runHistory, setRunHistory] = useState({});
  const [expandedRuns, setExpandedRuns] = useState({});
  const [retryRunState, setRetryRunState] = useState({});
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
  const [apiPrompt, setApiPrompt] = useState("GitHub 이슈를 읽어서 Notion 업무 DB 양식으로 넣고, 디자인 확인이 필요하면 Figma에도 코멘트를 남겨줘.");
  const [sideTab, setSideTab] = useState("selected");
  const [form, setForm] = useState(githubNotionPreset);
  const [profileSettings, setProfileSettings] = useState(null);
  const [liveWriteConfirmations, setLiveWriteConfirmations] = useState({});
  const [knowledgeForm, setKnowledgeForm] = useState({
    title: "운영 자동화 지침",
    source_type: "document",
    instruction: "이 자료를 자동화 실행 지침과 RAG 답변 근거로 사용한다.",
    extracted_text: "예: GitHub 이슈가 bug 라벨이면 Notion 업무 상태를 확인 필요로 작성한다.",
    tags: "automation,rag",
    file: null,
  });
  const [integrationForm, setIntegrationForm] = useState({
    name: "GitHub RAG 소스",
    source_kind: "github",
    base_url: "https://github.com/<owner>/<repo>",
    api_provider: "GitHub REST API",
    token_name: "GITHUB_TOKEN",
    token_value: "",
    ai_provider: "OpenAI",
    ai_model: "gpt-4o-mini",
    ai_api_base: "https://api.openai.com/v1",
    rag_targets: "issues,commits,pull_requests",
    collect_limit: 20,
    collect_pages: 2,
    custom_template: "출처: {source}\n제목: {title}\n요약: {summary}\n링크: {url}",
  });
  const [error, setError] = useState("");

  const myTasks = useMemo(() => tasks.filter((task) => task.owner.id === user?.id), [tasks, user]);
  const sharedCount = posts.filter((post) => post.automationTaskId).length;
  const connectionCount = form.custom_connections?.length || 0;

  function clearRunUiState(taskId = null) {
    if (taskId === null) {
      setRunHistory({});
      setExpandedRuns({});
      setRetryRunState({});
      return;
    }
    const prefix = `${taskId}:`;
    setRunHistory((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setExpandedRuns((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))));
    setRetryRunState((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))));
  }

  function applyPreset(nextPreset) {
    setForm({
      ...nextPreset,
      custom_connections: nextPreset.custom_connections.map((connection) => ({ ...connection })),
    });
  }

  function updateConnection(index, key, value) {
    const customConnections = [...(form.custom_connections || [])];
    customConnections[index] = { ...customConnections[index], [key]: value };
    setForm({ ...form, custom_connections: customConnections });
  }

  function addConnection() {
    setForm({
      ...form,
      custom_connections: [...(form.custom_connections || []), { ...blankConnection, label: `새 연결 ${(form.custom_connections?.length || 0) + 1}` }],
    });
  }

  function removeConnection(index) {
    setForm({ ...form, custom_connections: (form.custom_connections || []).filter((_, itemIndex) => itemIndex !== index) });
  }

  function profileToFormPatch(settings) {
    return {
      ai_provider: settings.aiProvider,
      ai_model: settings.aiModel,
      ai_api_base: settings.aiApiBase,
      api_key_strategy: settings.apiKeyStrategy,
      template_preset: settings.templatePreset,
      custom_template: settings.customTemplate,
      custom_connections: (settings.customConnections || []).map((connection) => ({ ...connection })),
    };
  }

  function currentFormProfilePayload() {
    return {
      ai_provider: form.ai_provider,
      ai_model: form.ai_model,
      ai_api_base: form.ai_api_base,
      api_key_strategy: form.api_key_strategy,
      template_preset: form.template_preset,
      custom_template: form.custom_template,
      custom_connections: form.custom_connections || [],
    };
  }

  function applyProfileSettings() {
    if (!profileSettings) return;
    setForm({ ...form, ...profileToFormPatch(profileSettings) });
  }

  async function saveProfileSettings() {
    setError("");
    try {
      const data = await api("/api/profile/settings", { method: "PUT", body: JSON.stringify(currentFormProfilePayload()) });
      setProfileSettings(data.profileSettings);
      setApiResult({ called: "profile.save", response: data });
      setSideTab("api");
    } catch (err) {
      setError(err.message);
    }
  }

  async function reloadProfileSettings() {
    setError("");
    try {
      const data = await api("/api/profile/settings");
      setProfileSettings(data.profileSettings);
      setForm({ ...form, ...profileToFormPatch(data.profileSettings) });
    } catch (err) {
      setError(err.message);
    }
  }

  function activityQuery(filters = activityFilters, offset = 0, limit = activityPage.limit) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) params.set(key, value);
    });
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    return params.toString();
  }

  async function loadActivities(filters = activityFilters, offset = 0, append = false) {
    const query = activityQuery(filters, offset);
    const activityData = await api(`/api/integration-activities${query ? `?${query}` : ""}`);
    setIntegrationActivities((current) => (append ? [...current, ...activityData.activities] : activityData.activities));
    setActivityPage({
      total: activityData.total || 0,
      limit: activityData.limit || activityPage.limit,
      offset: activityData.offset || 0,
      nextOffset: activityData.nextOffset || 0,
      hasMore: Boolean(activityData.hasMore),
    });
  }

  async function updateActivityFilters(nextFilters) {
    setActivityFilters(nextFilters);
    await loadActivities(nextFilters, 0, false);
  }

  async function loadMoreActivities() {
    await loadActivities(activityFilters, activityPage.nextOffset, true);
  }

  async function loadAll(query = q, filters = activityFilters) {
    const activityPath = activityQuery(filters, 0);
    const [postData, taskData, knowledgeData, profileData, readinessData, activityData] = await Promise.all([
      api(`/api/posts?q=${encodeURIComponent(query)}`),
      api("/api/automations"),
      api("/api/knowledge"),
      api("/api/integration-profiles"),
      api("/api/provider-readiness"),
      api(`/api/integration-activities${activityPath ? `?${activityPath}` : ""}`),
    ]);
    setPosts(postData.posts);
    setTasks(taskData.tasks);
    setKnowledgeSources(knowledgeData.sources);
    setIntegrationProfiles(profileData.profiles);
    setProviderReadiness(readinessData.providers);
    setIntegrationActivities(activityData.activities);
    setActivityPage({
      total: activityData.total || 0,
      limit: activityData.limit || activityPage.limit,
      offset: activityData.offset || 0,
      nextOffset: activityData.nextOffset || 0,
      hasMore: Boolean(activityData.hasMore),
    });
    if (!selected && postData.posts[0]) setSelected(postData.posts[0]);
  }

  useEffect(() => {
    if (!token) return;
    api("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setProfileSettings(data.profileSettings);
      })
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
    setProfileSettings(null);
    setTasks([]);
    setPosts([]);
    clearRunUiState();
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

  async function runTask(task, options = {}) {
    const data = await api(`/api/automations/${task.id}/run`, { method: "POST" });
    setResult(data);
    setApiResult(data);
    setSideTab("api");
    await loadAll();
    if (options.refreshRuns || runHistory[task.id]) {
      await loadTaskRuns(task);
    }
  }

  async function retryTaskFromRun(task, run) {
    const stateKey = runRowStateKey(task.id, run.id);
    setRetryRunState((current) => ({ ...current, [stateKey]: { status: "running", message: "Retrying..." } }));
    setError("");
    try {
      await runTask(task, { refreshRuns: true });
      setRetryRunState((current) => ({ ...current, [stateKey]: { status: "ok", message: "Retry updated" } }));
    } catch (err) {
      setError(err.message);
      setApiResult({ called: "automation.retry", error: err.message, runId: run.id, taskId: task.id });
      setSideTab("api");
      setRetryRunState((current) => ({ ...current, [stateKey]: { status: "failed", message: err.message } }));
    }
  }

  async function shareTask(task) {
    const data = await api(`/api/automations/${task.id}/share`, { method: "POST" });
    setResult(data);
    setApiResult(data);
    setSideTab("api");
    await loadAll();
  }

  async function deleteTask(task) {
    setError("");
    try {
      const data = await api(`/api/automations/${task.id}`, { method: "DELETE" });
      setResult(data);
      setApiResult({ called: "automation.delete", response: data, taskId: task.id });
      setSideTab("api");
      clearRunUiState(task.id);
      await loadAll();
    } catch (err) {
      setError(err.message);
      setApiResult({ called: "automation.delete", error: err.message, taskId: task.id });
      setSideTab("api");
    }
  }

  async function schedulerTick() {
    setError("");
    try {
      const data = await api("/api/automations/scheduler/tick", { method: "POST" });
      setApiResult({ called: "scheduler.tick", response: data });
      setSideTab("api");
      await loadAll();
    } catch (err) {
      setError(err.message);
      setApiResult({ called: "scheduler.tick", error: err.message });
      setSideTab("api");
    }
  }

  async function loadTaskRuns(task, offset = 0, append = false) {
    setError("");
    try {
      const data = await api(`/api/automations/${task.id}/runs?limit=5&offset=${offset}`);
      setRunHistory((current) => ({
        ...current,
        [task.id]: {
          ...data,
          runs: append ? [...(current[task.id]?.runs || []), ...data.runs] : data.runs,
          loadedAt: new Date().toLocaleTimeString(),
        },
      }));
      setApiResult({ called: "automation.runs", response: data });
      setSideTab("api");
    } catch (err) {
      setError(err.message);
      setApiResult({ called: "automation.runs", error: err.message });
      setSideTab("api");
    }
  }

  async function callApiDemo(kind) {
    setError("");
    try {
      let data;
      if (kind === "health") {
        data = await api("/api/health");
      } else if (kind === "rag") {
        data = await api("/api/knowledge/rag", { method: "POST", body: JSON.stringify({ question: apiPrompt }) });
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

  async function saveKnowledge(event) {
    event.preventDefault();
    setError("");
    try {
      let data;
      if (knowledgeForm.file) {
        const body = new FormData();
        body.append("title", knowledgeForm.title);
        body.append("source_type", knowledgeForm.source_type);
        body.append("instruction", knowledgeForm.instruction);
        body.append("tags", knowledgeForm.tags);
        body.append("file", knowledgeForm.file);
        data = await api("/api/knowledge/upload", { method: "POST", body });
      } else {
        data = await api("/api/knowledge", {
          method: "POST",
          body: JSON.stringify({
            title: knowledgeForm.title,
            source_type: knowledgeForm.source_type,
            instruction: knowledgeForm.instruction,
            extracted_text: knowledgeForm.extracted_text,
            tags: knowledgeForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          }),
        });
      }
      setApiResult({ called: "knowledge.save", response: data });
      setSideTab("api");
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
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
      api_provider: selectedProfile.apiProvider,
      ai_provider: selectedProfile.aiProvider,
      ai_model: selectedProfile.aiModel,
      ai_api_base: selectedProfile.aiApiBase,
      api_key_strategy: `서버 저장 연동 프로필 '${selectedProfile.name}'의 ${selectedProfile.tokenName || "토큰"} 사용`,
      custom_template: selectedProfile.customTemplate || form.custom_template,
      custom_connections: selectedProfile.customConnections?.length ? selectedProfile.customConnections : form.custom_connections,
    });
  }

  async function saveIntegrationProfile(event) {
    event.preventDefault();
    setError("");
    try {
      const body = {
        ...integrationForm,
        collect_limit: Number(integrationForm.collect_limit) || 20,
        collect_pages: Number(integrationForm.collect_pages) || 2,
        rag_targets: integrationForm.rag_targets.split(",").map((item) => item.trim()).filter(Boolean),
        custom_connections: form.custom_connections || [],
      };
      const data = await api("/api/integration-profiles", { method: "POST", body: JSON.stringify(body) });
      setIntegrationProfiles([data.profile, ...integrationProfiles]);
      setApiResult({ called: "integration-profile.save", response: data });
      setSideTab("api");
    } catch (err) {
      setError(err.message);
    }
  }

  async function collectIntegrationProfile(profile) {
    setError("");
    try {
      const data = await api(`/api/integration-profiles/${profile.id}/collect`, { method: "POST" });
      setApiResult({ called: "integration-profile.collect", response: data });
      setSideTab("api");
      await loadAll();
    } catch (err) {
      setError(err.message);
      setApiResult({ called: "integration-profile.collect", error: err.message });
      setSideTab("api");
    }
  }

  async function writeIntegrationProfile(profile, dryRun = true) {
    setError("");
    const confirmation = liveWriteConfirmations[profile.id] || "";
    if (!dryRun && confirmation.trim() !== "WRITE LIVE") {
      setError("실제 외부 쓰기는 확인 문구 WRITE LIVE를 입력해야 실행됩니다.");
      setApiResult({ called: "integration-profile.write", error: "Missing confirmation text WRITE LIVE" });
      setSideTab("api");
      return;
    }
    try {
      const data = await api(`/api/integration-profiles/${profile.id}/write`, {
        method: "POST",
        body: JSON.stringify({
          title: `AI Board ${profile.sourceKind} ${dryRun ? "write check" : "live write"}`,
          body: `${dryRun ? "Dry-run" : "Actual write"} from ${profile.name}.`,
          dry_run: dryRun,
          confirmation,
        }),
      });
      setApiResult({ called: "integration-profile.write", response: data });
      setSideTab("api");
      await loadAll();
    } catch (err) {
      setError(err.message);
      setApiResult({ called: "integration-profile.write", error: err.message });
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
            <p><Badge role={user.role} /> 서버 DB에 사용자별 연결/API/AI 모델과 RAG 지식자료를 저장해 자동화마다 불러오는 게시판</p>
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
              <div><dt>연결 칸</dt><dd className="green">{connectionCount}</dd></div>
              <div><dt>지식자료</dt><dd className="green">{knowledgeSources.length}</dd></div>
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
                <div className="scheduler-bar">
                  <button type="button" onClick={schedulerTick}><CalendarClock size={14} /> Scheduler tick</button>
                  <span>Runs due active automations and skips unchanged inputs.</span>
                </div>
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
                      <div><dt>연동 프로필</dt><dd>{task.integrationProfile ? `${task.integrationProfile.name} / ${task.integrationProfile.sourceKind}` : "커스텀"}</dd></div>
                      <div><dt>템플릿 선택</dt><dd>{task.templatePreset || "github_notion"}</dd></div>
                      <div><dt>커스텀 연결</dt><dd>{task.customConnections?.length ? task.customConnections.map((item) => `${item.label}(${item.service})`).join(", ") : "빠른 입력만 사용"}</dd></div>
                      <div><dt>빠른 입력</dt><dd>{[task.githubRepoUrl || task.githubProjectUrl, task.notionDatabaseUrl, task.figmaFileUrl, task.calendarId].filter(Boolean).join(" / ") || "미설정"}</dd></div>
                      <div><dt>템플릿</dt><dd>{task.template}</dd></div>
                      <div><dt>커스텀 템플릿</dt><dd>{task.customTemplate || "미설정"}</dd></div>
                      <div><dt>지침</dt><dd>{task.instruction}</dd></div>
                    </dl>
                    <div className="task-actions">
                      <button onClick={() => runTask(task)}><Play size={14} /> Run</button>
                      <button onClick={() => shareTask(task)} className="secondary"><Share2 size={14} /> Share</button>
                      <button onClick={() => loadTaskRuns(task)} className="secondary"><Database size={14} /> Run history</button>
                      <button onClick={() => deleteTask(task)} className="danger"><Trash2 size={14} /> Delete</button>
                    </div>
                    {runHistory[task.id] ? (
                      <div className="run-history">
                        <div className="run-history-head">
                          <strong>Run history</strong>
                          <span>{runHistory[task.id].runs.length} / {runHistory[task.id].total} · Updated {runHistory[task.id].loadedAt}</span>
                        </div>
                        {runHistory[task.id].runs.map((run) => {
                          const rowStateKey = runRowStateKey(task.id, run.id);
                          const retryState = retryRunState[rowStateKey];
                          const expanded = expandedRuns[rowStateKey];
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
                                <button type="button" className="inline-link" onClick={() => setExpandedRuns((current) => ({ ...current, [rowStateKey]: !current[rowStateKey] }))}>
                                  {expanded ? "Hide details" : "Details"}
                                </button>
                              </div>
                              {retryState?.message ? <div className={`run-retry-message ${retryState.status}`}>{retryState.message}</div> : null}
                              {expanded ? <pre className="run-json">{prettyRunResult(run.result)}</pre> : null}
                            </div>
                          );
                        })}
                        {runHistory[task.id].hasMore ? (
                          <button type="button" className="load-more" onClick={() => loadTaskRuns(task, runHistory[task.id].nextOffset, true)}>Load more runs</button>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </article>

            <article id="new-task" className="panel">
              <div className="panel-title row-title">
                <span>자동화 등록</span>
                <div className="preset-actions">
                  <button type="button" onClick={() => applyPreset(githubNotionPreset)}>GitHub to Notion 예시</button>
                  <button type="button" onClick={() => applyPreset(figmaCalendarPreset)}>Figma/Calendar 예시</button>
                  <button type="button" onClick={() => applyPreset(customPreset)}>커스텀 API 예시</button>
                </div>
              </div>
              <form className="automation-form" onSubmit={createAutomation}>
                <section className="profile-settings-box">
                  <div className="section-head">
                    <div>
                      <strong>서버 저장값</strong>
                      <span>
                        저장된 AI 모델 {profileSettings?.aiModel || "미설정"} /
                        연결 {profileSettings?.customConnections?.length || 0}개.
                        자동화마다 불러온 뒤 필요한 부분만 바꿔 저장합니다.
                      </span>
                    </div>
                    <div className="profile-actions">
                      <button type="button" onClick={reloadProfileSettings}><Link2 size={14} /> 서버 저장값 불러오기</button>
                      <button type="button" onClick={saveProfileSettings}><KeyRound size={14} /> 현재 설정 서버 저장</button>
                    </div>
                  </div>
                </section>
                <section className="integration-profile-box">
                  <div className="section-head">
                    <div>
                      <strong>자동화별 연동 프로필 선택</strong>
                      <span>사용자별로 등록한 GitHub/Notion/커스텀 API, 토큰, AI 모델, RAG 수집 대상을 자동화마다 선택합니다.</span>
                    </div>
                  </div>
                  <div className="grid2">
                    <Field label="저장된 연동 프로필">
                      <select value={form.integration_profile_id || ""} onChange={(e) => applyIntegrationProfile(e.target.value)}>
                        <option value="">커스텀 직접 입력</option>
                        {integrationProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>{profile.name} / {profile.sourceKind} / {profile.aiModel}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="RAG 수집 대상">
                      <input value={integrationProfiles.find((profile) => String(profile.id) === String(form.integration_profile_id))?.ragTargets?.join(", ") || "선택 프로필 없음"} readOnly />
                    </Field>
                  </div>
                </section>
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
                <div className="grid2">
                  <Field label="템플릿 선택">
                    <select value={form.template_preset} onChange={(e) => setForm({ ...form, template_preset: e.target.value })}>
                      <option value="github_notion">GitHub 이슈 to 업무 DB</option>
                      <option value="figma_calendar">디자인 확인 to 일정/피드백</option>
                      <option value="rag_board">RAG 게시판 요약/추천</option>
                      <option value="custom">커스텀 템플릿</option>
                    </select>
                  </Field>
                  <Field label="커스텀 모델/API">
                    <input value={form.ai_model} onChange={(e) => setForm({ ...form, ai_model: e.target.value })} placeholder="gpt-4o-mini, claude, gemini, 사내 모델명" />
                  </Field>
                </div>
                <Field label="AI API Base"><input value={form.ai_api_base} onChange={(e) => setForm({ ...form, ai_api_base: e.target.value })} placeholder="https://api.openai.com/v1 또는 사내 gateway URL" /></Field>
                <Field label="사용 API"><input value={form.api_provider} onChange={(e) => setForm({ ...form, api_provider: e.target.value })} /></Field>
                <Field label="AI Agent"><input value={form.ai_agent} onChange={(e) => setForm({ ...form, ai_agent: e.target.value })} /></Field>
                <section className="connection-builder">
                  <div className="section-head">
                    <div>
                      <strong>커스텀 연결 칸</strong>
                      <span>Notion, Figma를 고정하지 않고 사용자가 필요한 사이트/API를 직접 추가합니다.</span>
                    </div>
                    <button type="button" onClick={addConnection}><Plus size={14} /> 연결 칸 추가</button>
                  </div>
                  {(form.custom_connections || []).map((connection, index) => (
                    <div className="connection-card" key={`${connection.label}-${index}`}>
                      <div className="connection-title">
                        <strong>{index + 1}. {connection.label || "새 연결"}</strong>
                        <button type="button" className="danger" onClick={() => removeConnection(index)}><Trash2 size={13} /> 삭제</button>
                      </div>
                      <div className="grid3 wide">
                        <Field label="표시 이름"><input value={connection.label} onChange={(e) => updateConnection(index, "label", e.target.value)} placeholder="업무 DB, 디자인 파일, 사내 Jira" /></Field>
                        <Field label="서비스 키"><input value={connection.service} onChange={(e) => updateConnection(index, "service", e.target.value)} placeholder="notion, figma, jira, slack" /></Field>
                        <Field label="요청 API"><input value={connection.api} onChange={(e) => updateConnection(index, "api", e.target.value)} placeholder="REST API, MCP, GraphQL" /></Field>
                      </div>
                      <div className="grid3 wide">
                        <Field label="URL/ID"><input value={connection.url} onChange={(e) => updateConnection(index, "url", e.target.value)} placeholder="사이트 URL, DB ID, 파일 URL, 캘린더 ID" /></Field>
                        <Field label="토큰 변수명"><input value={connection.auth_key_name} onChange={(e) => updateConnection(index, "auth_key_name", e.target.value)} placeholder="NOTION_TOKEN, FIGMA_TOKEN" /></Field>
                        <Field label="작업 방식"><input value={connection.operation} onChange={(e) => updateConnection(index, "operation", e.target.value)} placeholder="create_issue, upsert_page, create_event" /></Field>
                      </div>
                      <Field label="이 연결의 템플릿"><textarea value={connection.template} onChange={(e) => updateConnection(index, "template", e.target.value)} /></Field>
                    </div>
                  ))}
                </section>
                <Field label="커스텀 출력 템플릿"><textarea value={form.custom_template} onChange={(e) => setForm({ ...form, custom_template: e.target.value })} placeholder="프리셋 대신 사용할 전체 출력 양식" /></Field>
                <div className="quick-inputs">
                  <div className="section-head flat">
                    <div>
                      <strong>빠른 예시 입력</strong>
                      <span>아래 칸은 선택 사항입니다. 실제 대상은 위의 커스텀 연결 칸에 자유롭게 추가할 수 있습니다.</span>
                    </div>
                  </div>
                </div>
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

            <article id="integration-profiles" className="panel">
              <div className="panel-title row-title">
                <span>연동 프로필 목록</span>
                <span className="subtle">사용자별 토큰/API/AI 모델/RAG 대상 등록</span>
              </div>
              <form className="knowledge-form" onSubmit={saveIntegrationProfile}>
                <div className="grid3 wide">
                  <Field label="프로필명"><input value={integrationForm.name} onChange={(e) => setIntegrationForm({ ...integrationForm, name: e.target.value })} /></Field>
                  <Field label="종류">
                    <select value={integrationForm.source_kind} onChange={(e) => setIntegrationForm({ ...integrationForm, source_kind: e.target.value })}>
                      <option value="github">GitHub</option>
                      <option value="notion">Notion</option>
                      <option value="figma">Figma</option>
                      <option value="google_calendar">Google Calendar</option>
                      <option value="gitlab">GitLab</option>
                      <option value="jira">Jira</option>
                      <option value="slack">Slack</option>
                      <option value="custom">커스텀 API</option>
                    </select>
                  </Field>
                  <Field label="요청 API"><input value={integrationForm.api_provider} onChange={(e) => setIntegrationForm({ ...integrationForm, api_provider: e.target.value })} /></Field>
                </div>
                <div className="grid3 wide">
                  <Field label="Base URL"><input value={integrationForm.base_url} onChange={(e) => setIntegrationForm({ ...integrationForm, base_url: e.target.value })} placeholder="repo URL, Notion DB URL, API base" /></Field>
                  <Field label="토큰 이름"><input value={integrationForm.token_name} onChange={(e) => setIntegrationForm({ ...integrationForm, token_name: e.target.value })} placeholder="GITHUB_TOKEN" /></Field>
                  <Field label="토큰/API Key"><input type="password" value={integrationForm.token_value} onChange={(e) => setIntegrationForm({ ...integrationForm, token_value: e.target.value })} placeholder="서버 DB에 사용자별 저장" /></Field>
                </div>
                <div className="grid3 wide">
                  <Field label="AI 제공자"><input value={integrationForm.ai_provider} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_provider: e.target.value })} /></Field>
                  <Field label="AI 모델"><input value={integrationForm.ai_model} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_model: e.target.value })} /></Field>
                  <Field label="AI API Base"><input value={integrationForm.ai_api_base} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_api_base: e.target.value })} /></Field>
                </div>
                <div className="grid3 wide">
                  <Field label="Collect limit"><input type="number" min="1" max="100" value={integrationForm.collect_limit} onChange={(e) => setIntegrationForm({ ...integrationForm, collect_limit: Number(e.target.value) })} /></Field>
                  <Field label="Collect pages"><input type="number" min="1" max="5" value={integrationForm.collect_pages} onChange={(e) => setIntegrationForm({ ...integrationForm, collect_pages: Number(e.target.value) })} /></Field>
                  <Field label="Collect scope"><input value={`${integrationForm.collect_limit || 20} x ${integrationForm.collect_pages || 2}p`} readOnly /></Field>
                </div>
                <Field label="RAG가 볼 대상"><input value={integrationForm.rag_targets} onChange={(e) => setIntegrationForm({ ...integrationForm, rag_targets: e.target.value })} placeholder="issues, commits, pull_requests, notion_pages, notion_database" /></Field>
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
                  <div className="activity-filters">
                    <select value={activityFilters.provider} onChange={(e) => updateActivityFilters({ ...activityFilters, provider: e.target.value })}>
                      <option value="">All providers</option>
                      {[...new Set([...activityProviders, activityFilters.provider].filter(Boolean))].map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                    </select>
                    <select value={activityFilters.status} onChange={(e) => updateActivityFilters({ ...activityFilters, status: e.target.value })}>
                      <option value="">All statuses</option>
                      {activityStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <select value={activityFilters.event_type} onChange={(e) => updateActivityFilters({ ...activityFilters, event_type: e.target.value })}>
                      <option value="">All events</option>
                      {activityEvents.map((eventType) => <option key={eventType} value={eventType}>{eventType}</option>)}
                    </select>
                    <select value={activityFilters.dry_run} onChange={(e) => updateActivityFilters({ ...activityFilters, dry_run: e.target.value })}>
                      <option value="">All write modes</option>
                      <option value="true">Dry-run writes</option>
                      <option value="false">Actual writes</option>
                    </select>
                    <select value={activityFilters.automation_task_id} onChange={(e) => updateActivityFilters({ ...activityFilters, automation_task_id: e.target.value })}>
                      <option value="">All automations</option>
                      {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
                    </select>
                    <select value={activityFilters.integration_profile_id} onChange={(e) => updateActivityFilters({ ...activityFilters, integration_profile_id: e.target.value })}>
                      <option value="">All profiles</option>
                      {integrationProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                  </div>
                  {integrationActivities.map((activity) => (
                    <div key={activity.id} className={`activity-row ${activity.status}`}>
                      <span>{activity.eventType}</span>
                      <span>{activity.provider || "board"}</span>
                      <span>{activity.status}</span>
                      <p>{activity.summary}</p>
                    </div>
                  ))}
                  {activityPage.hasMore ? (
                    <button type="button" className="load-more" onClick={loadMoreActivities}>Load more activity</button>
                  ) : null}
                  {!integrationActivities.length ? <p className="empty-state">No activity matches these filters.</p> : null}
                </div>
                {integrationProfiles.map((profile) => (
                  <div key={profile.id} className="knowledge-item">
                    <strong>{profile.name}</strong>
                    <span>{profile.sourceKind} / {profile.apiProvider} / {profile.aiModel} / token {profile.hasToken ? "저장됨" : "없음"} / {profile.tokenStorage || "empty"}</span>
                    <p>{profile.baseUrl} / RAG: {profile.ragTargets.join(", ") || "미설정"}</p>
                    <div className={`collect-status ${profile.lastCollect?.status || "idle"}`}>
                      <b>최근 수집</b>
                      <span>{profile.lastCollect?.status || "대기"}</span>
                      <span>읽음 {profile.lastCollect?.collected || 0}</span>
                      <span>저장 {profile.lastCollect?.saved || 0}</span>
                      <span>중복 {profile.lastCollect?.skippedDuplicates || 0}</span>
                      <span>범위 {profile.collectLimit || 20} x {profile.collectPages || 2}p</span>
                      {profile.lastCollect?.at ? <span>{profile.lastCollect.at}</span> : null}
                    </div>
                    {profile.lastCollect?.warnings?.length ? <p className="warning-line">{profile.lastCollect.warnings.join(" / ")}</p> : null}
                    <button type="button" onClick={() => collectIntegrationProfile(profile)}><Search size={14} /> RAG 수집 실행</button>
                    {["figma", "google_calendar"].includes(profile.sourceKind) ? (
                      <div className="live-write-controls">
                        <button type="button" onClick={() => writeIntegrationProfile(profile, true)}><Play size={14} /> Dry-run write</button>
                        <input
                          aria-label={`${profile.name} live write confirmation`}
                          value={liveWriteConfirmations[profile.id] || ""}
                          onChange={(e) => setLiveWriteConfirmations({ ...liveWriteConfirmations, [profile.id]: e.target.value })}
                          placeholder="WRITE LIVE"
                        />
                        <button
                          type="button"
                          className="danger-action"
                          disabled={(liveWriteConfirmations[profile.id] || "").trim() !== "WRITE LIVE"}
                          onClick={() => writeIntegrationProfile(profile, false)}
                        >
                          <Play size={14} /> Actual write
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>

            <article id="knowledge" className="panel">
              <div className="panel-title row-title">
                <span>RAG 지식자료</span>
                <span className="subtle">문서, 음성, 이미지, 기타 파일 설명을 사용자별 서버 DB에 저장</span>
              </div>
              <form className="knowledge-form" onSubmit={saveKnowledge}>
                <div className="grid3 wide">
                  <Field label="자료명"><input value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} /></Field>
                  <Field label="자료 종류">
                    <select value={knowledgeForm.source_type} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, source_type: e.target.value })}>
                      <option value="document">문서</option>
                      <option value="audio">음성</option>
                      <option value="image">이미지</option>
                      <option value="video">영상</option>
                      <option value="spreadsheet">표/엑셀</option>
                      <option value="custom">기타</option>
                    </select>
                  </Field>
                  <Field label="태그"><input value={knowledgeForm.tags} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, tags: e.target.value })} placeholder="rag,policy,design" /></Field>
                </div>
                <Field label="어디에 어떻게 작성/사용할지"><textarea value={knowledgeForm.instruction} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, instruction: e.target.value })} placeholder="예: 이 음성 회의록은 GitHub 이슈 요약과 Notion 업무 작성 기준으로 사용" /></Field>
                <Field label="직접 입력할 내용"><textarea value={knowledgeForm.extracted_text} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, extracted_text: e.target.value })} placeholder="문서 내용, 음성 녹취 요약, 이미지 설명, 표의 핵심 값 등을 넣으면 RAG가 검색합니다." /></Field>
                <div className="file-row">
                  <label className="file-picker">
                    <Upload size={14} />
                    파일 선택
                    <input type="file" onChange={(e) => setKnowledgeForm({ ...knowledgeForm, file: e.target.files?.[0] || null })} />
                  </label>
                  <span>{knowledgeForm.file ? `${knowledgeForm.file.name} (${knowledgeForm.file.type || "unknown"})` : "텍스트 파일은 내용을 추출하고, 이미지/음성/PDF는 설명과 지침을 RAG 근거로 저장합니다."}</span>
                  <button><FileText size={14} /> 지식자료 저장</button>
                </div>
              </form>
              <div className="knowledge-list">
                {knowledgeSources.map((source) => (
                  <div key={source.id} className="knowledge-item">
                    <strong>{source.title}</strong>
                    <span>{source.sourceType} / {source.fileName || "직접 입력"} / {source.tags.map((tag) => `#${tag}`).join(" ")}</span>
                    <p>{source.instruction || source.extractedText}</p>
                  </div>
                ))}
              </div>
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
