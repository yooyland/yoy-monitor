import 'dotenv/config';
import { ENV } from './config/env.js';
import { initDb } from './db/index.js';
import { warmAddressCache, getCacheSize } from './services/addressCache.js';
import { startRealtimeListener } from './services/realtimeListener.js';
import { initialBackfill, miniBackfillLoop } from './services/backfill.js';
import { pollAddressesOnce } from './services/etherscanPoller.js';

async function main() {
  console.log('[App] Starting YOY monitor on chain', ENV.CHAIN_ID);
  await initDb();
  await warmAddressCache();
  console.log('[App] Monitored addresses in cache:', getCacheSize());

  await initialBackfill();
  void miniBackfillLoop();
  void startRealtimeListener();

  // Optional: Round-robin etherscan polling for failure/missed detection.
  // In a real deployment you would retrieve addresses from DB and batch them here.
  // Example placeholder (no-op by default). Implement an address fetch + call pollAddressesOnce(list)
}

main().catch((e) => {
  console.error('[App] Fatal error:', String(e?.message || e));
  process.exit(1);
});

