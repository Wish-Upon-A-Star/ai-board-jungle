"use client";

import { useState } from "react";

export default function AuthClient() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || "요청에 실패했습니다.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="auth">
      <div className="brand">AI Board</div>
      <p className="subtle">React, Next.js, Postgres, RAG, MCP, Agent를 한 화면에서 검증하는 게시판입니다.</p>
      <div className="split" style={{ marginBottom: 16 }}>
        <button className={`button ${mode === "login" ? "" : "secondary"}`} onClick={() => setMode("login")}>
          로그인
        </button>
        <button className={`button ${mode === "register" ? "" : "secondary"}`} onClick={() => setMode("register")}>
          회원가입
        </button>
      </div>
      <form onSubmit={submit}>
        {mode === "register" && (
          <div className="field">
            <label>이름</label>
            <input name="name" required minLength={2} placeholder="홍길동" />
          </div>
        )}
        <div className="field">
          <label>이메일</label>
          <input name="email" required type="email" placeholder="user@example.com" />
        </div>
        <div className="field">
          <label>비밀번호</label>
          <input name="password" required type="password" minLength={8} placeholder="password123" />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="button" disabled={loading}>
          {loading ? "처리 중" : mode === "login" ? "로그인" : "계정 만들기"}
        </button>
      </form>
      <p className="subtle" style={{ marginTop: 18 }}>
        데모 계정: admin@example.com / password123
      </p>
    </main>
  );
}
