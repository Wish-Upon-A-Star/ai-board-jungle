const API_BASE = import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:8000`;

function labelValidationLocation(location = []) {
  const parts = location.filter((part) => part !== "body").map((part) => (typeof part === "number" ? `#${part + 1}` : String(part)));
  return parts.length ? parts.join(" > ") : "request";
}

export function formatApiError(data = {}, fallback = "요청을 처리하지 못했습니다.") {
  if (Array.isArray(data.detail)) {
    const issues = data.detail.map((item) => ({
      field: labelValidationLocation(item.loc || []),
      message: String(item.msg || "입력값을 확인하세요."),
    }));
    return {
      message: `입력값을 확인하세요. ${issues.length}개 항목이 유효하지 않습니다.`,
      issues,
    };
  }
  if (typeof data.detail === "string") return { message: data.detail, issues: [] };
  if (typeof data.error === "string") return { message: data.error, issues: [] };
  return { message: fallback, issues: [] };
}

function buildHeaders(options = {}) {
  const token = localStorage.getItem("ai-board-token");
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function apiStatus(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: buildHeaders(options) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, statusText: response.statusText, data };
}

export async function api(path, options = {}) {
  const result = await apiStatus(path, options);
  if (!result.ok) {
    const formatted = formatApiError(result.data, result.statusText);
    const error = new Error(formatted.message);
    error.status = result.status;
    error.validationIssues = formatted.issues;
    error.response = result.data;
    throw error;
  }
  return result.data;
}
