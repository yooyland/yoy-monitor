import "dotenv/config";
import { getAddress } from "ethers";
import { getResolvedDatabaseConnection } from "./dbConnection.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.error(`[ENV] Missing env: ${k}`);
    throw new Error(`Missing env: ${k}`);
  }
  return v;
};

function parseMonitoredErc20s(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [addr, symbol, decStr] = entry.split(":");
      return {
        address: getAddress(addr),
        symbol: String(symbol || "").toUpperCase(),
        decimals: Number(decStr || "18"),
      };
    });
}

/** Postgres: DATABASE_URL first (Render full External URL). If unset, PGHOST+PGUSER+PGPASSWORD+PGDATABASE(+PGPORT). Invalid DATABASE_URL does not fall back to PGHOST. */
const _db = getResolvedDatabaseConnection();

export const ENV = {
  CHAIN_ID: Number(process.env.CHAIN_ID || 1),
  INFURA_HTTPS: need("INFURA_HTTPS"),
  INFURA_WSS: need("INFURA_WSS"),
  ETHERSCAN_API_KEY: need("ETHERSCAN_API_KEY"),
  YOY_CONTRACT: getAddress(need("YOY_CONTRACT")),
  DATABASE_URL: _db.connectionString,
  BACKFILL_BLOCKS: Number(process.env.BACKFILL_BLOCKS || 20000),
  MINI_BACKFILL_BLOCKS: Number(process.env.MINI_BACKFILL_BLOCKS || 200),
  ETHERSCAN_POLL_INTERVAL: Number(process.env.ETHERSCAN_POLL_INTERVAL || 60000),
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 25),
  API_PORT: Number(process.env.PORT || process.env.API_PORT || 8080),
  MONITORED_ERC20S: parseMonitoredErc20s(process.env.MONITORED_ERC20S || `${process.env.YOY_CONTRACT}:YOY:18`),
};

