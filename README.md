## YOY Monitor (ERC-20 multi-address watcher)

Production-grade monitoring service for YOY token on Ethereum Mainnet.

### Features
- Contract-level WSS subscription to `Transfer` events via Infura
- In-memory address cache for thousands of monitored addresses
- Backfill on startup (default: last 20,000 blocks)
- Periodic mini-backfills (default: last 200 blocks every 60s)
- Etherscan polling for failed/receipt-only visibility and WS gaps
- PostgreSQL persistence with robust deduplication

### Deduplication model
- `token_transactions` has `UNIQUE (tx_hash, log_index)`
- Real-time/backfill events use the on-chain `log_index` (>= 0)
- Etherscan-derived rows use `log_index = -1`
- This guarantees that the same tx from different sources never collides

### Database schema
See `src/db/schema.sql`.

Key tables:
- `monitored_addresses(address PRIMARY KEY, user_id, is_active)`
- `token_transactions(tx_hash, log_index NOT NULL, status, amount, source, ...)`
- `balances(address PRIMARY KEY, token_balance)`
- `sync_state(key PRIMARY KEY, value)` for backfill cursors

### Environment
Copy `.env.example` to `.env` and fill values:

```
CHAIN_ID=1
INFURA_HTTPS=...
INFURA_WSS=...
ETHERSCAN_API_KEY=...
YOY_CONTRACT=0xf999DA2B5132eA62A158dA8A82f2265A1b1d9701
DATABASE_URL=postgresql://...
BACKFILL_BLOCKS=20000
MINI_BACKFILL_BLOCKS=200
ETHERSCAN_POLL_INTERVAL=60000
BATCH_SIZE=25
```

### Install

```
cd yoy-monitor
npm install
```

Initialize DB schema:

```
npm run db:init
```

### Run (Dev)

```
npm run dev
```

### Build & Run (Prod)

```
npm run build
npm start
```

### Notes
- Address normalization: store checksummed in DB, lowercase in memory for matching
- WebSocket auto-reconnect with exponential backoff
- Backfills and Etherscan polling are resilient; failures are logged and retried
- Secrets are consumed from `.env`; be sure not to commit them

