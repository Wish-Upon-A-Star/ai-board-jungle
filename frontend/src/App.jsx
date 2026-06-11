import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Database, FileText, GitBranch, KeyRound, Link2, LogOut, Play, Plus, Search, Share2, Trash2, Upload, UserPlus, XCircle } from "lucide-react";
import { api, apiStatus } from "./api";
import { customPreset, defaultAutomation, defaultIntegration, defaultKnowledge, figmaCalendarPreset, integrationConnectionPresets, mcpGithubToNotionPreset, mcpNotionToGithubPreset, teamNotionGanttToCalendarPreset } from "./presets";
import { buildSystemReadinessCards, getHealthFailureMessage, getRunStatus, mergePostsById, parseRunResult, summarizeRunResult } from "./viewModel";
import "./style.css";

function Badge({ role }) {
  const admin = role === "ADMIN";
  return <span className={admin ? "role admin" : "role user"}>{admin ? "관리자" : "사용자"}</span>;
}

function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function providerLabel(kind) {
  return ({
    github: "GitHub",
    notion: "Notion",
    figma: "Figma",
    google_calendar: "Google Calendar",
    google: "Google Calendar",
  })[kind] || kind;
}

function renderPostContent(content) {
  const text = String(content || "");
  if (!text.trim()) return <p className="post-paragraph">본문이 비어 있습니다.</p>;
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const lines = block.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    const isCodeLike = lines.some((line) => /^[{\[\]}]|^\s*"/.test(line) || line.includes('":') || line.includes('\\"'));
    const isList = lines.every((line) => /^[-*]\s+/.test(line));
    if (isCodeLike) {
      return <pre key={index} className="post-code-block">{block}</pre>;
    }
    if (isList) {
      return (
        <ul key={index} className="post-bullet-list">
          {lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^[-*]\s+/, "")}</li>)}
        </ul>
      );
    }
    if (lines.length > 1) {
      return (
        <div key={index} className="post-line-group">
          {lines.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}
        </div>
      );
    }
    return <p key={index} className="post-paragraph">{block}</p>;
  });
}

function isAutomationPost(post) {
  const tags = post?.tags?.map((tag) => tag.tag.name.toLowerCase()) || [];
  return Boolean(post?.automationTaskId || tags.includes("automation") || String(post?.title || "").startsWith("[자동화]"));
}

function automationTemplateToForm(template) {
  if (!template) return null;
  return {
    ...defaultAutomation,
    ...template,
    name: `${template.name || defaultAutomation.name} 복사본`,
    integration_profile_id: "",
    api_key_strategy: "내 계정의 연동 프로필/API 키로 다시 선택해서 실행합니다.",
    custom_connections: template.custom_connections || [],
    status: "ACTIVE",
  };
}

const mainTabs = [
  { id: "automations", label: "자동화", description: "만들기, 실행, 공유" },
  { id: "integrations", label: "프로필", description: "계정, 토큰, 연동" },
  { id: "settings", label: "기본 설정", description: "AI 모델, 템플릿" },
  { id: "knowledge", label: "지식자료", description: "RAG 검색 자료" },
  { id: "board", label: "게시판", description: "일반 글과 공유 자동화" },
  { id: "api", label: "점검", description: "상태와 도구 호출" },
];

const templatePresetOptions = [
  { value: "github_notion", label: "GitHub 변경사항 -> Notion BOARD" },
  { value: "team_notion_board_to_github", label: "Notion BOARD 요청 -> GitHub Issue" },
  { value: "team_notion_gantt_to_calendar", label: "Notion GANTT -> Google Calendar" },
  { value: "figma_calendar", label: "Figma 검토 -> Google Calendar" },
  { value: "custom", label: "직접 구성" },
];

const tabIntro = {
  automations: {
    title: "자동화 작업",
    body: "연결된 계정을 선택하고 템플릿을 고른 뒤 저장합니다. 저장된 작업은 직접 실행하거나 주기 실행으로 돌릴 수 있습니다.",
  },
  integrations: {
    title: "프로필",
    body: "GitHub, Notion, Figma, Google Calendar와 API 키를 한 곳에서 연결합니다. 자동화는 여기 저장된 내 프로필을 선택해서 사용합니다.",
  },
  settings: {
    title: "기본 설정",
    body: "새 자동화에 기본으로 들어갈 AI 모델, 템플릿, 출력 양식을 정합니다. 계정 토큰은 프로필 탭에서 관리합니다.",
  },
  knowledge: {
    title: "RAG 지식자료",
    body: "자동화가 참고할 문서와 텍스트를 사용자별로 저장합니다.",
  },
  board: {
    title: "게시판",
    body: "일반 게시글과 공유 자동화를 분리해서 봅니다. 공유 자동화는 내 자동화 폼으로 복사해 적용할 수 있습니다.",
  },
  api: {
    title: "상태 점검",
    body: "서버, RAG, MCP, Agent Hub 호출 결과를 확인합니다. 일반 사용자는 보통 이 탭을 건드릴 필요가 없습니다.",
  },
};

const aiProviderOptions = ["OpenAI", "OpenAI-compatible", "Anthropic", "Google Gemini", "Local"];
const aiModelOptions = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini", "claude-sonnet-4", "gemini-1.5-pro", "local-model"];
const aiApiBaseOptions = ["https://api.openai.com/v1", "https://api.anthropic.com", "https://generativelanguage.googleapis.com/v1beta", "http://localhost:11434/v1"];
const transcriptionModelOptions = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"];
const manualProfileGuides = {
  github: {
    title: "GitHub 수동 연결",
    baseUrl: "https://github.com/Wish-Upon-A-Star/ai-board-jungle 또는 Wish-Upon-A-Star/ai-board-jungle",
    tokenName: "GITHUB_TOKEN",
    tokenHint: "GitHub fine-grained token. 대상 저장소 Issues 읽기/쓰기 권한이 필요합니다.",
    testHint: "저장 후 프로필을 열어 RAG 수집 또는 자동화 실행으로 확인합니다. 401이면 토큰 재발급, 403이면 저장소 권한을 확인하세요.",
  },
  notion: {
    title: "Notion 수동 연결",
    baseUrl: "Notion 페이지/데이터베이스 URL",
    tokenName: "NOTION_TOKEN",
    tokenHint: "Notion internal integration secret. 대상 페이지/DB를 해당 integration에 공유해야 합니다.",
    testHint: "404이면 공유 누락, 401이면 secret 오류입니다. 자동화가 BOARD/GANTT에 쓰려면 Notion URL을 Base URL에 넣으세요.",
  },
  figma: {
    title: "Figma 수동 연결",
    baseUrl: "https://www.figma.com/design/파일키/파일명",
    tokenName: "FIGMA_TOKEN",
    tokenHint: "Figma personal access token. 댓글을 달 파일 접근 권한이 필요합니다.",
    testHint: "저장 후 프로필 카드의 Dry-run으로 댓글 쓰기 준비 상태를 확인하세요.",
  },
  google_calendar: {
    title: "Google Calendar 수동 연결",
    baseUrl: "primary 또는 캘린더 ID",
    tokenName: "GOOGLE_CALENDAR_TOKEN",
    tokenHint: "OAuth access token 또는 refresh token JSON. 일반 사용자는 Google Calendar MCP 로그인을 먼저 쓰는 것이 낫습니다.",
    testHint: "토큰 만료가 잦으면 OAuth 로그인 프로필을 사용하세요. 저장 후 Dry-run으로 일정 쓰기 준비 상태를 확인합니다.",
  },
  custom: {
    title: "Custom API / AI API 키",
    baseUrl: "https://api.openai.com/v1 같은 API 주소",
    tokenName: "OPENAI_API_KEY 또는 AI_API_KEY",
    tokenHint: "OpenAI/호환 API 키는 여기에 붙여 넣으면 사용자별 암호화 저장됩니다.",
    testHint: "OpenAI 음성 전사는 이 프로필을 선택해서 사용합니다. 키는 응답/목록에 다시 노출되지 않습니다.",
  },
};

function AiOptionDatalists() {
  return (
    <>
      <datalist id="ai-provider-options">
        {aiProviderOptions.map((option) => <option key={option} value={option} />)}
      </datalist>
      <datalist id="ai-model-options">
        {aiModelOptions.map((option) => <option key={option} value={option} />)}
      </datalist>
      <datalist id="ai-api-base-options">
        {aiApiBaseOptions.map((option) => <option key={option} value={option} />)}
      </datalist>
    </>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("ai-board-token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "admin@example.com", name: "데모 사용자", password: "password123" });
  const [posts, setPosts] = useState([]);
  const [automationShares, setAutomationShares] = useState([]);
  const [postPage, setPostPage] = useState({ total: 0, limit: 8, offset: 0, nextOffset: 0, hasMore: false });
  const [sharePage, setSharePage] = useState({ total: 0, limit: 8, offset: 0, nextOffset: 0, hasMore: false });
  const [tasks, setTasks] = useState([]);
  const [runHistory, setRunHistory] = useState({});
  const [expandedRuns, setExpandedRuns] = useState({});
  const [retryRunState, setRetryRunState] = useState({});
  const [deleteConfirmTaskId, setDeleteConfirmTaskId] = useState(null);
  const [integrationProfiles, setIntegrationProfiles] = useState([]);
  const [providerReadiness, setProviderReadiness] = useState([]);
  const [healthStatus, setHealthStatus] = useState(null);
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
  const [activeMainTab, setActiveMainTab] = useState("automations");
  const [form, setForm] = useState(defaultAutomation);
  const [knowledgeForm, setKnowledgeForm] = useState(defaultKnowledge);
  const [transcriptionSettings, setTranscriptionSettings] = useState({
    integrationProfileId: "",
    model: "gpt-4o-mini-transcribe",
    prompt: "AI Board 지식자료로 저장할 회의, 업무 메모, 자동화 지시 음성입니다.",
  });
  const [transcriptionState, setTranscriptionState] = useState({ status: "idle", message: "" });
  const [integrationForm, setIntegrationForm] = useState(defaultIntegration);
  const [integrationSaveState, setIntegrationSaveState] = useState({ status: "idle", message: "프로필을 저장하면 자동화에서 선택할 수 있습니다." });
  const [liveWriteConfirmations, setLiveWriteConfirmations] = useState({});
  const [expandedProfiles, setExpandedProfiles] = useState({});
  const [showWriteForm, setShowWriteForm] = useState(false);
  const [boardSubTab, setBoardSubTab] = useState("posts");
  const [expandedTasks, setExpandedTasks] = useState({});
  const [profileSettings, setProfileSettings] = useState(null);
  const [error, setError] = useState("");
  const [validationIssues, setValidationIssues] = useState([]);
  const [oauthSetup, setOauthSetup] = useState(null);
  const [automationSaveState, setAutomationSaveState] = useState({ status: "idle", message: "" });
  const [busyActions, setBusyActions] = useState(new Set());
  const [postSaveState, setPostSaveState] = useState({ status: "idle", message: "" });
  const [knowledgeSaveState, setKnowledgeSaveState] = useState({ status: "idle", message: "" });
  const [deleteConfirmProfileId, setDeleteConfirmProfileId] = useState(null);

  const myTasks = useMemo(() => tasks.filter((task) => task.owner?.id === user?.id), [tasks, user]);
  const sharedCount = automationShares.length;
  const openAiProfiles = useMemo(
    () => integrationProfiles.filter((profile) => {
      const provider = `${profile.aiProvider || ""} ${profile.apiProvider || ""} ${profile.name || ""}`.toLowerCase();
      return provider.includes("openai") && profile.hasToken;
    }),
    [integrationProfiles],
  );
  const selectedAutomationProfile = useMemo(
    () => integrationProfiles.find((profile) => String(profile.id) === String(form.integration_profile_id || "")),
    [integrationProfiles, form.integration_profile_id],
  );
  const systemCards = buildSystemReadinessCards({ providerReadiness, knowledgeSources, tasks, healthStatus });
  const healthFailureMessage = getHealthFailureMessage(healthStatus);
  const readyProviderCount = providerReadiness.filter((provider) => provider.ready).length;
  const manualGuide = manualProfileGuides[integrationForm.source_kind] || manualProfileGuides.custom;

  useEffect(() => {
    loadHealth();
    if (token) loadAll();
  }, [token]);

  function clearErrorState() {
    setError("");
    setValidationIssues([]);
  }

  function showActionError(err) {
    setError(err.message || "요청을 처리하지 못했습니다.");
    setValidationIssues(Array.isArray(err.validationIssues) ? err.validationIssues : []);
  }

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearErrorState, 8000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (postSaveState.status !== "ok") return;
    const timer = setTimeout(() => setPostSaveState({ status: "idle", message: "" }), 4000);
    return () => clearTimeout(timer);
  }, [postSaveState.status]);

  useEffect(() => {
    if (knowledgeSaveState.status !== "ok") return;
    const timer = setTimeout(() => setKnowledgeSaveState({ status: "idle", message: "" }), 4000);
    return () => clearTimeout(timer);
  }, [knowledgeSaveState.status]);

  async function loadHealth() {
    try {
      const health = await apiStatus("/api/health");
      const nextHealth = { status: health.status, ok: health.ok, data: health.data, statusText: health.statusText };
      setHealthStatus(nextHealth);
      return nextHealth;
    } catch (err) {
      const nextHealth = { status: err.status || "error", ok: false, data: err.response || null, statusText: err.message };
      setHealthStatus(nextHealth);
      return nextHealth;
    }
  }

  async function loadActivities(filters = activityFilters, offset = 0, append = false) {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== "" && value !== null && value !== undefined) params.set(key, value);
      });
      params.set("limit", "12");
      params.set("offset", String(offset));
      const data = await api(`/api/integration-activities?${params.toString()}`);
      setActivityPage({ total: data.total, limit: data.limit, offset: data.offset, nextOffset: data.nextOffset, hasMore: data.hasMore });
      setIntegrationActivities((current) => (append ? [...current, ...data.activities] : data.activities));
    } catch (err) {
      showActionError(err);
    }
  }

  async function loadAll(search = q, filters = activityFilters) {
    clearErrorState();
    loadHealth();
    try {
      const activityParams = new URLSearchParams({ limit: "12", offset: "0" });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) activityParams.set(key, value);
      });
      const [me, postData, shareData, taskData, knowledgeData, profileData, readinessData, activityData] = await Promise.all([
        api("/api/auth/me"),
        api(`/api/posts?q=${encodeURIComponent(search)}&kind=board&limit=8&offset=0`),
        api(`/api/posts?q=${encodeURIComponent(search)}&kind=automation&limit=8&offset=0`),
        api("/api/automations"),
        api("/api/knowledge"),
        api("/api/integration-profiles"),
        api("/api/provider-readiness"),
        api(`/api/integration-activities?${activityParams.toString()}`),
      ]);
      setUser(me.user);
      setProfileSettings(me.profileSettings);
      setPosts(postData.posts);
      setAutomationShares(shareData.posts);
      setPostPage({ total: postData.total, limit: postData.limit, offset: postData.offset, nextOffset: postData.nextOffset, hasMore: postData.hasMore });
      setSharePage({ total: shareData.total, limit: shareData.limit, offset: shareData.offset, nextOffset: shareData.nextOffset, hasMore: shareData.hasMore });
      setTasks(taskData.tasks);
      setKnowledgeSources(knowledgeData.sources);
      setIntegrationProfiles(profileData.profiles);
      setProviderReadiness(readinessData.providers);
      setIntegrationActivities(activityData.activities);
      setActivityPage({ total: activityData.total, limit: activityData.limit, offset: activityData.offset, nextOffset: activityData.nextOffset, hasMore: activityData.hasMore });
      setSelected((current) => postData.posts.find((post) => post.id === current?.id) || postData.posts[0] || null);
    } catch (err) {
      showActionError(err);
    }
  }

  async function loadMorePosts() {
    setBusy("more-posts");
    try {
      const data = await api(`/api/posts?q=${encodeURIComponent(q)}&kind=board&limit=${postPage.limit}&offset=${postPage.nextOffset}`);
      setPosts((current) => mergePostsById(current, data.posts));
      setPostPage({ total: data.total, limit: data.limit, offset: data.offset, nextOffset: data.nextOffset, hasMore: data.hasMore });
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy("more-posts");
    }
  }

  async function loadMoreShares() {
    setBusy("more-shares");
    try {
      const data = await api(`/api/posts?q=${encodeURIComponent(q)}&kind=automation&limit=${sharePage.limit}&offset=${sharePage.nextOffset}`);
      setAutomationShares((current) => mergePostsById(current, data.posts));
      setSharePage({ total: data.total, limit: data.limit, offset: data.offset, nextOffset: data.nextOffset, hasMore: data.hasMore });
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy("more-shares");
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    clearErrorState();
    try {
      const path = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = authMode === "register" ? authForm : { email: authForm.email, password: authForm.password };
      const data = await api(path, { method: "POST", body: JSON.stringify(body) });
      localStorage.setItem("ai-board-token", data.token);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      showActionError(err);
    }
  }

  async function demoLogin(email) {
    clearErrorState();
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
      localStorage.setItem("ai-board-token", data.token);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      showActionError(err);
    }
  }

  function logout() {
    localStorage.removeItem("ai-board-token");
    setToken("");
    setUser(null);
  }

  async function createAutomation(event) {
    event.preventDefault();
    clearErrorState();
    setAutomationSaveState({ status: "saving", message: "자동화를 저장하는 중입니다." });
    try {
      const payload = { ...form, interval_minutes: Number(form.interval_minutes), integration_profile_id: form.integration_profile_id ? Number(form.integration_profile_id) : null };
      const data = await api("/api/automations", { method: "POST", body: JSON.stringify(payload) });
      setResult(data.plan);
      setApiResult({ called: "automation.create", response: data });
      setAutomationSaveState({ status: "ok", message: `자동화가 저장되었습니다: ${data.task.name}` });
      await loadAll();
    } catch (err) {
      showActionError(err);
      setAutomationSaveState({ status: "error", message: err.message || "자동화 저장에 실패했습니다." });
    }
  }

  async function runTask(task) {
    setBusy(`run:${task.id}`);
    try {
      const data = await api(`/api/automations/${task.id}/run`, { method: "POST" });
      setResult(data.run.result);
      setApiResult({ called: "automation.run", response: data });
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy(`run:${task.id}`);
    }
  }

  async function retryTaskFromRun(task, run) {
    const key = `${task.id}:${run.id}`;
    setRetryRunState((current) => ({ ...current, [key]: { status: "running", message: "재실행 중" } }));
    try {
      await runTask(task);
      await loadTaskRuns(task);
      setRetryRunState((current) => ({ ...current, [key]: { status: "ok", message: "재실행 완료" } }));
    } catch (err) {
      setRetryRunState((current) => ({ ...current, [key]: { status: "error", message: err.message || "재실행 실패" } }));
    }
  }

  async function shareTask(task) {
    setBusy(`share:${task.id}`);
    try {
      const data = await api(`/api/automations/${task.id}/share`, { method: "POST" });
      setAutomationShares((current) => mergePostsById([data.post, ...current], current));
      setApiResult({ called: "automation.share", response: data });
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy(`share:${task.id}`);
    }
  }

  function applySharedAutomation(post) {
    const copied = automationTemplateToForm(post.automationTemplate);
    if (!copied) {
      setError("공유 자동화 템플릿을 찾을 수 없습니다. 원본 자동화가 삭제되었을 수 있습니다.");
      return;
    }
    setForm(copied);
    setAutomationSaveState({ status: "idle", message: "공유 자동화를 내 자동화 폼에 복사했습니다. 내 계정 연동 프로필을 선택한 뒤 저장하세요." });
    setActiveMainTab("automations");
    window.setTimeout(() => document.getElementById("new-task")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function deleteTask(task) {
    setBusy(`delete:${task.id}`);
    try {
      await api(`/api/automations/${task.id}`, { method: "DELETE" });
      setDeleteConfirmTaskId(null);
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy(`delete:${task.id}`);
    }
  }

  async function schedulerTick() {
    setBusy("scheduler");
    try {
      const data = await api("/api/automations/scheduler/tick", { method: "POST" });
      setApiResult({ called: "scheduler.tick", response: data });
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy("scheduler");
    }
  }

  async function loadTaskRuns(task, offset = 0, append = false) {
    setBusy(`runs:${task.id}`);
    try {
      const data = await api(`/api/automations/${task.id}/runs?limit=5&offset=${offset}`);
      setRunHistory((current) => ({
        ...current,
        [task.id]: { ...data, runs: append ? [...(current[task.id]?.runs || []), ...data.runs] : data.runs, loadedAt: new Date().toLocaleTimeString() },
      }));
      setApiResult({ called: "automation.runs", response: data });
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy(`runs:${task.id}`);
    }
  }

  async function callApiDemo(kind) {
    clearErrorState();
    try {
      if (kind === "health") {
        const health = await apiStatus("/api/health");
        const payload = { status: health.status, ok: health.ok, response: health.data };
        setHealthStatus({ status: health.status, ok: health.ok, data: health.data, statusText: health.statusText });
        setApiResult({ called: kind, response: payload });
        setResult(payload);
        if (!health.ok) setError(health.data?.database?.error || health.statusText || "Health check failed.");
        return;
      }
      let data;
      if (kind === "rag") data = await api("/api/knowledge/rag", { method: "POST", body: JSON.stringify({ question: apiPrompt }) });
      if (kind === "mcp") data = await api("/mcp/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "automation.describe", params: {} }) });
      if (kind === "hub") data = await api("/api/integrations/hub/run", { method: "POST", body: JSON.stringify({ instruction: apiPrompt }) });
      setApiResult({ called: kind, response: data });
      setResult(data);
    } catch (err) {
      showActionError(err);
      const payload = { status: err.status || "error", message: err.message, response: err.response || null };
      setApiResult({ called: kind, response: payload });
      setResult(payload);
    }
  }

  async function createPost(event) {
    event.preventDefault();
    clearErrorState();
    setPostSaveState({ status: "saving", message: "게시글을 저장하는 중입니다." });
    try {
      const data = await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title: event.currentTarget.title.value, content: event.currentTarget.content.value, tags: event.currentTarget.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean) }),
      });
      setSelected(data.post);
      event.currentTarget.reset();
      setPostSaveState({ status: "ok", message: "게시글이 작성되었습니다." });
      await loadAll();
    } catch (err) {
      showActionError(err);
      setPostSaveState({ status: "error", message: err.message || "게시글 작성에 실패했습니다." });
    }
  }

  async function saveKnowledge(event) {
    event.preventDefault();
    clearErrorState();
    setKnowledgeSaveState({ status: "saving", message: "지식자료를 저장하는 중입니다." });
    try {
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
      setKnowledgeSaveState({ status: "ok", message: `"${data.source?.title || "자료"}"가 저장되었습니다.` });
      await loadAll();
    } catch (err) {
      showActionError(err);
      setKnowledgeSaveState({ status: "error", message: err.message || "저장에 실패했습니다." });
    }
  }

  async function transcribeKnowledgeAudio(file) {
    if (!file) return;
    clearErrorState();
    const selectedProfileId = transcriptionSettings.integrationProfileId || (openAiProfiles[0]?.id ? String(openAiProfiles[0].id) : "");
    setTranscriptionState({ status: "saving", message: "선택한 OpenAI API 키로 음성을 전사하는 중입니다." });
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("model", transcriptionSettings.model || "gpt-4o-mini-transcribe");
      body.set("prompt", transcriptionSettings.prompt || "AI Board 지식자료로 저장할 회의, 업무 메모, 자동화 지시 음성입니다.");
      if (selectedProfileId) body.set("integration_profile_id", selectedProfileId);
      const data = await api("/api/ai/transcribe", { method: "POST", body });
      const audioTitle = file.name.replace(/\.[^.]+$/, "") || "음성 전사";
      const transcript = data.text || "";
      setKnowledgeForm((current) => ({
        ...current,
        title: !current.title || current.title === defaultKnowledge.title ? audioTitle : current.title,
        source_type: "audio",
        extracted_text: [current.extracted_text, transcript].filter(Boolean).join("\n\n"),
        tags: current.tags || "audio,transcription,openai",
      }));
      setApiResult({ called: "ai.transcribe", response: { ...data, text: transcript.slice(0, 500) } });
      setTranscriptionState({ status: "ok", message: `"${file.name}" 전사 완료. ${data.integrationProfileName || "OpenAI"} / ${data.model} 결과를 확인한 뒤 자료 저장을 누르세요.` });
    } catch (err) {
      showActionError(err);
      setTranscriptionState({ status: "error", message: err.message || "음성 전사에 실패했습니다." });
    }
  }

  async function saveIntegrationProfile(event) {
    event.preventDefault();
    clearErrorState();
    setIntegrationSaveState({ status: "saving", message: "프로필을 저장하는 중입니다." });
    try {
      const body = {
        ...integrationForm,
        collect_limit: Number(integrationForm.collect_limit) || 20,
        collect_pages: Number(integrationForm.collect_pages) || 2,
        rag_targets: integrationForm.rag_targets.split(",").map((item) => item.trim()).filter(Boolean),
        mcp_scopes: (integrationForm.mcp_scopes || "").split(",").map((item) => item.trim()).filter(Boolean),
        custom_connections: integrationForm.custom_connections || [],
      };
      const data = await api("/api/integration-profiles", { method: "POST", body: JSON.stringify(body) });
      setApiResult({ called: "integration-profile.save", response: data });
      setIntegrationForm({ ...defaultIntegration, token_value: "" });
      setIntegrationSaveState({ status: "saved", message: "프로필을 저장했습니다. 자동화 탭에서 이 프로필을 선택해 실행하세요." });
      await loadAll();
    } catch (err) {
      setIntegrationSaveState({ status: "error", message: err.message || "프로필 저장에 실패했습니다." });
      showActionError(err);
    }
  }

  function addIntegrationConnection(kind = "custom") {
    const preset = integrationConnectionPresets[kind] || integrationConnectionPresets.custom;
    setIntegrationForm((current) => ({
      ...current,
      custom_connections: [...(current.custom_connections || []), { ...preset }],
    }));
  }

  function updateIntegrationConnection(index, field, value) {
    setIntegrationForm((current) => ({
      ...current,
      custom_connections: (current.custom_connections || []).map((connection, currentIndex) =>
        currentIndex === index ? { ...connection, [field]: value } : connection
      ),
    }));
  }

  function removeIntegrationConnection(index) {
    setIntegrationForm((current) => ({
      ...current,
      custom_connections: (current.custom_connections || []).filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function addProfileConnection(kind = "custom") {
    const preset = integrationConnectionPresets[kind] || integrationConnectionPresets.custom;
    setProfileSettings((current) => ({
      ...current,
      customConnections: [...(current?.customConnections || []), { ...preset }],
    }));
  }

  function updateProfileConnection(index, field, value) {
    setProfileSettings((current) => ({
      ...current,
      customConnections: (current?.customConnections || []).map((connection, currentIndex) =>
        currentIndex === index ? { ...connection, [field]: value } : connection
      ),
    }));
  }

  function removeProfileConnection(index) {
    setProfileSettings((current) => ({
      ...current,
      customConnections: (current?.customConnections || []).filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  async function saveProfileSettings(event) {
    event.preventDefault();
    clearErrorState();
    setBusy("profile-settings");
    try {
      const body = {
        ai_provider: profileSettings?.aiProvider || "OpenAI",
        ai_model: profileSettings?.aiModel || "gpt-4o-mini",
        ai_api_base: profileSettings?.aiApiBase || "https://api.openai.com/v1",
        api_key_strategy: profileSettings?.apiKeyStrategy || "사용자별 환경변수 또는 서버 비밀 저장소에 보관",
        template_preset: profileSettings?.templatePreset || "github_notion",
        custom_template: profileSettings?.customTemplate || "",
        custom_connections: profileSettings?.customConnections || [],
      };
      const data = await api("/api/profile/settings", { method: "PUT", body: JSON.stringify(body) });
      setProfileSettings(data.profileSettings);
      setApiResult({ called: "profile-settings.save", response: data });
      setResult(data.profileSettings);
      setAutomationSaveState({ status: "ok", message: "기본 설정이 저장되었습니다." });
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy("profile-settings");
    }
  }

  async function collectIntegrationProfile(profile) {
    setBusy(`collect:${profile.id}`);
    try {
      const data = await api(`/api/integration-profiles/${profile.id}/collect`, { method: "POST" });
      setApiResult({ called: "integration-profile.collect", response: data });
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy(`collect:${profile.id}`);
    }
  }

  async function deleteIntegrationProfile(profile) {
    setBusy(`delete-profile:${profile.id}`);
    try {
      await api(`/api/integration-profiles/${profile.id}`, { method: "DELETE" });
      setDeleteConfirmProfileId(null);
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy(`delete-profile:${profile.id}`);
    }
  }

  async function writeIntegrationProfile(profile, dryRun = true) {
    setBusy(`write:${profile.id}:${dryRun}`);
    try {
      const confirmation = liveWriteConfirmations[profile.id] || "";
      const data = await api(`/api/integration-profiles/${profile.id}/write`, {
        method: "POST",
        body: JSON.stringify({ title: `AI Board ${profile.sourceKind} ${dryRun ? "write check" : "live write"}`, body: `${dryRun ? "Dry-run" : "Actual write"} from ${profile.name}.`, dry_run: dryRun, confirmation }),
      });
      setApiResult({ called: "integration-profile.write", response: data });
      await loadAll();
    } catch (err) {
      showActionError(err);
    } finally {
      clearBusy(`write:${profile.id}:${dryRun}`);
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
      source: selectedProfile.sourceKind,
      destination: selectedProfile.sourceKind === "github" ? "Notion Tasks DB" : selectedProfile.sourceKind,
      api_provider: selectedProfile.apiProvider,
      ai_provider: selectedProfile.aiProvider,
      ai_model: selectedProfile.aiModel,
      ai_api_base: selectedProfile.aiApiBase || form.ai_api_base,
      custom_template: selectedProfile.customTemplate || form.custom_template,
    });
  }

  function mcpProfilesFor(kind) {
    return integrationProfiles.filter((profile) => profile.sourceKind === kind && String(profile.authType || "").toLowerCase().includes("mcp"));
  }

  function openMcpProfileSetup(kind = "github") {
    const defaults = {
      github: {
        name: "GitHub MCP profile",
        base_url: "https://github.com/<owner>/<repo>",
        api_provider: "GitHub MCP",
        token_name: "GITHUB_MCP_TOKEN",
        mcp_server_url: "mcp://github",
        mcp_scopes: "repo.read, commits.read, issues.write",
        rag_targets: "commits,issues,pull_requests",
      },
      notion: {
        name: "Notion MCP profile",
        base_url: "https://www.notion.so/<workspace>/<page-or-database-id>",
        api_provider: "Notion MCP",
        token_name: "NOTION_MCP_TOKEN",
        mcp_server_url: "mcp://notion",
        mcp_scopes: "page.read, page.write, database.read, database.write",
        rag_targets: "notion_pages,notion_database",
      },
      figma: {
        name: "Figma MCP profile",
        base_url: "https://www.figma.com/design/<fileKey>/<fileName>",
        api_provider: "Figma MCP",
        token_name: "FIGMA_MCP_TOKEN",
        mcp_server_url: "mcp://figma",
        mcp_scopes: "file_read, file_write",
        rag_targets: "figma_files,figma_comments",
      },
      google_calendar: {
        name: "Google Calendar MCP profile",
        base_url: "primary",
        api_provider: "Google Calendar MCP",
        token_name: "GOOGLE_CALENDAR_MCP_TOKEN",
        mcp_server_url: "mcp://google-calendar",
        mcp_scopes: "calendar.events",
        rag_targets: "calendar_events",
      },
    };
    const config = defaults[kind] || defaults.github;
    setActiveMainTab("integrations");
    setIntegrationForm({
      ...defaultIntegration,
      name: config.name,
      source_kind: kind,
      base_url: config.base_url,
      api_provider: config.api_provider,
      token_name: config.token_name,
      token_value: "",
      auth_type: "mcp_oauth",
      mcp_server_url: config.mcp_server_url,
      mcp_auth_subject: user?.email || "",
      mcp_scopes: config.mcp_scopes,
      rag_targets: config.rag_targets,
    });
    setAutomationSaveState({ status: "error", message: `Create a ${providerLabel(kind)} MCP profile first, then return to the Automation tab.` });
  }

  function openAiKeyProfileSetup(provider = "openai") {
    const defaults = {
      openai: {
        name: "OpenAI API 키",
        ai_provider: "OpenAI",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
        token_name: "OPENAI_API_KEY",
        api_provider: "OpenAI API",
      },
      anthropic: {
        name: "Anthropic API 키",
        ai_provider: "Anthropic",
        ai_model: "claude-sonnet-4",
        ai_api_base: "https://api.anthropic.com",
        token_name: "ANTHROPIC_API_KEY",
        api_provider: "Anthropic API",
      },
      gemini: {
        name: "Google Gemini API 키",
        ai_provider: "Google Gemini",
        ai_model: "gemini-1.5-pro",
        ai_api_base: "https://generativelanguage.googleapis.com/v1beta",
        token_name: "GEMINI_API_KEY",
        api_provider: "Google Gemini API",
      },
      compatible: {
        name: "OpenAI 호환 API 키",
        ai_provider: "OpenAI-compatible",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
        token_name: "AI_API_KEY",
        api_provider: "OpenAI-compatible API",
      },
    };
    const selected = defaults[provider] || defaults.openai;
    setActiveMainTab("integrations");
    setIntegrationForm({
      ...defaultIntegration,
      name: selected.name,
      source_kind: "custom",
      base_url: selected.ai_api_base,
      api_provider: selected.api_provider,
      token_name: selected.token_name,
      token_value: "",
      auth_type: "api_key",
      mcp_server_url: "",
      mcp_auth_subject: "",
      mcp_scopes: "",
      ai_provider: selected.ai_provider,
      ai_model: selected.ai_model,
      ai_api_base: selected.ai_api_base,
      rag_targets: "ai",
      collect_limit: 20,
      collect_pages: 1,
      custom_template: "AI 응답 템플릿",
      custom_connections: [],
    });
    setIntegrationSaveState({ status: "saved", message: `${selected.name} 프로필을 채웠습니다. 토큰/API Key 칸에 본인 키를 직접 넣고 저장하세요.` });
    window.setTimeout(() => {
      document.getElementById("profile-manual-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  async function startMcpLogin(kind = "github") {
    clearErrorState();
    setActiveMainTab("integrations");
    try {
      const data = await api(`/api/oauth/${kind}/start`);
      setApiResult({ called: `oauth.${kind}.start`, response: data });
      if (!data.authorizeUrl) {
        setOauthSetup(data);
        setError(data.message || `${kind} MCP 로그인 설정이 필요합니다.`);
        return;
      }
      window.location.href = data.authorizeUrl;
    } catch (err) {
      showActionError(err);
      setApiResult({ called: `oauth.${kind}.start`, response: err.response || { message: err.message } });
    }
  }

  function applyMcpAutomationPreset(preset, primaryKind) {
    const githubProfiles = mcpProfilesFor("github");
    const notionProfiles = mcpProfilesFor("notion");
    if (!githubProfiles.length) return openMcpProfileSetup("github");
    if (!notionProfiles.length) return openMcpProfileSetup("notion");
    const primaryProfile = primaryKind === "notion" ? notionProfiles[0] : githubProfiles[0];
    setActiveMainTab("automations");
    setForm({ ...preset, integration_profile_id: primaryProfile.id });
    setAutomationSaveState({ status: "idle", message: `MCP template loaded with ${primaryProfile.name}.` });
  }

  function applyProfileDefaultsToAutomation() {
    const connections = profileSettings?.customConnections || [];
    const firstConnection = connections[0];
    setForm((current) => ({
      ...current,
      integration_profile_id: "",
      ai_provider: profileSettings?.aiProvider || current.ai_provider,
      ai_model: profileSettings?.aiModel || current.ai_model,
      ai_api_base: profileSettings?.aiApiBase || current.ai_api_base,
      api_key_strategy: profileSettings?.apiKeyStrategy || current.api_key_strategy,
      template_preset: profileSettings?.templatePreset || current.template_preset,
      custom_template: profileSettings?.customTemplate || current.custom_template,
      api_provider: firstConnection?.api || current.api_provider,
      custom_connections: connections.map((connection) => ({ ...connection })),
    }));
  }

  function updateActivityFilters(nextFilters) {
    setActivityFilters(nextFilters);
    loadActivities(nextFilters, 0, false);
  }

  function setBusy(key) { setBusyActions((s) => new Set([...s, key])); }
  function clearBusy(key) { setBusyActions((s) => { const n = new Set(s); n.delete(key); return n; }); }
  function isBusy(key) { return busyActions.has(key); }

  if (!token || !user) {
    return (
      <main className="login-page">
        <section className="login-box">
          <div className="wordmark">AI<span>/</span>BOARD<span>&gt;</span></div>
          <p>GitHub, Notion, Figma, Google Calendar 자동화를 중심으로 한 AI 게시판입니다.</p>
          {healthFailureMessage ? (
            <div className="health-alert">
              <strong>Server health check failed</strong>
              <span>{healthFailureMessage}</span>
            </div>
          ) : null}
          <div className="auth-tabs">
            <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>로그인</button>
            <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>회원가입</button>
          </div>
          <form className="auth-form" onSubmit={submitAuth}>
            <input type="email" autoComplete="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="이메일" aria-label="이메일" required />
            {authMode === "register" ? <input type="text" autoComplete="name" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} placeholder="이름" aria-label="이름" required /> : null}
            <input type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="비밀번호" aria-label="비밀번호" required />
            <button>{authMode === "register" ? <UserPlus size={14} /> : null}{authMode === "register" ? "계정 만들기" : "로그인"}</button>
          </form>
          <div className="demo-actions">
            <button type="button" onClick={() => demoLogin("admin@example.com")}>관리자 데모</button>
            <button type="button" onClick={() => demoLogin("user@example.com")}>일반 사용자 데모</button>
          </div>
          {error && <p className="error">{error}</p>}
          <small>일반 사용자는 자기 자동화만 보고, 관리자는 전체 작업을 볼 수 있습니다.</small>
        </section>
      </main>
    );
  }

  return (
    <div className="page">
      <a className="skip-link" href="#workspace">본문으로 바로가기</a>
      <header className="site-header">
        <div className="brand-block">
          <div className="wordmark">AI<span>/</span>BOARD<span>&gt;</span></div>
          <span>팀 자동화 작업대</span>
        </div>
        <nav aria-label="주요 작업 탭" role="tablist">
          {mainTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeMainTab === tab.id}
              aria-controls={`${tab.id}-panel`}
              aria-label={`${tab.label}: ${tab.description}`}
              className={activeMainTab === tab.id ? "active" : ""}
              title={tab.description}
              onClick={() => setActiveMainTab(tab.id)}
            >
              <span>{tab.label}</span>
              <small aria-hidden="true">{tab.description}</small>
            </button>
          ))}
        </nav>
        <div className="user-menu" aria-label="현재 사용자">{user.email} <Badge role={user.role} /> <button type="button" onClick={logout} aria-label="로그아웃"><LogOut size={13} /> 로그아웃</button></div>
      </header>
      <AiOptionDatalists />

      <main id="workspace" className="container">
        <section className="profile-head">
          <div className={user.role === "ADMIN" ? "avatar admin" : "avatar user"}>{user.role === "ADMIN" ? "A" : "U"}</div>
          <div>
            <h1>{user.name}</h1>
            <p><Badge role={user.role} /> 사용자별 연동 프로필, API 토큰, AI 모델, RAG 지식자료를 서버에 저장하고 자동화마다 선택합니다.</p>
          </div>
        </section>

        <section className={`workspace-intro ${activeMainTab === "automations" ? "" : "single"}`} aria-label="현재 탭 안내">
          <div className="intro-copy">
            <span className="eyebrow">현재 탭</span>
            <h2>{tabIntro[activeMainTab].title}</h2>
            <p>{tabIntro[activeMainTab].body}</p>
          </div>
          {activeMainTab === "automations" ? <div className="next-steps" aria-label="기본 사용 순서">
            <button type="button" onClick={() => setActiveMainTab("integrations")} className={activeMainTab === "integrations" ? "active" : ""}>
              <KeyRound size={15} />
              <span><b>1. 프로필 연결</b><small>계정과 API 키 등록</small></span>
            </button>
            <button type="button" onClick={() => setActiveMainTab("automations")} className={activeMainTab === "automations" ? "active" : ""}>
              <CalendarClock size={15} />
              <span><b>2. 자동화 만들기</b><small>템플릿 선택 후 저장</small></span>
            </button>
            <button type="button" onClick={() => setActiveMainTab("board")} className={activeMainTab === "board" ? "active" : ""}>
              <Share2 size={15} />
              <span><b>3. 결과 확인</b><small>공유 자동화와 글 확인</small></span>
            </button>
          </div> : null}
        </section>

        {error && (
          <div className="top-error">
            <div className="top-error-head">
              <strong>{error}</strong>
              <button type="button" className="error-dismiss" onClick={clearErrorState} aria-label="오류 닫기">✕</button>
            </div>
            {validationIssues.length ? (
              <ul className="validation-list">
                {validationIssues.map((issue, index) => <li key={`${issue.field}:${index}`}><b>{issue.field}</b><span>{issue.message}</span></li>)}
              </ul>
            ) : null}
          </div>
        )}

        <div className={`layout ${activeMainTab === "automations" ? "with-stats" : "focus-layout"} ${activeMainTab === "api" ? "with-result" : ""}`}>
          {activeMainTab === "automations" ? <aside className="stats" aria-label="내 작업 요약">
            <dl>
              <div><dt>내 작업</dt><dd>{myTasks.length}</dd></div>
              <div><dt>전체 작업</dt><dd>{tasks.length}</dd></div>
              <div><dt>공유 자동화</dt><dd className="green">{sharedCount}</dd></div>
              <div><dt>연결 준비</dt><dd className="green">{readyProviderCount}/{providerReadiness.length || 4}</dd></div>
              <div><dt>AI 모델</dt><dd className="green">{form.ai_model}</dd></div>
              <div><dt>연동 프로필</dt><dd className="green">{integrationProfiles.length}</dd></div>
              <div><dt>지식자료</dt><dd className="green">{knowledgeSources.length}</dd></div>
            </dl>
          </aside> : null}

          <section className="main-column">
            <article className={`panel ${activeMainTab === "api" ? "" : "tab-hidden"}`}>
              <div className="panel-title row-title">
                <span>시스템 준비 상태</span>
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

            <article id="automations-panel" className={`panel ${activeMainTab === "automations" ? "" : "tab-hidden"}`}>
              <div className="automation-list-header">
                <div>
                  <h2>⚡ 저장된 자동화</h2>
                  <p className="muted">연결된 서비스 간 데이터를 AI가 자동으로 읽고 정리해 줍니다.</p>
                </div>
                <button type="button" onClick={schedulerTick} disabled={isBusy("scheduler")} className="secondary scheduler-btn">
                  <CalendarClock size={14} /> {isBusy("scheduler") ? "확인 중…" : "예약 실행 확인"}
                </button>
              </div>

              {tasks.length === 0 ? (
                <div className="automation-empty">
                  <div className="automation-empty-icon">⚡</div>
                  <h3>아직 자동화가 없습니다</h3>
                  <p>아래 <b>자동화 등록</b> 패널에서 템플릿을 골라 첫 번째 자동화를 만들어보세요.</p>
                  <div className="automation-empty-steps">
                    <div className="step"><span>1</span><b>프로필 선택</b><small>연결할 GitHub/Notion 계정</small></div>
                    <div className="step"><span>2</span><b>템플릿 선택</b><small>어떤 흐름으로 자동화할지</small></div>
                    <div className="step"><span>3</span><b>저장 & 실행</b><small>주기 실행 또는 즉시 실행</small></div>
                  </div>
                </div>
              ) : (
                <div className="task-list">
                  {tasks.map((task) => {
                    const runStatus = getRunStatus(task.lastResult);
                    const isExpanded = expandedTasks?.[task.id];
                    return (
                      <section key={task.id} className="task-card-v2">
                        <div className="task-card-main" onClick={() => setExpandedTasks((p) => ({ ...p, [task.id]: !p?.[task.id] }))}>
                          <div className="task-card-left">
                            <div className="task-card-title-row">
                              <h3>{task.name}</h3>
                              <Badge role={task.owner.role} />
                            </div>
                            <div className="task-card-flow">
                              <span className="task-source">{task.source}</span>
                              <span className="task-arrow">→</span>
                              <span className="task-dest">{task.destination}</span>
                            </div>
                            <div className="task-profile-line">
                              <KeyRound size={13} />
                              {task.integrationProfile
                                ? `${task.integrationProfile.name} · ${task.integrationProfile.hasToken ? "토큰 연결됨" : "토큰 없음"} · ${task.integrationProfile.tokenStorage || "저장 방식 미확인"}`
                                : "커스텀 설정 · 실행 전 프로필/토큰 확인 필요"}
                            </div>
                          </div>
                          <div className="task-card-right">
                            <span className={`run-pill ${runStatus}`}>{runStatus === "ok" ? "✅ 성공" : runStatus === "error" ? "❌ 오류" : runStatus === "running" ? "⏳ 실행 중" : "— 미실행"}</span>
                            <span className="task-interval">⏰ {task.intervalMinutes}분</span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="task-card-detail">
                            <div className="task-detail-meta">
                              <span><b>소유자</b> {task.owner.name} ({task.owner.email})</span>
                              <span><b>AI</b> {task.aiProvider} / {task.aiModel}</span>
                              <span><b>연동 프로필</b> {task.integrationProfile ? task.integrationProfile.name : "커스텀"}</span>
                              <span><b>템플릿</b> {task.templatePreset || "github_notion"}</span>
                            </div>
                            <div className="task-actions">
                              <button onClick={() => runTask(task)} disabled={isBusy(`run:${task.id}`)}><Play size={14} /> {isBusy(`run:${task.id}`) ? "실행 중…" : "지금 실행"}</button>
                              <button onClick={() => shareTask(task)} className="secondary" disabled={isBusy(`share:${task.id}`)}><Share2 size={14} /> {isBusy(`share:${task.id}`) ? "등록 중…" : "게시판에 공유"}</button>
                              <button onClick={() => loadTaskRuns(task)} className="secondary" disabled={isBusy(`runs:${task.id}`)}><Database size={14} /> {isBusy(`runs:${task.id}`) ? "불러오는 중…" : "실행 기록"}</button>
                              {deleteConfirmTaskId === task.id ? (
                                <>
                                  <button onClick={() => deleteTask(task)} className="danger confirm-delete" disabled={isBusy(`delete:${task.id}`)}><Trash2 size={14} /> {isBusy(`delete:${task.id}`) ? "삭제 중…" : "삭제 확정"}</button>
                                  <button onClick={() => setDeleteConfirmTaskId(null)} className="secondary">취소</button>
                                </>
                              ) : (
                                <button onClick={() => setDeleteConfirmTaskId(task.id)} className="danger"><Trash2 size={14} /> 삭제</button>
                              )}
                            </div>
                            {runHistory[task.id] && (
                              <div className="run-history">
                                <div className="run-history-head"><strong>실행 기록</strong><span>{runHistory[task.id].runs.length} / {runHistory[task.id].total}건 · {runHistory[task.id].loadedAt} 갱신</span></div>
                                {runHistory[task.id].runs.map((run) => {
                                  const key = `${task.id}:${run.id}`;
                                  const expanded = expandedRuns[key];
                                  const retryState = retryRunState[key];
                                  const status = getRunStatus(run.result);
                                  return (
                                    <div key={run.id} className={`run-row ${status}`}>
                                      <div className="run-row-main">
                                        <span>#{run.id}</span>
                                        <span>{run.createdAt}</span>
                                        <span className={`run-status ${status}`}>{status}</span>
                                        <p>{summarizeRunResult(run.result)}</p>
                                        <button type="button" className="inline-link retry" disabled={retryState?.status === "running"} onClick={() => retryTaskFromRun(task, run)}>{retryState?.status === "running" ? "재실행 중" : "재실행"}</button>
                                        <button type="button" className="inline-link" onClick={() => setExpandedRuns((c) => ({ ...c, [key]: !c[key] }))}>{expanded ? "접기" : "상세"}</button>
                                      </div>
                                      {retryState?.message ? <div className={`run-retry-message ${retryState.status}`}>{retryState.message}</div> : null}
                                      {expanded ? <pre className="run-json">{JSON.stringify(parseRunResult(run.result), null, 2)}</pre> : null}
                                    </div>
                                  );
                                })}
                                {runHistory[task.id].hasMore ? <button className="load-more" onClick={() => loadTaskRuns(task, runHistory[task.id].nextOffset, true)} disabled={isBusy(`runs:${task.id}`)}>{isBusy(`runs:${task.id}`) ? "불러오는 중…" : "더 보기"}</button> : null}
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </article>

            <article id="new-task" className={`panel ${activeMainTab === "automations" ? "" : "tab-hidden"}`}>
              <div className="panel-title row-title">
                <span>➕ 자동화 등록</span>
                <span className="subtle">①템플릿 선택 → ②프로필 연결 → ③저장</span>
              </div>
              <form className="automation-form" onSubmit={createAutomation}>

                {/* ① 템플릿 선택 */}
                <div className="form-section">
                  <div className="form-section-head">
                    <span className="form-section-num">1</span>
                    <div><strong>템플릿 선택</strong><small>어떤 자동화를 만들지 고르면 아래 칸이 자동 입력됩니다.</small></div>
                  </div>
                  <div className="preset-cards">
                    {[
                      { label: "GitHub → Notion", desc: "이슈·커밋을 Notion 보드에 정리", action: () => applyMcpAutomationPreset(mcpGithubToNotionPreset, "github"), icon: "🐙" },
                      { label: "Notion → GitHub", desc: "Notion 요청 카드를 GitHub 이슈로", action: () => applyMcpAutomationPreset(mcpNotionToGithubPreset, "notion"), icon: "📝" },
                      { label: "Notion GANTT → Calendar", desc: "간트 일정을 Google Calendar에 등록", action: () => setForm(teamNotionGanttToCalendarPreset), icon: "📅" },
                      { label: "Figma → Calendar", desc: "디자인 검토 일정을 캘린더에 추가", action: () => setForm(figmaCalendarPreset), icon: "🎨" },
                      { label: "커스텀 API", desc: "직접 연결 설정", action: () => setForm(customPreset), icon: "🔧" },
                    ].map((preset) => (
                      <button key={preset.label} type="button" className="preset-card" onClick={preset.action}>
                        <span className="preset-icon">{preset.icon}</span>
                        <span className="preset-card-label">{preset.label}</span>
                        <span className="preset-card-desc">{preset.desc}</span>
                      </button>
                    ))}
                    <button type="button" className="preset-card secondary-preset" onClick={applyProfileDefaultsToAutomation}>
                      <span className="preset-icon">⚙️</span>
                      <span className="preset-card-label">내 기본값 적용</span>
                      <span className="preset-card-desc">기본 설정 탭의 값 불러오기</span>
                    </button>
                  </div>
                </div>

                {/* ② 프로필 & 기본 정보 */}
                <div className="form-section">
                  <div className="form-section-head">
                    <span className="form-section-num">2</span>
                    <div><strong>프로필 & 기본 정보</strong><small>어떤 계정으로 실행할지, 이름과 주기를 정합니다.</small></div>
                  </div>
                  <section className="integration-profile-box">
                    <Field label="🔗 연동 프로필 선택" hint="프로필 탭에서 연결한 GitHub/Notion 계정을 선택합니다. 선택하면 토큰이 자동으로 적용됩니다.">
                      <select value={form.integration_profile_id || ""} onChange={(e) => applyIntegrationProfile(e.target.value)}>
                        <option value="">— 커스텀 설정 사용 —</option>
                        {integrationProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} ({profile.sourceKind})</option>)}
                      </select>
                    </Field>
                    <div className={selectedAutomationProfile ? "selected-profile-summary ready" : "selected-profile-summary missing"}>
                      {selectedAutomationProfile ? (
                        <>
                          <strong>{selectedAutomationProfile.name}</strong>
                          <span>{providerLabel(selectedAutomationProfile.sourceKind)} · {selectedAutomationProfile.hasToken ? "토큰 연결됨" : "토큰 없음"} · {selectedAutomationProfile.tokenStorage || "저장 방식 미확인"}</span>
                          <small>Base URL: {selectedAutomationProfile.baseUrl || "미설정"} / AI: {selectedAutomationProfile.aiProvider || form.ai_provider} {selectedAutomationProfile.aiModel || form.ai_model}</small>
                        </>
                      ) : (
                        <>
                          <strong>프로필 미선택</strong>
                          <span>자동화 저장 전에 프로필을 선택하면 내 DB에 암호화 저장된 토큰/API 키로 실행됩니다.</span>
                          <small>커스텀 설정을 쓰려면 고급 설정의 API/URL/지침을 직접 확인하세요.</small>
                        </>
                      )}
                    </div>
                  </section>
                  <div className="grid3 wide">
                    <Field label="자동화 이름" hint="목록에 표시되는 이름입니다."><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: GitHub 이슈 → Notion 정리" required /></Field>
                    <Field label="실행 주기 (분)" hint="몇 분마다 실행할지. 최소 1분."><input type="number" min="1" max="1440" value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })} /></Field>
                    <Field label="처리 방식" hint="템플릿 선택 시 자동 입력됩니다."><input value={form.ai_agent} onChange={(e) => setForm({ ...form, ai_agent: e.target.value })} placeholder="github_notion_agent" /></Field>
                  </div>
                  <div className="grid2">
                    <Field label="📥 읽어올 곳" hint="변경사항을 가져올 서비스/페이지입니다."><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="예: GitHub 저장소, Notion BOARD" /></Field>
                    <Field label="📤 저장할 곳" hint="AI가 정리한 결과를 쓸 대상입니다."><input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="예: Notion 업무 보드, GitHub 이슈" /></Field>
                  </div>
                </div>

                {/* ③ 고급 설정 (접기 가능) */}
                <details className="form-section advanced-section">
                  <summary className="form-section-head">
                    <span className="form-section-num">3</span>
                    <div><strong>고급 설정</strong><small>AI 모델, URL, 실행 지침 등을 직접 설정합니다. 템플릿 선택 시 기본값이 채워집니다.</small></div>
                  </summary>
                  <div className="grid3 wide" style={{ marginTop: 12 }}>
                    <Field label="AI 제공자"><input list="ai-provider-options" value={form.ai_provider} onChange={(e) => setForm({ ...form, ai_provider: e.target.value })} placeholder="OpenAI" /></Field>
                    <Field label="AI 모델"><input list="ai-model-options" value={form.ai_model} onChange={(e) => setForm({ ...form, ai_model: e.target.value })} placeholder="gpt-4o-mini" /></Field>
                    <Field label="AI API Base"><input list="ai-api-base-options" value={form.ai_api_base} onChange={(e) => setForm({ ...form, ai_api_base: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
                  </div>
                  <div className="grid2">
                    <Field label="GitHub Repo URL"><input value={form.github_repo_url} onChange={(e) => setForm({ ...form, github_repo_url: e.target.value })} /></Field>
                    <Field label="Notion DB URL"><input value={form.notion_database_url} onChange={(e) => setForm({ ...form, notion_database_url: e.target.value })} /></Field>
                  </div>
                  <div className="grid2">
                    <Field label="Figma File URL"><input value={form.figma_file_url} onChange={(e) => setForm({ ...form, figma_file_url: e.target.value })} /></Field>
                    <Field label="Google Calendar ID"><input value={form.calendar_id} onChange={(e) => setForm({ ...form, calendar_id: e.target.value })} /></Field>
                  </div>
                  <Field label="실행 지침" hint="AI에게 어떻게 처리할지 구체적으로 알려줍니다."><textarea value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} /></Field>
                  <Field label="결과 출력 형식" hint="AI가 정리한 결과를 어떤 양식으로 출력할지 정합니다."><textarea value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} /></Field>
                </details>

                <div className={`form-status ${automationSaveState.status}`}>
                  {automationSaveState.message || "저장하면 자동화가 목록에 추가됩니다."}
                </div>
                <button disabled={automationSaveState.status === "saving"}><CalendarClock size={14} /> {automationSaveState.status === "saving" ? "저장 중…" : "자동화 저장"}</button>
              </form>
            </article>

            <article id="settings-panel" className={`panel ${activeMainTab === "settings" ? "" : "tab-hidden"}`}>
              <div className="panel-title row-title"><span>⚙️ 기본 설정</span><span className="subtle">자동화를 만들 때마다 쓰는 기본값을 여기 저장해두면 매번 입력하지 않아도 됩니다.</span></div>

              {/* 기본 설정 안내 */}
              <div className="explainer-box">
                <div className="explainer-icon">💡</div>
                <div>
                  <strong>자동화 만들 때마다 같은 걸 입력하기 번거롭죠?</strong>
                  <p>여기서 AI 모델과 출력 형식을 한 번 저장해두면, 자동화 등록 폼에서 <b>"내 기본값 적용"</b> 버튼 하나로 자동으로 채워집니다.</p>
                </div>
              </div>

              <form className="knowledge-form" onSubmit={saveProfileSettings}>
                {/* AI 설정 */}
                <div className="settings-group">
                  <div className="settings-group-label">🤖 AI 설정</div>
                  <div className="grid3 wide">
                    <Field label="AI 제공자" hint="예: OpenAI, Anthropic, 로컬 서버 등"><input list="ai-provider-options" value={profileSettings?.aiProvider || ""} onChange={(e) => setProfileSettings({ ...profileSettings, aiProvider: e.target.value })} placeholder="OpenAI" /></Field>
                    <Field label="AI 모델" hint="예: gpt-4o-mini, claude-3-haiku"><input list="ai-model-options" value={profileSettings?.aiModel || ""} onChange={(e) => setProfileSettings({ ...profileSettings, aiModel: e.target.value })} placeholder="gpt-4o-mini" /></Field>
                    <Field label="AI API 주소" hint="OpenAI 호환 서버 주소"><input list="ai-api-base-options" value={profileSettings?.aiApiBase || ""} onChange={(e) => setProfileSettings({ ...profileSettings, aiApiBase: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
                  </div>
                </div>

                {/* 자동화 템플릿 */}
                <div className="settings-group">
                  <div className="settings-group-label">📋 자동화 기본 형식</div>
                  <div className="grid2">
                    <Field label="템플릿 프리셋" hint="자동화가 기본으로 쓸 연결 흐름을 고릅니다. 자동화 등록 폼에서 바꿀 수 있습니다.">
                      <select value={profileSettings?.templatePreset || "github_notion"} onChange={(e) => setProfileSettings({ ...profileSettings, templatePreset: e.target.value })}>
                        {templatePresetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </Field>
                    <Field label="API Key 전략" hint="프로필 토큰 외에 추가 API 키가 필요한 경우 입력합니다."><input value={profileSettings?.apiKeyStrategy || ""} onChange={(e) => setProfileSettings({ ...profileSettings, apiKeyStrategy: e.target.value })} placeholder="예: env:OPENAI_API_KEY" /></Field>
                  </div>
                  <Field label="기본 결과 출력 형식" hint="AI가 자동화 결과를 어떻게 정리할지 형식을 지정합니다. 자동화마다 덮어쓸 수 있습니다."><textarea value={profileSettings?.customTemplate || ""} onChange={(e) => setProfileSettings({ ...profileSettings, customTemplate: e.target.value })} placeholder="예: ## {title}&#10;{summary}&#10;&#10;변경 사항: {changes}" /></Field>
                </div>

                {/* 기본 연결 */}
                <details className="settings-group advanced-section">
                  <summary className="settings-group-label" style={{ cursor: "pointer" }}>🔗 기본 커스텀 연결 <small>(고급)</small></summary>
                  <p className="settings-group-desc">자동화마다 직접 입력하지 않아도 되는 개인 기본 연결 목록입니다. 보통은 프로필 탭의 OAuth 로그인으로 충분합니다.</p>
                  <div className="profile-actions" style={{ marginBottom: 8 }}>
                    {Object.keys(integrationConnectionPresets).map((kind) => (
                      <button key={kind} type="button" onClick={() => addProfileConnection(kind)}><Plus size={13} /> {kind}</button>
                    ))}
                  </div>
                  {(profileSettings?.customConnections || []).map((connection, index) => (
                    <div key={`${connection.service}:${index}`} className="connection-card">
                      <div className="connection-title">
                        <strong>{index + 1}. {connection.label || "기본 연결"}</strong>
                        <button type="button" className="danger" onClick={() => removeProfileConnection(index)}>삭제</button>
                      </div>
                      <div className="grid3 wide">
                        <Field label="라벨"><input value={connection.label} onChange={(e) => updateProfileConnection(index, "label", e.target.value)} /></Field>
                        <Field label="서비스"><input value={connection.service} onChange={(e) => updateProfileConnection(index, "service", e.target.value)} /></Field>
                        <Field label="API"><input value={connection.api} onChange={(e) => updateProfileConnection(index, "api", e.target.value)} /></Field>
                      </div>
                      <div className="grid3 wide">
                        <Field label="URL"><input value={connection.url} onChange={(e) => updateProfileConnection(index, "url", e.target.value)} /></Field>
                        <Field label="토큰 변수"><input value={connection.auth_key_name} onChange={(e) => updateProfileConnection(index, "auth_key_name", e.target.value)} /></Field>
                        <Field label="Operation"><input value={connection.operation} onChange={(e) => updateProfileConnection(index, "operation", e.target.value)} /></Field>
                      </div>
                      <Field label="연결 템플릿"><textarea value={connection.template} onChange={(e) => updateProfileConnection(index, "template", e.target.value)} /></Field>
                    </div>
                  ))}
                  {(profileSettings?.customConnections || []).length === 0 && <p className="empty-state">아직 기본 연결이 없습니다.</p>}
                </details>

                <button disabled={isBusy("profile-settings")}><KeyRound size={14} /> {isBusy("profile-settings") ? "저장 중…" : "기본 설정 저장"}</button>
              </form>
            </article>

            <article id="integrations-panel" className={`panel ${activeMainTab === "integrations" ? "" : "tab-hidden"}`}>
              <div className="panel-title row-title"><span>🔗 내 프로필</span><span className="subtle">계정 로그인, 토큰, API 키를 여기서 한 번에 관리합니다.</span></div>

              {/* 연결 현황 요약 */}
              {(() => {
                const SERVICE_LIST = [
                  { kind: "github", label: "GitHub", emoji: "🐙", loginFn: () => startMcpLogin("github") },
                  { kind: "notion", label: "Notion", emoji: "📝", loginFn: () => startMcpLogin("notion") },
                  { kind: "google_calendar", label: "Google\nCalendar", emoji: "📅", loginFn: () => startMcpLogin("google_calendar") },
                  { kind: "figma", label: "Figma", emoji: "🎨", loginFn: () => startMcpLogin("figma") },
                  { kind: "openai", label: "OpenAI", emoji: "🤖", loginFn: () => openAiKeyProfileSetup("openai") },
                ];
                return (
                  <div className="conn-status-grid">
                    {SERVICE_LIST.map(({ kind, label, emoji, loginFn }) => {
                      const profiles = integrationProfiles.filter(p => p.sourceKind === kind || (kind === "openai" && p.sourceKind === "custom" && p.name?.toLowerCase().includes("openai")));
                      const connected = profiles.some(p => p.hasToken);
                      const hasProfile = profiles.length > 0;
                      return (
                        <div key={kind} className={`conn-status-tile ${connected ? "ok" : hasProfile ? "warn" : "missing"}`}>
                          <span className="conn-status-emoji">{emoji}</span>
                          <span className="conn-status-label">{label}</span>
                          {connected
                            ? <span className="conn-status-badge ok">✅ 연결됨</span>
                            : hasProfile
                              ? <span className="conn-status-badge warn">⚠️ 토큰 없음</span>
                              : <span className="conn-status-badge missing">➕ 미연결</span>
                          }
                          {!connected && (
                            <button type="button" className="conn-status-btn" onClick={loginFn}>
                              연결하기
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <section className="credential-guide">
                <div>
                  <strong>내 계정 연결</strong>
                  <p>먼저 로그인 버튼을 누릅니다. 안 되면 수동 프로필에서 URL과 토큰/API Key를 넣습니다. 자동화는 여기 저장한 내 프로필만 사용합니다.</p>
                </div>
                <ol>
                  <li>GitHub/Notion/Figma/Calendar 로그인</li>
                  <li>필요하면 수동 토큰 저장</li>
                  <li>자동화 탭에서 이 프로필 선택</li>
                </ol>
              </section>
              <div className="mcp-setup-actions">
                <button type="button" onClick={() => startMcpLogin("github")}><GitBranch size={14} /> GitHub MCP 로그인</button>
                <button type="button" onClick={() => startMcpLogin("notion")}><Link2 size={14} /> Notion MCP 로그인</button>
                <button type="button" onClick={() => startMcpLogin("figma")}><Link2 size={14} /> Figma MCP 로그인</button>
                <button type="button" onClick={() => startMcpLogin("google_calendar")}><CalendarClock size={14} /> Google Calendar MCP 로그인</button>
                <button type="button" onClick={() => openMcpProfileSetup("github")}>수동 GitHub 프로필</button>
                <button type="button" onClick={() => openMcpProfileSetup("notion")}>수동 Notion 프로필</button>
                <button type="button" onClick={() => openMcpProfileSetup("figma")}>수동 Figma 프로필</button>
                <button type="button" onClick={() => openMcpProfileSetup("google_calendar")}>수동 Google Calendar 프로필</button>
              </div>
              <section className="ai-key-guide">
                <div>
                  <strong>AI API 키 저장</strong>
                  <p>OpenAI, Gemini, Anthropic 키는 우리에게 보내지 말고 본인 계정으로 직접 저장합니다. 자동화는 선택한 사용자 프로필의 키만 사용합니다.</p>
                </div>
                <div className="ai-key-actions" aria-label="AI API 키 프로필 만들기">
                  <button type="button" onClick={() => openAiKeyProfileSetup("openai")}>OpenAI 키 입력</button>
                  <button type="button" onClick={() => openAiKeyProfileSetup("anthropic")}>Anthropic 키 입력</button>
                  <button type="button" onClick={() => openAiKeyProfileSetup("gemini")}>Gemini 키 입력</button>
                  <button type="button" onClick={() => openAiKeyProfileSetup("compatible")}>호환 API 키</button>
                </div>
              </section>
              {oauthSetup ? (
                <section className="oauth-setup-card">
                  <div>
                    <strong>{providerLabel(oauthSetup.provider)} MCP 로그인 준비 필요</strong>
                    <p>{oauthSetup.message}</p>
                  </div>
                  <a href={oauthSetup.setupUrl} target="_blank" rel="noreferrer">OAuth 앱 만들기</a>
                  <div className="oauth-setup-grid">
                    <label>
                      Callback URL
                      <input readOnly value={oauthSetup.redirectUri || ""} onFocus={(event) => event.currentTarget.select()} />
                    </label>
                    <label>
                      서버 환경변수
                      <textarea readOnly value={(oauthSetup.missing || []).map((name) => `$env:${name}=""`).join("\n")} onFocus={(event) => event.currentTarget.select()} />
                    </label>
                  </div>
                </section>
              ) : null}
              <p className="inline-help">대부분은 위 로그인 버튼만 쓰면 됩니다. AI API 키는 위 AI 키 버튼을 누른 뒤 토큰/API Key 칸에 붙여 넣고 저장합니다.</p>
              <section className="manual-profile-guide" aria-live="polite">
                <div>
                  <strong>{manualGuide.title}</strong>
                  <p>{manualGuide.tokenHint}</p>
                </div>
                <dl>
                  <div><dt>Base URL</dt><dd>{manualGuide.baseUrl}</dd></div>
                  <div><dt>토큰 이름</dt><dd>{manualGuide.tokenName}</dd></div>
                  <div><dt>확인 방법</dt><dd>{manualGuide.testHint}</dd></div>
                </dl>
              </section>
              <form id="profile-manual-form" className="knowledge-form" onSubmit={saveIntegrationProfile}>
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
                  <Field label="Base URL" hint={manualGuide.baseUrl}><input value={integrationForm.base_url} onChange={(e) => setIntegrationForm({ ...integrationForm, base_url: e.target.value })} /></Field>
                  <Field label="토큰 이름" hint={manualGuide.tokenName}><input value={integrationForm.token_name} onChange={(e) => setIntegrationForm({ ...integrationForm, token_name: e.target.value })} /></Field>
                  <Field label="토큰/API Key" hint="값은 사용자별로 암호화 저장되고 목록/응답에 다시 보이지 않습니다."><input type="password" autoComplete="off" value={integrationForm.token_value} onChange={(e) => setIntegrationForm({ ...integrationForm, token_value: e.target.value })} placeholder="여기에 본인 API 키 붙여넣기" /></Field>
                </div>
                <div className="grid3 wide">
                  <Field label="AI 제공자"><input list="ai-provider-options" value={integrationForm.ai_provider} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_provider: e.target.value })} placeholder="OpenAI 또는 OpenAI-compatible" /></Field>
                  <Field label="AI 모델"><input list="ai-model-options" value={integrationForm.ai_model} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_model: e.target.value })} placeholder="gpt-4o-mini" /></Field>
                  <Field label="AI API Base"><input list="ai-api-base-options" value={integrationForm.ai_api_base} onChange={(e) => setIntegrationForm({ ...integrationForm, ai_api_base: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
                  <Field label="Auth Type">
                    <select value={integrationForm.auth_type} onChange={(e) => setIntegrationForm({ ...integrationForm, auth_type: e.target.value })}>
                      <option value="api_key">API key</option>
                      <option value="oauth">OAuth</option>
                      <option value="mcp">MCP</option>
                      <option value="mcp_oauth">MCP OAuth</option>
                    </select>
                  </Field>
                  <Field label="MCP Server"><input value={integrationForm.mcp_server_url} onChange={(e) => setIntegrationForm({ ...integrationForm, mcp_server_url: e.target.value })} placeholder="mcp://notion or https://mcp.example.com" /></Field>
                  <Field label="MCP User"><input type="email" autoComplete="email" value={integrationForm.mcp_auth_subject} onChange={(e) => setIntegrationForm({ ...integrationForm, mcp_auth_subject: e.target.value })} placeholder="user@example.com" /></Field>
                </div>
                <details className="advanced-panel">
                  <summary>고급 프로필 설정</summary>
                  <Field label="MCP Scopes"><input value={integrationForm.mcp_scopes} onChange={(e) => setIntegrationForm({ ...integrationForm, mcp_scopes: e.target.value })} placeholder="page.read, page.write, comment.write" /></Field>
                  <Field label="RAG 대상"><input value={integrationForm.rag_targets} onChange={(e) => setIntegrationForm({ ...integrationForm, rag_targets: e.target.value })} /></Field>
                  <Field label="프로필 템플릿"><textarea value={integrationForm.custom_template} onChange={(e) => setIntegrationForm({ ...integrationForm, custom_template: e.target.value })} /></Field>
                </details>
                <section className="connection-builder">
                  <div className="section-head flat">
                    <div>
                      <strong>프로필 커스텀 연결</strong>
                      <span>이 프로필을 자동화에서 선택하면 아래 연결 목록과 템플릿을 함께 사용합니다.</span>
                    </div>
                    <div className="profile-actions">
                      {Object.keys(integrationConnectionPresets).map((kind) => (
                        <button key={kind} type="button" onClick={() => addIntegrationConnection(kind)}><Plus size={13} /> {kind}</button>
                      ))}
                    </div>
                  </div>
                  {(integrationForm.custom_connections || []).map((connection, index) => (
                    <div key={`${connection.service}:${index}`} className="connection-card">
                      <div className="connection-title">
                        <strong>{index + 1}. {connection.label || "새 연결"}</strong>
                        <button type="button" className="danger" onClick={() => removeIntegrationConnection(index)}>삭제</button>
                      </div>
                      <div className="grid3 wide">
                        <Field label="라벨"><input value={connection.label} onChange={(e) => updateIntegrationConnection(index, "label", e.target.value)} /></Field>
                        <Field label="서비스"><input value={connection.service} onChange={(e) => updateIntegrationConnection(index, "service", e.target.value)} /></Field>
                        <Field label="API"><input value={connection.api} onChange={(e) => updateIntegrationConnection(index, "api", e.target.value)} /></Field>
                      </div>
                      <div className="grid3 wide">
                        <Field label="URL"><input value={connection.url} onChange={(e) => updateIntegrationConnection(index, "url", e.target.value)} /></Field>
                        <Field label="토큰 변수"><input value={connection.auth_key_name} onChange={(e) => updateIntegrationConnection(index, "auth_key_name", e.target.value)} /></Field>
                        <Field label="Operation"><input value={connection.operation} onChange={(e) => updateIntegrationConnection(index, "operation", e.target.value)} /></Field>
                      </div>
                      <Field label="연결 템플릿"><textarea value={connection.template} onChange={(e) => updateIntegrationConnection(index, "template", e.target.value)} /></Field>
                    </div>
                  ))}
                  {(integrationForm.custom_connections || []).length === 0 ? <p className="empty-state">연결이 없으면 source kind와 base URL만 사용합니다.</p> : null}
                </section>
                <div className={`form-status ${integrationSaveState.status}`}>{integrationSaveState.message}</div>
                <button><KeyRound size={14} /> 연동 프로필 저장</button>
              </form>
              <div className="knowledge-list">
                <div className="panel-title compact">저장된 내 프로필</div>
                {integrationProfiles.map((profile) => {
                  const kindMeta = {
                    github: { label: "GitHub", color: "#24292f", emoji: "🐙" },
                    notion: { label: "Notion", color: "#000000", emoji: "📝" },
                    google_calendar: { label: "Google Calendar", color: "#1a73e8", emoji: "📅" },
                    figma: { label: "Figma", color: "#a259ff", emoji: "🎨" },
                    openai: { label: "OpenAI", color: "#10a37f", emoji: "🤖" },
                    custom: { label: "Custom", color: "#666", emoji: "🔧" },
                  };
                  const meta = kindMeta[profile.sourceKind] || kindMeta.custom;
                  const isExpanded = expandedProfiles?.[profile.id];
                  return (
                    <div key={profile.id} className="profile-card" style={{ "--profile-color": meta.color }}>
                      <div className="profile-card-header" onClick={() => setExpandedProfiles((prev) => ({ ...prev, [profile.id]: !prev?.[profile.id] }))}>
                        <div className="profile-card-title">
                          <span className="profile-service-badge" style={{ background: meta.color }}>{meta.emoji} {meta.label}</span>
                          <span className="profile-name">{profile.name}</span>
                        </div>
                        <div className="profile-card-badges">
                          {profile.hasToken
                            ? <span className="badge badge-ok"><CheckCircle2 size={12} /> 토큰 연결됨</span>
                            : <span className="badge badge-err"><XCircle size={12} /> 토큰 없음</span>}
                          {profile.authType?.includes("mcp") || profile.authType?.includes("oauth")
                            ? <span className="badge badge-info">OAuth</span>
                            : <span className="badge badge-gray">API Key</span>}
                          {profile.ragTargets?.length > 0 && <span className="badge badge-gray">RAG: {profile.ragTargets.join(", ")}</span>}
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="profile-card-body">
                          <div className="profile-meta-row">
                            <span><b>서비스</b> {profile.apiProvider || profile.sourceKind}</span>
                            <span><b>AI 모델</b> {profile.aiModel || "미설정"}</span>
                            <span><b>저장 방식</b> {profile.tokenStorage || "DB 암호화"}</span>
                          </div>
                          {profile.baseUrl && <div className="profile-meta-row"><span><b>Base URL</b> {profile.baseUrl}</span></div>}
                          {profile.mcpServerUrl && <div className="profile-meta-row"><span><b>MCP</b> {profile.mcpServerUrl}{profile.mcpAuthSubject ? ` / ${profile.mcpAuthSubject}` : ""}</span></div>}
                          {profile.mcpScopes?.length > 0 && <div className="profile-meta-row"><span><b>Scopes</b> {profile.mcpScopes.join(", ")}</span></div>}
                          {profile.customConnections?.length > 0 && (
                            <div className="profile-connections">
                              {profile.customConnections.map((c, i) => (
                                <span key={i} className="connection-tag">{c.service} · {c.operation}</span>
                              ))}
                            </div>
                          )}
                          {profile.lastCollect?.warnings?.length ? <p className="warning-line">{profile.lastCollect.warnings.join(" / ")}</p> : null}

                          <div className="profile-item-actions">
                            <button type="button" onClick={() => collectIntegrationProfile(profile)} disabled={isBusy(`collect:${profile.id}`)}>
                              <Search size={14} /> {isBusy(`collect:${profile.id}`) ? "수집 중…" : "RAG 수집"}
                            </button>
                            {deleteConfirmProfileId === profile.id ? (
                              <>
                                <button type="button" className="danger confirm-delete" onClick={() => deleteIntegrationProfile(profile)} disabled={isBusy(`delete-profile:${profile.id}`)}>
                                  <Trash2 size={14} /> {isBusy(`delete-profile:${profile.id}`) ? "삭제 중…" : "삭제 확정"}
                                </button>
                                <button type="button" className="secondary" onClick={() => setDeleteConfirmProfileId(null)}>취소</button>
                              </>
                            ) : (
                              <button type="button" className="danger" onClick={() => setDeleteConfirmProfileId(profile.id)}><Trash2 size={14} /> 삭제</button>
                            )}
                          </div>

                          {["figma", "google_calendar"].includes(profile.sourceKind) && (
                            <div className="live-write-controls">
                              <button type="button" onClick={() => writeIntegrationProfile(profile, true)} disabled={isBusy(`write:${profile.id}:true`)}>
                                <Play size={14} /> {isBusy(`write:${profile.id}:true`) ? "확인 중…" : "Dry-run"}
                              </button>
                              <input
                                value={liveWriteConfirmations[profile.id] || ""}
                                onChange={(e) => setLiveWriteConfirmations({ ...liveWriteConfirmations, [profile.id]: e.target.value })}
                                placeholder="WRITE LIVE 입력 후 활성화"
                              />
                              <button type="button" className="danger-action"
                                disabled={(liveWriteConfirmations[profile.id] || "").trim() !== "WRITE LIVE" || isBusy(`write:${profile.id}:false`)}
                                onClick={() => writeIntegrationProfile(profile, false)}>
                                <Play size={14} /> {isBusy(`write:${profile.id}:false`) ? "쓰는 중…" : "실제 쓰기"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {integrationProfiles.length === 0 ? <p className="empty-state">저장된 프로필이 없습니다. 위 로그인 버튼 또는 수동 프로필 저장을 사용하세요.</p> : null}
                <details className="advanced-panel">
                  <summary>고급 진단 보기</summary>
                  <div className="provider-grid">
                    {providerReadiness.map((provider) => (
                      <div key={provider.key} className={provider.ready ? "provider-card ready" : "provider-card missing"}>
                        <strong>{provider.name}</strong>
                        <span>{provider.ready ? "ready" : "setup required"} / {provider.readyCount}/{provider.profileCount}</span>
                        <p>{provider.requiredUrl} / {provider.requiredToken} / {provider.operation}</p>
                        <small>{provider.nextAction}</small>
                      </div>
                    ))}
                  </div>
                  <div className="activity-log">
                    <div className="activity-head">
                      <strong>연동 활동 로그</strong>
                      <span>{integrationActivities.length} / {activityPage.total} shown</span>
                    </div>
                    {integrationActivities.map((activity) => (
                      <div key={activity.id} className={`activity-row ${activity.status}`}>
                        <span>{activity.eventType}</span><span>{activity.provider || "board"}</span><span>{activity.status}</span><p>{activity.summary}</p>
                      </div>
                    ))}
                    {integrationActivities.length === 0 ? <p className="empty-state">아직 연동 활동이 없습니다.</p> : null}
                    {activityPage.hasMore ? <button type="button" className="load-more" onClick={() => loadActivities(activityFilters, activityPage.nextOffset, true)}>활동 더 보기</button> : null}
                  </div>
                </details>
              </div>
            </article>

            <article id="knowledge-panel" className={`panel ${activeMainTab === "knowledge" ? "" : "tab-hidden"}`}>
              <div className="panel-title row-title"><span>📚 지식자료 (RAG)</span><span className="subtle">AI가 자동화 실행 중 참고할 문서·텍스트를 저장합니다.</span></div>

              {/* 지식자료 안내 */}
              <div className="explainer-box">
                <div className="explainer-icon">📚</div>
                <div>
                  <strong>자동화가 내 문서를 참고하게 만들 수 있습니다.</strong>
                  <p>사내 규정, 업무 가이드, 자주 쓰는 양식 등을 여기 저장해두면 자동화 실행 시 AI가 그 내용을 보고 답변·정리를 합니다. 예를 들어 "이슈 정리 시 우리 팀 양식 따르기"나 "회의록은 이 템플릿으로 작성"처럼 쓸 수 있습니다.</p>
                  <p><b>연결하려면:</b> 프로필 탭 → 프로필 열기 → <b>지식자료 대상</b> 칸에 아래 자료의 이름이나 태그를 입력하면 됩니다.</p>
                </div>
              </div>

              {/* 자료 추가 폼 */}
              <div className="settings-group">
                <div className="settings-group-label">➕ 자료 추가</div>
                <form className="knowledge-form" onSubmit={saveKnowledge}>
                  <div className="grid3 wide">
                    <Field label="자료명" hint="프로필의 RAG 대상 칸에 이 이름으로 연결합니다."><input value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} placeholder="예: 업무 가이드, 사내 규정" required /></Field>
                    <Field label="자료 종류" hint="AI가 이 자료를 어떤 유형으로 처리할지 고릅니다.">
                      <select value={knowledgeForm.source_type} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, source_type: e.target.value })}>
                        <option value="document">📄 문서</option>
                        <option value="taskory">✅ Taskory 작업 내보내기</option>
                        <option value="audio">🎤 음성 녹취</option>
                        <option value="image">🖼️ 이미지 설명</option>
                        <option value="spreadsheet">📊 스프레드시트</option>
                        <option value="custom">🔧 기타</option>
                      </select>
                    </Field>
                    <Field label="태그" hint="쉼표로 구분. 프로필 RAG 대상 연결 시 사용됩니다."><input value={knowledgeForm.tags} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, tags: e.target.value })} placeholder="예: 사내규정, 업무가이드" /></Field>
                  </div>
                  <Field label="AI 사용 지침" hint="이 자료를 언제, 어떻게 참고할지 AI에게 알려줍니다."><textarea value={knowledgeForm.instruction} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, instruction: e.target.value })} placeholder="예: 답변 작성 시 이 규정을 우선 참고하고 규정에 없으면 일반 상식을 사용하세요." /></Field>
                  <Field label="자료 내용" hint="AI가 검색할 실제 텍스트입니다. 문서를 붙여넣거나 파일을 첨부하세요."><textarea value={knowledgeForm.extracted_text} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, extracted_text: e.target.value })} placeholder="문서 내용, 음성 녹취, 이미지 설명, 스프레드시트 데이터 등을 여기에 붙여넣으세요." /></Field>
                  <div className="transcription-settings" aria-label="OpenAI 음성 전사 설정">
                    <div>
                      <strong>OpenAI 음성 전사</strong>
                      <p>음성 파일을 올리면 선택한 내 OpenAI API 키와 모델로 전사한 뒤 위 자료 내용에 채워 넣습니다.</p>
                    </div>
                    <Field label="OpenAI API 키 프로필" hint="프로필 탭에서 저장한 사용자별 API 키를 사용합니다.">
                      <select
                        value={transcriptionSettings.integrationProfileId}
                        onChange={(e) => setTranscriptionSettings({ ...transcriptionSettings, integrationProfileId: e.target.value })}
                      >
                        <option value="">{openAiProfiles.length ? "첫 번째 OpenAI 프로필 자동 선택" : "저장된 OpenAI 프로필 없음"}</option>
                        {openAiProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>{profile.name} ({profile.aiProvider || profile.apiProvider})</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="전사 모델">
                      <select
                        value={transcriptionSettings.model}
                        onChange={(e) => setTranscriptionSettings({ ...transcriptionSettings, model: e.target.value })}
                      >
                        {transcriptionModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                      </select>
                    </Field>
                    <Field label="전사 프롬프트" hint="회의/강의/업무 메모 등 전사 맥락을 OpenAI에 전달합니다.">
                      <input
                        value={transcriptionSettings.prompt}
                        onChange={(e) => setTranscriptionSettings({ ...transcriptionSettings, prompt: e.target.value })}
                        placeholder="예: 한국어 회의 내용을 업무 지시로 전사"
                      />
                    </Field>
                    {!openAiProfiles.length ? (
                      <button type="button" className="secondary" onClick={() => openAiKeyProfileSetup("openai")}>
                        <KeyRound size={14} /> OpenAI 키 먼저 저장
                      </button>
                    ) : null}
                  </div>
                  <div className="file-row">
                    <label className="file-picker"><Upload size={14} /> 파일 첨부 (선택)<input type="file" accept=".txt,.md,.csv,.json,.jsonl,.log" onChange={(e) => setKnowledgeForm({ ...knowledgeForm, file: e.target.files?.[0] || null })} /></label>
                    <label className={`file-picker ${openAiProfiles.length ? "" : "disabled"}`} aria-disabled={!openAiProfiles.length}>
                      <Upload size={14} /> 음성 전사
                      <input
                        type="file"
                        accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac"
                        disabled={!openAiProfiles.length}
                        onChange={(e) => { transcribeKnowledgeAudio(e.target.files?.[0]); e.target.value = ""; }}
                      />
                    </label>
                    {knowledgeForm.file && <span className="file-name">📎 {knowledgeForm.file.name}</span>}
                    <span className="file-help">
                      문서는 바로 저장하고, 음성은 사용자별 OpenAI API 키로 전사한 뒤 자료 내용에 채워 넣습니다.
                      {!openAiProfiles.length ? " 먼저 OpenAI 키 프로필을 저장하세요." : " 큰 파일은 서버 ffmpeg로 조각 전사합니다."}
                    </span>
                    <button disabled={knowledgeSaveState.status === "saving"}><FileText size={14} /> {knowledgeSaveState.status === "saving" ? "저장 중…" : "자료 저장"}</button>
                  </div>
                  {transcriptionState.message ? <div className={`form-status ${transcriptionState.status}`}>{transcriptionState.message}</div> : null}
                  {knowledgeSaveState.message ? <div className={`form-status ${knowledgeSaveState.status}`}>{knowledgeSaveState.message}</div> : null}
                </form>
              </div>

              {/* 저장된 자료 목록 */}
              <div className="settings-group">
                <div className="settings-group-label">📂 저장된 자료 ({knowledgeSources.length}개)</div>
                {knowledgeSources.length === 0 ? (
                  <div className="rag-empty">
                    <p>아직 저장된 자료가 없습니다.</p>
                    <small>위 폼에서 문서나 텍스트를 추가하면 여기에 나타납니다.</small>
                  </div>
                ) : (
                  <div className="rag-source-list">
                    {knowledgeSources.map((source) => (
                      <div key={source.id} className="rag-source-card">
                        <div className="rag-source-header">
                          <strong>{source.title}</strong>
                          <div className="rag-source-badges">
                            <span className="badge badge-info">{source.sourceType}</span>
                            {source.tags.map((t) => <span key={t} className="badge badge-gray">#{t}</span>)}
                          </div>
                        </div>
                        {source.instruction && <p className="rag-source-instruction">💬 {source.instruction}</p>}
                        {source.extractedText && <p className="rag-source-preview">{source.extractedText.slice(0, 200)}{source.extractedText.length > 200 ? "…" : ""}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>

            <article id="board-panel" className={`panel ${activeMainTab === "board" ? "" : "tab-hidden"}`}>
              {/* ── 게시판 헤더 ── */}
              <div className="board-top">
                <div className="board-top-info">
                  <h2>📋 게시판</h2>
                  <p>공지, 요청, 공유 자동화 템플릿을 여기서 한눈에 봅니다.</p>
                </div>
                <div className="board-top-actions">
                  <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); loadAll(q); }}>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색…" aria-label="게시글 검색" />
                    <button type="submit" aria-label="검색"><Search size={13} /></button>
                  </form>
                  <button type="button" className="board-write-btn" onClick={() => setShowWriteForm((v) => !v)}><Plus size={14} /> 글 쓰기</button>
                </div>
              </div>

              {/* ── 글 쓰기 폼 (토글) ── */}
              {showWriteForm && (
                <form className="board-write-form" onSubmit={createPost}>
                  <input id="board-write-title" name="title" placeholder="제목을 입력하세요" aria-label="게시글 제목" required />
                  <textarea name="content" placeholder="내용을 입력하세요" aria-label="게시글 내용" rows={4} required />
                  <div className="board-write-footer">
                    <input name="tags" placeholder="태그: github, notion, rag" aria-label="태그" className="board-tags-input" />
                    {postSaveState.message ? <span className={`form-status inline ${postSaveState.status}`}>{postSaveState.message}</span> : null}
                    <button disabled={postSaveState.status === "saving"}><Plus size={14} /> {postSaveState.status === "saving" ? "저장 중…" : "게시"}</button>
                    <button type="button" className="secondary" onClick={() => setShowWriteForm(false)}>취소</button>
                  </div>
                </form>
              )}

              {/* ── 탭: 게시글 / 공유 자동화 ── */}
              <div className="board-tabs">
                <button type="button" className={boardSubTab === "posts" ? "board-tab active" : "board-tab"} onClick={() => setBoardSubTab("posts")}>
                  📝 게시글 <span className="board-tab-count">{postPage.total}</span>
                </button>
                <button type="button" className={boardSubTab === "shares" ? "board-tab active" : "board-tab"} onClick={() => setBoardSubTab("shares")}>
                  ⚡ 공유 자동화 <span className="board-tab-count">{sharePage.total}</span>
                </button>
              </div>

              {/* ── 게시글 카드 그리드 ── */}
              {boardSubTab === "posts" && (
                <div className="board-card-grid">
                  {posts.length === 0 && <p className="empty-state">게시글이 없습니다. 위 <b>글 쓰기</b> 버튼으로 첫 글을 남겨보세요.</p>}
                  {posts.map((post) => {
                    const isExpanded = selected?.id === post.id;
                    const tags = post.tags?.map((t) => t.tag.name) || [];
                    return (
                      <article key={post.id} className={`board-post-card ${isExpanded ? "expanded" : ""}`}>
                        <div className="board-post-card-header" onClick={() => setSelected(isExpanded ? null : post)}>
                          <div className="board-post-card-title">
                            <span className="board-post-title">{post.title}</span>
                            <div className="board-post-meta">
                              <span className="board-post-author">✍️ {post.author?.name || "작성자"}</span>
                              {tags.map((t) => <span key={t} className="board-tag">#{t}</span>)}
                            </div>
                          </div>
                          {!isExpanded && <p className="board-post-excerpt">{post.content?.slice(0, 100) || "내용 없음"}…</p>}
                          <span className="board-expand-hint">{isExpanded ? "▲ 접기" : "▼ 펼치기"}</span>
                        </div>
                        {isExpanded && (
                          <div className="board-post-body">
                            <div className="post-content">{renderPostContent(post.content)}</div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  <div className="post-page-row">
                    <span className="muted">{posts.length} / {postPage.total}개 표시</span>
                    {postPage.hasMore && <button type="button" onClick={loadMorePosts} disabled={isBusy("more-posts")} className="secondary">{isBusy("more-posts") ? "불러오는 중…" : "더 보기"}</button>}
                  </div>
                </div>
              )}

              {/* ── 공유 자동화 카드 그리드 ── */}
              {boardSubTab === "shares" && (
                <div className="board-card-grid">
                  {automationShares.length === 0 && (
                    <div className="board-empty-shares">
                      <p>⚡ 공유된 자동화가 없습니다.</p>
                      <small>자동화 탭 → 내 자동화 → <b>공유 자동화로 등록</b> 버튼을 누르면 여기에 나타납니다.</small>
                    </div>
                  )}
                  {automationShares.map((post) => (
                    <article key={post.id} className="board-share-card">
                      <div className="board-share-card-top">
                        <span className="board-share-badge">⚡ 자동화 템플릿</span>
                        <span className="board-share-author">{post.author?.name || "작성자"}</span>
                      </div>
                      <h3 className="board-share-title">{post.title.replace(/^\[자동화\]\s*/, "")}</h3>
                      <p className="board-share-desc">{post.summary || post.content?.slice(0, 160) || "설명 없음"}</p>
                      <div className="board-share-tags">{post.tags?.map((t) => <span key={t.tag.name} className="board-tag">#{t.tag.name}</span>)}</div>
                      <button
                        type="button"
                        className={post.automationTemplate ? "" : "secondary"}
                        onClick={() => applySharedAutomation(post)}
                        disabled={!post.automationTemplate}
                        title={post.automationTemplate ? "자동화 탭의 등록 폼에 이 설정이 복사됩니다" : "원본 자동화가 삭제됨"}
                      >
                        {post.automationTemplate ? <><Plus size={14} /> 내 자동화에 적용</> : "원본 삭제됨"}
                      </button>
                    </article>
                  ))}
                  {sharePage.hasMore && <button type="button" className="load-more" onClick={loadMoreShares} disabled={isBusy("more-shares")}>{isBusy("more-shares") ? "불러오는 중…" : "더 보기"}</button>}
                </div>
              )}
            </article>

            <article id="api-panel" className={`panel ${activeMainTab === "api" ? "" : "tab-hidden"}`}>
              <div className="panel-title row-title"><span>🔍 시스템 점검</span><span className="subtle">서버 연결 상태, AI 동작, 저장된 자료 검색을 여기서 확인합니다.</span></div>

              {/* 점검 항목 카드 */}
              <div className="check-grid">
                <button type="button" className="check-card" onClick={() => callApiDemo("health")}>
                  <span className="check-card-icon">🟢</span>
                  <div>
                    <strong>서버 상태 확인</strong>
                    <small>백엔드가 정상 동작 중인지 확인합니다</small>
                  </div>
                </button>
                <button type="button" className="check-card" onClick={() => callApiDemo("rag")}>
                  <span className="check-card-icon">🔍</span>
                  <div>
                    <strong>지식자료 검색 테스트</strong>
                    <small>아래 지침 입력 후 RAG 검색 결과를 확인합니다</small>
                  </div>
                </button>
                <button type="button" className="check-card" onClick={() => callApiDemo("mcp")}>
                  <span className="check-card-icon">🔗</span>
                  <div>
                    <strong>MCP 연결 상태</strong>
                    <small>GitHub, Notion 등 MCP 도구 연결을 확인합니다</small>
                  </div>
                </button>
                <button type="button" className="check-card" onClick={() => callApiDemo("hub")}>
                  <span className="check-card-icon">🤖</span>
                  <div>
                    <strong>AI 에이전트 허브</strong>
                    <small>AI 도구 실행 가능 여부를 테스트합니다</small>
                  </div>
                </button>
              </div>

              {/* 지침 입력 */}
              <div className="settings-group">
                <div className="settings-group-label">💬 테스트 지침 입력 <small>(RAG 검색 시 사용)</small></div>
                <textarea className="api-prompt-textarea" value={apiPrompt} onChange={(e) => setApiPrompt(e.target.value)} aria-label="AI 도구 실행 지침" placeholder="예: GitHub 이슈 목록에서 오늘 마감인 항목을 정리해줘" rows={3} />
              </div>
            </article>
          </section>

          {activeMainTab === "api" ? <aside className="result-panel" aria-label="점검 결과">
            <div className="result-panel-header">
              <strong>📊 점검 결과</strong>
              <small>위 항목을 클릭하면 여기에 결과가 표시됩니다.</small>
            </div>
            {(apiResult || result) ? (
              <div className="check-result">
                {(() => {
                  const data = apiResult || result;
                  if (data?.status === "ok" || data?.status === "healthy") {
                    return <div className="check-result-ok">✅ 정상 동작 중</div>;
                  }
                  if (data?.error) {
                    return <div className="check-result-err">❌ 오류: {data.error}</div>;
                  }
                  return null;
                })()}
                <pre className="check-result-pre">{JSON.stringify(apiResult || result, null, 2)}</pre>
              </div>
            ) : (
              <div className="check-result-empty">
                <p>🔍 위 점검 항목을 클릭하세요</p>
                <small>서버 상태, RAG, MCP, AI 허브 순서로 확인하면 됩니다.</small>
              </div>
            )}
          </aside> : null}
        </div>
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");
const root = window.__aiBoardRoot || createRoot(rootElement);
window.__aiBoardRoot = root;
root.render(<App />);
