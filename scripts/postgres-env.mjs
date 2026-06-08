export const defaultPostgresUrl = "postgresql://ai_board:ai_board@localhost:5432/ai_board";

export function postgresDatabaseUrl() {
  return process.env.AI_BOARD_DATABASE_URL || defaultPostgresUrl;
}

export function postgresEnv(extra = {}) {
  return {
    PYTHONPATH: "backend",
    AI_BOARD_DATABASE_URL: postgresDatabaseUrl(),
    ...extra,
  };
}

export function assertPostgresUrl(url = postgresDatabaseUrl()) {
  if (!/^postgresql(?:\+psycopg)?:\/\//.test(url)) {
    throw new Error(`AI_BOARD_DATABASE_URL must be PostgreSQL for app runtime verification, got: ${url}`);
  }
}
