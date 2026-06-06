"use client";

import { Bot, CalendarDays, CloudSun, GitBranch, Kanban, LogOut, Palette, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type User = { id: string; email: string; name: string; role: string };
type Post = {
  id: string;
  title: string;
  content: string;
  summary: string;
  status: string;
  author: { name: string };
  tags: Array<{ tag: { name: string } }>;
  comments: Array<{ id: string; content: string; author: { name: string } }>;
  createdAt: string;
};

type AnyConfig = Record<string, string | number | boolean>;

export default function BoardClient({ user }: { user: User }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<Post | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [ai, setAi] = useState<Record<string, unknown> | null>(null);
  const [integration, setIntegration] = useState<AnyConfig>({});
  const [hub, setHub] = useState<AnyConfig>({});
  const [instruction, setInstruction] = useState("GitHub 칸반에 작업을 정리하고 Notion에 동기화한 뒤 Google Calendar 일정과 Figma 디자인 확인 항목을 만들어줘.");
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadPosts(nextPage = page, nextQuery = query) {
    const params = new URLSearchParams({ page: String(nextPage), q: nextQuery });
    const response = await fetch(`/api/posts?${params}`);
    const data = await response.json();
    setPosts(data.posts || []);
    setTotal(data.total || 0);
    if (!selected && data.posts?.[0]) setSelected(data.posts[0]);
  }

  async function loadIntegration() {
    const [githubNotion, hubConfig] = await Promise.all([
      fetch("/api/integrations/github-notion").then((response) => response.json()),
      fetch("/api/integrations/hub").then((response) => response.json()),
    ]);
    setIntegration(githubNotion.config || {});
    setHub(hubConfig.config || {});
  }

  useEffect(() => {
    loadPosts(1, "");
    loadIntegration().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveIntegration() {
    const response = await fetch("/api/integrations/github-notion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integration),
    });
    const data = await response.json();
    setIntegration(data.config || {});
    setSyncResult(data);
  }

  async function saveHub() {
    const response = await fetch("/api/integrations/hub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hub),
    });
    const data = await response.json();
    setHub(data.config || {});
    setSyncResult(data);
  }

  async function syncIntegration() {
    const response = await fetch("/api/integrations/github-notion/sync", { method: "POST" });
    setSyncResult(await response.json());
  }

  async function registerIntegrationAutomation() {
    const response = await fetch("/api/integrations/github-notion/register-automation", { method: "POST" });
    const data = await response.json();
    setIntegration(data.config || {});
    setSyncResult(data);
  }

  async function runInstruction() {
    const response = await fetch("/api/integrations/hub/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    setSyncResult(await response.json());
  }

  async function submitPost(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, tags: tags.split(",").map((tag) => tag.trim()) }),
    });
    const data = await response.json();
    setLoading(false);
    setAi(data.moderation || data);
    if (response.ok) {
      setTitle("");
      setContent("");
      setTags("");
      await loadPosts(1, query);
    }
  }

  async function deletePost(id: string) {
    await fetch(`/api/posts/${id}`, { method: "DELETE" });
    setSelected(null);
    await loadPosts(page, query);
  }

  async function comment(postId: string, value: string) {
    if (!value.trim()) return;
    await fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: value }),
    });
    await loadPosts(page, query);
  }

  async function askRag() {
    const response = await fetch("/api/ai/rag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: `${title}\n${content}` || query || "AI 게시판 운영" }),
    });
    setAi(await response.json());
  }

  async function makeWeatherBrief() {
    const response = await fetch("/api/ai/mcp/weather", { method: "POST" });
    const data = await response.json();
    setTitle(`외부 데이터 브리핑: ${data.location || "Seoul"}`);
    setContent(data.draft || data.summary || "");
    setTags("mcp,calendar,briefing");
    setAi(data);
  }

  async function runAgent() {
    const response = await fetch("/api/ai/agent/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    setAi(await response.json());
  }

  const maxPage = useMemo(() => Math.max(1, Math.ceil(total / 6)), [total]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">AI Board</div>
        <p className="subtle">GitHub, Notion, Calendar, Figma를 게시판 운영 흐름에 연결하는 AI 작업 허브입니다.</p>
        <nav className="nav">
          <a className="active" href="#hub">통합 허브</a>
          <a href="#integration">동기화 설정</a>
          <a href="#feed">게시판</a>
          <a href="#compose">글쓰기</a>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
          >
            <LogOut size={16} /> 로그아웃
          </button>
        </nav>
        <p className="meta" style={{ marginTop: 26 }}>
          {user.name} / {user.role}
        </p>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1 style={{ margin: 0 }}>운영 자동화 허브</h1>
            <p className="subtle">지침을 입력하면 GitHub 칸반, Notion, Google Calendar, Figma 중 필요한 대상을 판단해 실행합니다.</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              loadPosts(1, query);
            }}
            style={{ display: "flex", gap: 8, width: "min(620px, 100%)" }}
          >
            <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="게시글, 이슈, 태그 검색" />
            <button className="button secondary">
              <Search size={16} /> 검색
            </button>
          </form>
        </div>

        <section id="hub" className="post-row" style={{ marginBottom: 18 }}>
          <div className="post-head">
            <div>
              <h2 className="post-title">지침 기반 자동 실행</h2>
              <p className="post-summary">예: “깃헙 칸반에 이번 주 작업을 넣고, 노션에 동기화하고, 구글 캘린더에 마감일을 넣고, 피그마 확인 항목도 만들어줘.”</p>
            </div>
            <span className="meta">매분 점검 자동화 연결됨</span>
          </div>
          <div className="field">
            <label>자동 실행 지침</label>
            <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
          </div>
          <div className="split">
            <div className="field">
              <label>GitHub Project/Kanban URL</label>
              <input value={String(hub.githubProjectUrl || "")} onChange={(event) => setHub({ ...hub, githubProjectUrl: event.target.value })} placeholder="https://github.com/orgs/.../projects/1" />
            </div>
            <div className="field">
              <label>Google Calendar ID</label>
              <input value={String(hub.googleCalendarId || "primary")} onChange={(event) => setHub({ ...hub, googleCalendarId: event.target.value })} placeholder="primary" />
            </div>
          </div>
          <div className="split">
            <div className="field">
              <label>Google Access Token</label>
              <input type="password" value={hub.googleAccessToken === "configured" ? "" : String(hub.googleAccessToken || "")} onChange={(event) => setHub({ ...hub, googleAccessToken: event.target.value })} placeholder={hub.googleAccessToken === "configured" ? "configured" : "OAuth access token"} />
            </div>
            <div className="field">
              <label>Figma File URL</label>
              <input value={String(hub.figmaFileUrl || "")} onChange={(event) => setHub({ ...hub, figmaFileUrl: event.target.value })} placeholder="https://www.figma.com/design/..." />
            </div>
          </div>
          <div className="split">
            <div className="field">
              <label>Figma Token</label>
              <input type="password" value={hub.figmaToken === "configured" ? "" : String(hub.figmaToken || "")} onChange={(event) => setHub({ ...hub, figmaToken: event.target.value })} placeholder={hub.figmaToken === "configured" ? "configured" : "Figma token"} />
            </div>
            <div className="field">
              <label>연결 대상</label>
              <div className="tags">
                <span className="tag"><Kanban size={12} /> GitHub Kanban</span>
                <span className="tag"><GitBranch size={12} /> GitHub/Notion</span>
                <span className="tag"><CalendarDays size={12} /> Google Calendar</span>
                <span className="tag"><Palette size={12} /> Figma</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="button" type="button" onClick={saveHub}>허브 설정 저장</button>
            <button className="button secondary" type="button" onClick={runInstruction}>지침 실행</button>
          </div>
          <pre className="notice">{JSON.stringify(syncResult || { status: "지침을 실행하면 대상 서비스별 결과가 표시됩니다." }, null, 2)}</pre>
        </section>

        <section id="integration" className="post-row" style={{ marginBottom: 18 }}>
          <h2 className="post-title">GitHub / Notion 기본 동기화</h2>
          <p className="post-summary">GitHub issue와 commit을 Notion 업무 DB로 보내고, Notion에서 정리한 issue 제목/상태를 GitHub로 되돌립니다.</p>
          <div className="split">
            <Field label="GitHub Repository URL" value={integration.githubUrl} onChange={(value) => setIntegration({ ...integration, githubUrl: value })} placeholder="https://github.com/owner/repo" />
            <Field label="Notion Tasks Database URL" value={integration.notionTasksUrl} onChange={(value) => setIntegration({ ...integration, notionTasksUrl: value })} placeholder="https://www.notion.so/..." />
          </div>
          <div className="split">
            <SecretField label="GitHub Token" value={integration.githubToken} onChange={(value) => setIntegration({ ...integration, githubToken: value })} />
            <SecretField label="Notion Token" value={integration.notionToken} onChange={(value) => setIntegration({ ...integration, notionToken: value })} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="button secondary" type="button" onClick={saveIntegration}>연동 저장</button>
            <button className="button secondary" type="button" onClick={syncIntegration}>지금 동기화</button>
            <button className="button secondary" type="button" onClick={registerIntegrationAutomation}>매분 자동화 등록</button>
          </div>
          <p className="meta">마지막 동기화 {String(integration.lastSyncAt || "-")}</p>
        </section>

        <section id="feed" className="feed">
          {posts.length === 0 && <div className="empty">게시글이 없습니다. 첫 글을 작성하세요.</div>}
          {posts.map((post) => (
            <article className="post-row" key={post.id} onClick={() => setSelected(post)}>
              <div className="post-head">
                <div>
                  <h2 className="post-title">{post.title}</h2>
                  <p className="post-summary">{post.summary || post.content.slice(0, 140)}</p>
                </div>
                <span className="meta">{post.status === "HELD" ? "보류" : "게시"}</span>
              </div>
              <div className="tags">{post.tags.map(({ tag }) => <span className="tag" key={tag.name}>#{tag.name}</span>)}</div>
              <p className="meta">{post.author.name} · 댓글 {post.comments.length}</p>
            </article>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="button secondary" disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); loadPosts(p, query); }}>이전</button>
            <span className="meta">{page} / {maxPage}</span>
            <button className="button secondary" disabled={page >= maxPage} onClick={() => { const p = page + 1; setPage(p); loadPosts(p, query); }}>다음</button>
          </div>
        </section>

        <section id="compose" className="ai-block">
          <h2>글쓰기</h2>
          <form onSubmit={submitPost}>
            <Field label="제목" value={title} onChange={setTitle} />
            <div className="field">
              <label>내용</label>
              <textarea value={content} onChange={(event) => setContent(event.target.value)} minLength={10} required />
            </div>
            <Field label="태그" value={tags} onChange={setTags} placeholder="rag,mcp,agent" />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="button" disabled={loading}><Plus size={16} /> 게시</button>
              <button className="button secondary" type="button" onClick={askRag}><Sparkles size={16} /> RAG 추천</button>
              <button className="button secondary" type="button" onClick={makeWeatherBrief}><CloudSun size={16} /> MCP 브리핑</button>
              <button className="button secondary" type="button" onClick={runAgent}><Bot size={16} /> Agent 검토</button>
            </div>
          </form>
        </section>
      </main>

      <aside className="inspector">
        <p className="section-title">선택한 게시글</p>
        {selected ? <PostInspector post={selected} onDelete={deletePost} onComment={comment} /> : <p className="subtle">게시글을 선택하면 상세 내용과 댓글이 표시됩니다.</p>}
        <div id="ai" className="ai-block">
          <p className="section-title">AI 결과</p>
          <pre className="notice">{JSON.stringify(ai || { status: "AI 도구를 실행하면 결과가 표시됩니다." }, null, 2)}</pre>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "" }: { label: string; value: unknown; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={String(value || "")} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function SecretField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="password" value={value === "configured" ? "" : String(value || "")} onChange={(event) => onChange(event.target.value)} placeholder={value === "configured" ? "configured" : "token"} />
    </div>
  );
}

function PostInspector({ post, onDelete, onComment }: { post: Post; onDelete: (id: string) => void; onComment: (id: string, content: string) => void }) {
  const [commentText, setCommentText] = useState("");
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{post.title}</h2>
      <p className="subtle">{post.content}</p>
      <div className="tags">{post.tags.map(({ tag }) => <span className="tag" key={tag.name}>#{tag.name}</span>)}</div>
      <div className="ai-block">
        <p className="section-title">댓글</p>
        {post.comments.map((item) => <p key={item.id} className="notice"><strong>{item.author.name}</strong><br />{item.content}</p>)}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onComment(post.id, commentText);
            setCommentText("");
          }}
        >
          <div className="field">
            <textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="댓글 입력" />
          </div>
          <button className="button secondary">댓글 등록</button>
        </form>
      </div>
      <button className="button danger" style={{ marginTop: 14 }} onClick={() => onDelete(post.id)}>삭제</button>
    </div>
  );
}
