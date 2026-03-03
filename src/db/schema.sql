-- monitored addresses (checksum format)
CREATE TABLE IF NOT EXISTS monitored_addresses (
  address TEXT PRIMARY KEY,        -- ethers.getAddress(…) 결과(체크섬)
  user_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- token transactions
-- NOTE: Etherscan(비로그) 행은 log_index = -1 을 사용해 UNIQUE(tx_hash, log_index) 중복 방지
CREATE TABLE IF NOT EXISTS token_transactions (
  id BIGSERIAL PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  log_index INT NOT NULL,                 -- NOT NULL (Etherscan은 -1 사용)
  block_number BIGINT,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount TEXT,                            -- 소수 문자열, 실패건은 NULL 허용
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('wss','backfill','etherscan')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_tx_block  ON token_transactions (block_number);
CREATE INDEX IF NOT EXISTS idx_tx_from   ON token_transactions (from_address);
CREATE INDEX IF NOT EXISTS idx_tx_to     ON token_transactions (to_address);
CREATE INDEX IF NOT EXISTS idx_tx_status ON token_transactions (status);

-- balances
CREATE TABLE IF NOT EXISTS balances (
  address TEXT PRIMARY KEY,
  token_balance TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- sync state for backfill cursors
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user scoped addresses
CREATE TABLE IF NOT EXISTS user_addresses (
  uid TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (uid, address)
);

