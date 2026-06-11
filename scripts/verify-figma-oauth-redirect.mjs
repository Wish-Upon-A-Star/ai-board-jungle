const publicUrl = (process.env.AI_BOARD_TEST_PUBLIC_URL || "https://railway-mediterranean-snap-populations.trycloudflare.com").replace(/\/$/, "");
const apiBase = (process.env.API_BASE || publicUrl).replace(/\/$/, "");

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-ai-board-public-origin": publicUrl,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const login = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const data = await jsonFetch("/api/oauth/figma/start", {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const parsed = new URL(data.authorizeUrl);
  const clientId = parsed.searchParams.get("client_id") || "";
  const redirectUri = parsed.searchParams.get("redirect_uri") || "";
  if (clientId.includes(":")) throw new Error("Figma client_id still contains a label separator");
  if (redirectUri !== `${publicUrl}/api/oauth/figma/callback`) {
    throw new Error(`Unexpected Figma redirect_uri: ${redirectUri}`);
  }
  if (data.redirectUri !== redirectUri) {
    throw new Error(`Response redirectUri mismatch: ${data.redirectUri}`);
  }
  if (!data.redirectUriSource) {
    throw new Error("Figma OAuth start response must expose redirectUriSource");
  }
  console.log(JSON.stringify({
    ok: true,
    checked: ["login", "figma_oauth_start", "client_id_sanitized", "public_origin_redirect_uri", "redirect_uri_source_visible"],
    apiBase,
    publicUrl,
    redirectUri,
    redirectUriSource: data.redirectUriSource,
    clientIdMasked: `${clientId.slice(0, 4)}...${clientId.slice(-4)}`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
