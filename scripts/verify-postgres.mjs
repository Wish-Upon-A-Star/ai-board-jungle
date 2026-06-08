import { start, stop, waitFor } from "./verify-helpers.mjs";
import { assertPostgresUrl, postgresDatabaseUrl, postgresEnv } from "./postgres-env.mjs";

const port = process.env.AI_BOARD_POSTGRES_VERIFY_PORT || "8140";
const dbUrl = postgresDatabaseUrl();
assertPostgresUrl(dbUrl);

const api = start("python", ["-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", port], postgresEnv());

try {
  await waitFor(`http://127.0.0.1:${port}/api/health`, 60000);
  const register = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `postgres-${Date.now()}@example.com`,
      name: "Postgres User",
      password: "password123",
    }),
  });
  if (!register.ok) {
    throw new Error(`PostgreSQL-backed register failed: ${register.status} ${await register.text()}`);
  }
  const data = await register.json();
  const token = data.token;
  const profile = await fetch(`http://127.0.0.1:${port}/api/integration-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: "Postgres Notion writer",
      source_kind: "notion",
      base_url: "1234567890abcdef1234567890abcdef",
      api_provider: "Notion API",
      token_name: "NOTION_TOKEN",
      token_value: "postgres_secret_value",
      rag_targets: ["notion_database"],
    }),
  });
  if (!profile.ok) {
    throw new Error(`PostgreSQL-backed profile create failed: ${profile.status} ${await profile.text()}`);
  }
  const list = await fetch(`http://127.0.0.1:${port}/api/integration-profiles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listed = await list.json();
  if (!listed.profiles?.some((item) => item.sourceKind === "notion" && item.tokenStorage)) {
    throw new Error("PostgreSQL-backed profile list did not return the saved Notion profile");
  }
  console.log(JSON.stringify({
    ok: true,
    database: "postgresql",
    url: dbUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@"),
    checked: ["FastAPI startup", "register", "integration profile insert", "integration profile read"],
  }, null, 2));
} finally {
  stop(api);
}
