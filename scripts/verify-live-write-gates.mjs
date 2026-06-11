const apiBase = process.env.API_BASE || "http://127.0.0.1:8000";
const unique = Date.now();
const email = `live-write-gates-${unique}@example.com`;
const password = "password123";

async function apiJson(path, token = "", options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function apiStatus(path, token = "", options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const profileFixtures = [
  {
    kind: "github",
    expectedService: "github",
    name: `Gate GitHub ${unique}`,
    source_kind: "github",
    base_url: "https://github.com/Wish-Upon-A-Star/ai-board-jungle",
    api_provider: "GitHub REST API",
    token_name: "GITHUB_TOKEN",
    token_value: `ghp_gate_${unique}`,
    rag_targets: ["issues", "commits"],
  },
  {
    kind: "notion",
    expectedService: "notion",
    name: `Gate Notion ${unique}`,
    source_kind: "notion",
    base_url: "https://www.notion.so/3797051c2f9981b4bad3fe6545622eb8",
    api_provider: "Notion API",
    token_name: "NOTION_TOKEN",
    token_value: `secret_gate_${unique}`,
    rag_targets: ["notion_pages"],
  },
  {
    kind: "figma",
    expectedService: "figma",
    name: `Gate Figma ${unique}`,
    source_kind: "figma",
    base_url: "https://www.figma.com/design/abc123456789/Gate",
    api_provider: "Figma API",
    token_name: "FIGMA_TOKEN",
    token_value: `figd_gate_${unique}`,
    rag_targets: ["figma_comments"],
  },
  {
    kind: "google_calendar",
    expectedService: "google_calendar",
    name: `Gate Calendar ${unique}`,
    source_kind: "google_calendar",
    base_url: "primary",
    api_provider: "Google Calendar API",
    token_name: "GOOGLE_ACCESS_TOKEN",
    token_value: `ya29_gate_${unique}`,
    rag_targets: ["calendar_events"],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const createdProfileIds = [];

try {
  const register = await apiJson("/api/auth/register", "", {
    method: "POST",
    body: JSON.stringify({ email, name: "Live Gate User", password }),
  });
  const token = register.token;
  assert(token, "registration did not return a token");

  const checked = [];
  for (const fixture of profileFixtures) {
    const created = await apiJson("/api/integration-profiles", token, {
      method: "POST",
      body: JSON.stringify({
        ...fixture,
        ai_provider: "OpenAI",
        ai_model: "gpt-4o-mini",
        ai_api_base: "https://api.openai.com/v1",
      }),
    });
    const profile = created.profile;
    createdProfileIds.push(profile.id);
    assert(profile.hasToken === true, `${fixture.kind} profile did not store token`);
    assert(profile.tokenStorage === "encrypted", `${fixture.kind} token storage must be encrypted`);
    assert(!JSON.stringify(profile).includes(fixture.token_value), `${fixture.kind} raw token leaked in profile response`);

    const dryRun = await apiJson(`/api/integration-profiles/${profile.id}/write`, token, {
      method: "POST",
      body: JSON.stringify({
        title: `Dry run ${fixture.kind}`,
        body: "Verify that AI Board can prepare this provider write without external mutation.",
        dry_run: true,
      }),
    });
    assert(dryRun.write?.dryRun === true, `${fixture.kind} dry-run flag was not preserved`);
    assert(dryRun.write?.service === fixture.expectedService, `${fixture.kind} write service mismatch`);
    assert(["ready", "blocked"].includes(dryRun.write?.status), `${fixture.kind} dry-run status must be ready or blocked`);
    assert(!JSON.stringify(dryRun).includes(fixture.token_value), `${fixture.kind} raw token leaked in dry-run response`);

    const blockedLive = await apiStatus(`/api/integration-profiles/${profile.id}/write`, token, {
      method: "POST",
      body: JSON.stringify({
        title: `Blocked live ${fixture.kind}`,
        body: "This live write must be blocked without confirmation.",
        dry_run: false,
      }),
    });
    assert(blockedLive.status === 400, `${fixture.kind} live write without confirmation must be blocked`);
    assert(JSON.stringify(blockedLive.data).includes("WRITE LIVE"), `${fixture.kind} live write block message must mention WRITE LIVE`);

    checked.push({
      provider: fixture.kind,
      profileId: profile.id,
      dryRunStatus: dryRun.write.status,
      liveWithoutConfirmationStatus: blockedLive.status,
    });
  }

  const readiness = await apiJson("/api/provider-readiness", token);
  const readinessByKey = Object.fromEntries(readiness.providers.map((provider) => [provider.key, provider]));
  for (const fixture of profileFixtures) {
    assert(readinessByKey[fixture.kind]?.ready === true, `${fixture.kind} readiness did not become true`);
  }

  const activities = await apiJson("/api/integration-activities?event_type=integration_profile.write&dry_run=true&limit=20", token);
  for (const fixture of profileFixtures) {
    assert(
      activities.activities.some((activity) => activity.provider === fixture.kind && activity.details?.dryRun === true),
      `${fixture.kind} dry-run activity was not recorded`,
    );
  }

  console.log(JSON.stringify({
    ok: true,
    apiBase,
    email,
    checked: [
      "register",
      "create encrypted user profiles for github/notion/figma/google_calendar",
      "raw token redaction",
      "provider dry-run writes",
      "live writes blocked without WRITE LIVE confirmation",
      "provider readiness",
      "dry-run integration activities",
    ],
    providers: checked,
  }, null, 2));
} finally {
  if (createdProfileIds.length) {
    const login = await apiJson("/api/auth/login", "", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (login?.token) {
      for (const profileId of createdProfileIds) {
        await apiStatus(`/api/integration-profiles/${profileId}`, login.token, { method: "DELETE" }).catch(() => {});
      }
    }
  }
}
