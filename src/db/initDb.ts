import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { ENV } from '../config/env.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

type InitOptions = {
  continueOnError?: boolean;
};

/**
 * Initialize database schema by executing src/db/schema.sql
 * - Uses CREATE TABLE IF NOT EXISTS so it's idempotent
 * - When continueOnError=true, logs errors and continues without throwing
 */
export async function initDb(options: InitOptions = {}) {
  const { continueOnError = true } = options;
  let pool: Pool | null = null;
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    pool = new Pool({
      connectionString: ENV.DATABASE_URL,
      // If your DB requires SSL (e.g., managed Postgres), uncomment:
      // ssl: { rejectUnauthorized: false }
    });
    await pool.query(sql);
    console.log('[DB] Schema initialized (idempotent).');
    // Lightweight migrations for multi-asset support
    await pool.query(`ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS asset_symbol TEXT NOT NULL DEFAULT 'YOY'`);
    await pool.query(`ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS asset_contract TEXT`);
    await pool.query(`ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS is_native BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS balances_multi (
        address TEXT NOT NULL,
        asset_key TEXT NOT NULL, -- e.g., 'ETH' or 'YOY' or 'USDT'
        token_balance TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (address, asset_key)
      )
    `);
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.warn('[DB] initDb error:', msg);
    if (!continueOnError) throw e;
  } finally {
    try { await pool?.end(); } catch {}
  }
}

// Allow running directly: node dist/db/initDb.js
if (process.argv[1] && process.argv[1].endsWith('initDb.js')) {
  initDb({ continueOnError: false })
    .then(() => {
      console.log('[DB] initDb completed.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('[DB] initDb failed:', String(e?.message || e));
      process.exit(1);
    });
}

