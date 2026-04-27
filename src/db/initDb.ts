import "dotenv/config";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import url from "url";
import { getResolvedDatabaseConnection, pgSslOption } from "../config/dbConnection.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

type InitOptions = {
  continueOnError?: boolean;
};

function formatDbInitError(e: unknown): string {
  const err = e as any;
  const msg = String(err?.message || e);
  const code = err?.code ? String(err.code) : "";
  const parts = [`[DB] initDb failed: ${msg}`];
  if (code) parts.push(`code=${code}`);
  if (code === "ENOTFOUND") {
    parts.push(
      "hint=DNS could not resolve DB host. Fix Render DATABASE_URL: PostgreSQL → Connections → copy full External Database URL (host must look like dpg-....<region>-postgres.render.com)."
    );
  }
  if (code === "ECONNREFUSED") {
    parts.push("hint=TCP connection refused (wrong port/host or DB not reachable from Render region).");
  }
  if (code === "28P01" || /password authentication failed/i.test(msg)) {
    parts.push("hint=Check DATABASE_URL user/password or rotate DB password on Render.");
  }
  parts.push(
    "env=DATABASE_URL takes priority; PGHOST_* is used only when DATABASE_URL is unset. See server log lines [DB] config: and [DB] resolved:"
  );
  return parts.join(" ");
}

/**
 * Initialize database schema by executing src/db/schema.sql
 * - Uses CREATE TABLE IF NOT EXISTS so it is idempotent
 * - When continueOnError=true, logs errors and continues without throwing
 */
export async function initDb(options: InitOptions = {}) {
  const { continueOnError = true } = options;
  let pool: Pool | null = null;
  try {
    const resolved = getResolvedDatabaseConnection();

    const schemaPath = path.join(__dirname, "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");
    pool = new Pool({
      connectionString: resolved.connectionString,
      ssl: pgSslOption(resolved),
    });
    await pool.query(sql);
    console.log("[DB] Schema initialized (idempotent).");
    await pool.query(`ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS asset_symbol TEXT NOT NULL DEFAULT 'YOY'`);
    await pool.query(`ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS asset_contract TEXT`);
    await pool.query(`ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS is_native BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS balances_multi (
        address TEXT NOT NULL,
        asset_key TEXT NOT NULL,
        token_balance TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (address, asset_key)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        uid TEXT NOT NULL,
        address TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (uid, address)
      )
    `);
  } catch (e: unknown) {
    const line = formatDbInitError(e);
    console.error(line);
    if (!continueOnError) {
      throw new Error(line);
    }
  } finally {
    try {
      await pool?.end();
    } catch {}
  }
}

if (process.argv[1] && process.argv[1].endsWith("initDb.js")) {
  initDb({ continueOnError: false })
    .then(() => {
      console.log("[DB] initDb completed.");
      process.exit(0);
    })
    .catch((e) => {
      console.error(formatDbInitError(e));
      process.exit(1);
    });
}
