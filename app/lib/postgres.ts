import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

const globalForPostgres = globalThis as typeof globalThis & {
  __coinbizPostgresSql?: SqlClient;
};

function normalizeConnectionString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "undefined" ? trimmed : "";
}

export function getPostgresConnectionString() {
  return (
    normalizeConnectionString(process.env.POSTGRES_URL) ||
    normalizeConnectionString(process.env.POSTGRES_PRISMA_URL) ||
    normalizeConnectionString(process.env.POSTGRES_URL_NON_POOLING)
  );
}

export function isPostgresConfigured() {
  return Boolean(getPostgresConnectionString());
}

function shouldRequireSsl(connectionString: string) {
  try {
    const url = new URL(
      connectionString.replace(/^postgres(?:ql)?:\/\//, "https://"),
    );
    return url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

export function getPostgresSql() {
  const connectionString = getPostgresConnectionString();

  if (!connectionString) {
    throw new Error("Postgres is not configured.");
  }

  if (!globalForPostgres.__coinbizPostgresSql) {
    globalForPostgres.__coinbizPostgresSql = postgres(connectionString, {
      connect_timeout: 8,
      idle_timeout: 20,
      max: 1,
      prepare: false,
      ssl: shouldRequireSsl(connectionString) ? "require" : false,
    });
  }

  return globalForPostgres.__coinbizPostgresSql;
}
