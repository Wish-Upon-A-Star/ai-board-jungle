export function parseRunResult(result) {
  if (!result) return {};
  if (typeof result === "object") return result;
  try {
    return JSON.parse(result);
  } catch {
    return { raw: String(result) };
  }
}

export function summarizeRunResult(result) {
  const data = parseRunResult(result);
  const parts = [data.agent || "agent"];
  if (data.route) parts.push(data.route);
  if (Array.isArray(data.targets)) parts.push(`${data.targets.length} targets`);
  if (Array.isArray(data.externalRagSources)) parts.push(`${data.externalRagSources.length} RAG sources`);
  return parts.join(" / ");
}

export function getRunStatus(result) {
  const data = parseRunResult(result);
  return String(data.status || data.raw || "unknown").toLowerCase();
}

export function mergePostsById(currentPosts, nextPosts) {
  const seen = new Set();
  return [...currentPosts, ...nextPosts].filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}

export function buildSystemReadinessCards({ providerReadiness = [], knowledgeSources = [], tasks = [] } = {}) {
  const readyProviders = providerReadiness.filter((provider) => provider.ready).length;
  return [
    { label: "React", value: "UI ready", ok: true },
    { label: "FastAPI", value: "Health", ok: true },
    { label: "PostgreSQL", value: "ready schema", ok: true },
    { label: "Redis", value: "RAG cache", ok: true },
    { label: "RAG", value: `${knowledgeSources.length} sources`, ok: true },
    { label: "MCP", value: "JSON-RPC", ok: true },
    { label: "Agent", value: `${tasks.length} automations`, ok: true },
    { label: "Live APIs", value: `${readyProviders}/${providerReadiness.length} ready`, ok: readyProviders > 0 },
  ];
}
