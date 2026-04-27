/**
 * Resolve Postgres connection settings for Render / local.
 * Priority:
 * 1) DATABASE_URL (Render External Database URL) — required to be a full URL with resolvable host
 * 2) PGHOST + PGUSER + PGPASSWORD + PGDATABASE (+ optional PGPORT) — only when DATABASE_URL is not set
 *
 * If DATABASE_URL is set but invalid, we do NOT fall back to PGHOST (avoids confusing "wrong env" bugs).
 */

export type DbConnectionSource = "DATABASE_URL" | "PGHOST_ENV";

export type ResolvedDbConnection = {
  connectionString: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  source: DbConnectionSource;
};

let cached: ResolvedDbConnection | null = null;

function trimEnv(k: string): string {
  return String(process.env[k] ?? "").trim();
}

/** Hostname must look resolvable (Render uses multi-label FQDN). */
export function isLikelyResolvableDbHost(host: string): boolean {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return h.includes(".");
}

function sslForHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return false;
  return true;
}

/** Log DATABASE_URL shape without password (for Render mis-paste diagnosis). */
export function summarizeDatabaseUrlSafe(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "(empty)";
  try {
    const u = new URL(s);
    const proto = u.protocol.replace(":", "");
    const host = u.hostname || "(no-host)";
    const port = u.port || "(default)";
    const db = (u.pathname || "").replace(/^\//, "").split("/")[0] || "(no-db)";
    const user = u.username ? decodeURIComponent(u.username) : "(no-user)";
    return `${proto}://${user}:***@${host}:${port}/${db}`;
  } catch {
    return "(unparseable URL — check for spaces, missing @host, or truncated copy)";
  }
}

function parseDatabaseUrl(raw: string, label: "DATABASE_URL"): ResolvedDbConnection {
  let u: URL;
  try {
    u = new URL(raw);
  } catch (e: any) {
    throw new Error(
      `[DB] Invalid ${label}: cannot parse as URL (${String(e?.message || e)}). ` +
        `Sanitized: ${summarizeDatabaseUrlSafe(raw)}. ` +
        `On Render: PostgreSQL → Connections → copy full External Database URL (postgresql://...).`
    );
  }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) {
    throw new Error(`[DB] Invalid ${label}: protocol must be postgres:// or postgresql:// (got ${u.protocol})`);
  }
  const host = u.hostname;
  const port = Number(u.port || 5432);
  const database = u.pathname.replace(/^\//, "").split("/")[0] || "";
  const user = decodeURIComponent(u.username || "");
  if (!host) {
    throw new Error(
      `[DB] Invalid ${label}: missing host after @. Sanitized: ${summarizeDatabaseUrlSafe(raw)}.`
    );
  }
  if (!database) {
    throw new Error(`[DB] Invalid ${label}: missing database name in path (e.g. ...host:5432/mydb).`);
  }
  if (!user) {
    throw new Error(`[DB] Invalid ${label}: missing username before password.`);
  }
  if (!isLikelyResolvableDbHost(host)) {
    throw new Error(
      `[DB] Invalid ${label}: host "${host}" is not a full DNS name (ENOTFOUND is common here). ` +
        `Render Postgres hosts look like "dpg-xxxxx.<region>-postgres.render.com". ` +
        `You pasted a truncated hostname. Fix Render env DATABASE_URL to the full External Database URL. ` +
        `Sanitized: ${summarizeDatabaseUrlSafe(raw)}.`
    );
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`[DB] Invalid ${label}: bad port "${u.port}".`);
  }
  const ssl = sslForHost(host);
  return {
    connectionString: raw,
    host,
    port,
    database,
    user,
    ssl,
    source: "DATABASE_URL",
  };
}

function buildFromPgEnv(): ResolvedDbConnection {
  const host = trimEnv("PGHOST");
  const user = trimEnv("PGUSER");
  const password = trimEnv("PGPASSWORD");
  const database = trimEnv("PGDATABASE");
  const portStr = trimEnv("PGPORT");
  const port = portStr ? Number(portStr) : 5432;

  const missing: string[] = [];
  if (!host) missing.push("PGHOST");
  if (!user) missing.push("PGUSER");
  if (!password) missing.push("PGPASSWORD");
  if (!database) missing.push("PGDATABASE");
  if (missing.length) {
    throw new Error(
      `[DB] Missing database configuration. Either set DATABASE_URL (recommended on Render: External Database URL) ` +
        `or all of: ${missing.join(", ")}.`
    );
  }
  if (!isLikelyResolvableDbHost(host)) {
    throw new Error(
      `[DB] PGHOST="${host}" is not a full DNS name. Use the full Render hostname (must contain a dot), e.g. *.render.com.`
    );
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`[DB] Invalid PGPORT="${portStr}".`);
  }
  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(password);
  const connectionString = `postgresql://${encUser}:${encPass}@${host}:${port}/${database}`;
  return {
    connectionString,
    host,
    port,
    database,
    user,
    ssl: sslForHost(host),
    source: "PGHOST_ENV",
  };
}

export function logDatabaseConnectionSafe(res: ResolvedDbConnection): void {
  console.log(
    `[DB] resolved: source=${res.source} host=${res.host} port=${res.port} database=${res.database} user=${res.user} ssl=${res.ssl ? "on" : "off"}`
  );
}

export function getResolvedDatabaseConnection(): ResolvedDbConnection {
  if (cached) return cached;

  const rawUrl = trimEnv("DATABASE_URL");
  const hasUrl = rawUrl.length > 0;

  console.log(
    `[DB] config: DATABASE_URL=${hasUrl ? "set" : "unset"} preview=${hasUrl ? summarizeDatabaseUrlSafe(rawUrl) : "(n/a)"}; ` +
      `PGHOST=${trimEnv("PGHOST") ? "set" : "unset"}`
  );

  let resolved: ResolvedDbConnection;

  if (hasUrl) {
    resolved = parseDatabaseUrl(rawUrl, "DATABASE_URL");
  } else {
    resolved = buildFromPgEnv();
    console.log("[DB] DATABASE_URL not set; using PGHOST/PGUSER/PGPASSWORD/PGDATABASE (+ optional PGPORT).");
  }

  logDatabaseConnectionSafe(resolved);
  cached = resolved;
  return resolved;
}

export function pgSslOption(resolved: ResolvedDbConnection): { rejectUnauthorized: false } | undefined {
  return resolved.ssl ? { rejectUnauthorized: false } : undefined;
}
