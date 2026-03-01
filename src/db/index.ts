import { Pool } from 'pg';
import { ENV } from '../config/env.js';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  // SSL이 필요한 호스팅의 경우 아래 주석 해제
  // ssl: { rejectUnauthorized: false }
});

export async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

export async function getAllActiveAddresses(): Promise<string[]> {
  const r = await pool.query(`SELECT address FROM monitored_addresses WHERE is_active = TRUE`);
  return r.rows.map((x: any) => x.address);
}

export async function getBalanceByAddress(addrChecksum: string): Promise<string|null> {
  const r = await pool.query(`SELECT token_balance FROM balances WHERE address=$1 LIMIT 1`, [addrChecksum]);
  if ((r.rowCount ?? 0) === 0) return null;
  return String(r.rows[0].token_balance);
}

export async function upsertAddress(addrChecksum: string, userId?: string) {
  await pool.query(
    `INSERT INTO monitored_addresses (address, user_id, is_active)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (address) DO UPDATE
     SET is_active=TRUE, user_id=COALESCE(EXCLUDED.user_id, monitored_addresses.user_id)`,
    [addrChecksum, userId || null]
  );
}

export async function getTransactionsForAddress(addrLower: string, opts: { page: number; limit: number; }) {
  const offset = (opts.page - 1) * opts.limit;
  const r = await pool.query(
    `SELECT tx_hash, log_index, block_number, from_address, to_address, amount, status, timestamp, source
     FROM token_transactions
     WHERE from_address = $1 OR to_address = $1
     ORDER BY block_number DESC NULLS LAST, log_index DESC
     LIMIT $2 OFFSET $3`,
    [addrLower, opts.limit, offset]
  );
  return r.rows;
}

export async function insertTx(rec: {
  txHash: string; logIndex: number;
  blockNumber: number;
  from: string; to: string;
  amount: string|null;
  status: 'success'|'failed';
  timestamp: Date;
  source: 'wss'|'backfill'|'etherscan';
}) {
  await pool.query(
    `INSERT INTO token_transactions
     (tx_hash, log_index, block_number, from_address, to_address, amount, status, timestamp, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [rec.txHash, rec.logIndex, rec.blockNumber, rec.from, rec.to, rec.amount, rec.status, rec.timestamp, rec.source]
  );
}

export async function hasTx(txHash: string, logIndex: number) {
  const r = await pool.query(
    `SELECT 1 FROM token_transactions WHERE tx_hash=$1 AND log_index=$2 LIMIT 1`,
    [txHash, logIndex]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function hasTxHashAnyIndex(txHash: string) {
  const r = await pool.query(`SELECT 1 FROM token_transactions WHERE tx_hash=$1 LIMIT 1`, [txHash]);
  return (r.rowCount ?? 0) > 0;
}

export async function setBalance(addrChecksum: string, balance: string) {
  await pool.query(
    `INSERT INTO balances (address, token_balance)
     VALUES ($1, $2)
     ON CONFLICT (address)
     DO UPDATE SET token_balance=EXCLUDED.token_balance, updated_at=NOW()`,
    [addrChecksum, balance]
  );
}

export async function getSyncCursor(): Promise<number|null> {
  const r = await pool.query(`SELECT value FROM sync_state WHERE key='last_backfill_block' LIMIT 1`);
  if (!r.rowCount) return null;
  return Number(r.rows[0].value || 0);
}

export async function setSyncCursor(block: number) {
  await pool.query(
    `INSERT INTO sync_state (key, value)
     VALUES ('last_backfill_block', $1)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [String(block)]
  );
}

