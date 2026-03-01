import 'dotenv/config';
import { getAddress } from 'ethers';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

export const ENV = {
  CHAIN_ID: Number(process.env.CHAIN_ID || 1),
  INFURA_HTTPS: need('INFURA_HTTPS'),
  INFURA_WSS: need('INFURA_WSS'),
  ETHERSCAN_API_KEY: need('ETHERSCAN_API_KEY'),
  YOY_CONTRACT: getAddress(need('YOY_CONTRACT')),
  DATABASE_URL: need('DATABASE_URL'),
  BACKFILL_BLOCKS: Number(process.env.BACKFILL_BLOCKS || 20000),
  MINI_BACKFILL_BLOCKS: Number(process.env.MINI_BACKFILL_BLOCKS || 200),
  ETHERSCAN_POLL_INTERVAL: Number(process.env.ETHERSCAN_POLL_INTERVAL || 60000),
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 25)
};

