import 'dotenv/config';
import { ENV } from './config/env.js';
import { initDb } from './db/initDb.js';
import { warmAddressCache, getCacheSize } from './services/addressCache.js';
import { startRealtimeListener } from './services/realtimeListener.js';
import { initialBackfill, miniBackfillLoop } from './services/backfill.js';
import { startApiServer } from './api/server.js';

async function main() {
  console.log('[App] Starting YOY monitor on chain', ENV.CHAIN_ID);
  // Initialize DB schema once on startup; don't crash if it fails
  await initDb({ continueOnError: true });
  await warmAddressCache();
  console.log('[App] Monitored addresses in cache:', getCacheSize());

  await initialBackfill();
  void miniBackfillLoop();
  void startRealtimeListener();

  // Start HTTP API for app integration
  startApiServer();
}

main().catch((e) => {
  const msg = String((e as any)?.message || e);
  console.error('[App] Fatal error:', msg);
  if (/ENOTFOUND|DATABASE_URL|PGHOST|initDb|\[DB\]/i.test(msg)) {
    console.error(
      '[App] DB hint: On Render set DATABASE_URL to PostgreSQL → Connections → External Database URL (full host like dpg-....region-postgres.render.com). PGHOST_* is only used when DATABASE_URL is unset.'
    );
  }
  process.exit(1);
});
