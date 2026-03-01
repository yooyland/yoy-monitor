import { JsonRpcProvider, Contract, formatUnits, toNumber } from 'ethers';
import { ENV } from '../config/env.js';
import { erc20Iface, TRANSFER_TOPIC } from './erc20.js';
import { insertTx, getSyncCursor, setSyncCursor } from '../db/index.js';
import { isMonitoredLower } from './addressCache.js';

const provider = new JsonRpcProvider(ENV.INFURA_HTTPS, ENV.CHAIN_ID);

export async function initialBackfill() {
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - ENV.BACKFILL_BLOCKS);
  await rangeBackfill(fromBlock, latest, 'backfill');
  await setSyncCursor(latest);
}

export async function miniBackfillLoop() {
  while (true) {
    try {
      const latest = await provider.getBlockNumber();
      const from = Math.max(0, latest - ENV.MINI_BACKFILL_BLOCKS);
      await rangeBackfill(from, latest, 'backfill');
      await setSyncCursor(latest);
    } catch (e) {
      console.warn('[MiniBackfill] error:', String((e as any)?.message || e));
    }
    await new Promise((r) => setTimeout(r, 60000));
  }
}

async function rangeBackfill(fromBlock: number, toBlock: number, source: 'backfill') {
  if (toBlock < fromBlock) return;
  const step = 2000;
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = Math.min(toBlock, start + step - 1);
    try {
      const logs = await provider.getLogs({
        address: ENV.YOY_CONTRACT,
        topics: [TRANSFER_TOPIC],
        fromBlock: start,
        toBlock: end
      });
      for (const log of logs) {
        try {
          const from = '0x' + log.topics[1].slice(26);
          const to = '0x' + log.topics[2].slice(26);
          const fromLower = from.toLowerCase();
          const toLower = to.toLowerCase();
          if (!isMonitoredLower(fromLower) && !isMonitoredLower(toLower)) continue;
          const parsed = erc20Iface.decodeEventLog('Transfer', log.data, log.topics);
          const value = parsed[2] as bigint;
          await insertTx({
            txHash: String(log.transactionHash),
            logIndex: Number((log as any).index ?? (log as any).logIndex ?? 0),
            blockNumber: Number(log.blockNumber || 0),
            from: fromLower,
            to: toLower,
            amount: value.toString(),
            status: 'success',
            timestamp: new Date(),
            source
          });
        } catch {}
      }
      console.log(`[Backfill] ${start} - ${end} (${logs.length} logs)`);
    } catch (e) {
      console.warn(`[Backfill] range ${start}-${end} failed:`, String((e as any)?.message || e));
    }
  }
}

