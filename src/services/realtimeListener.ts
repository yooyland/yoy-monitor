import { WebSocketProvider, Log } from 'ethers';
import { ENV } from '../config/env.js';
import { erc20Iface, TRANSFER_TOPIC, getMonitoredTokens } from './erc20.js';
import { insertTx } from '../db/index.js';
import { isMonitoredLower } from './addressCache.js';

export async function startRealtimeListener() {
  const ws = new WebSocketProvider(ENV.INFURA_WSS, ENV.CHAIN_ID);
  const tokenAddrs = getMonitoredTokens().map(t => t.address);
  const filter = { address: tokenAddrs, topics: [TRANSFER_TOPIC] } as any;
  const onLog = async (log: Log) => {
    try {
      if (!log.topics || log.topics.length < 3) return;
      const from = '0x' + log.topics[1].slice(26);
      const to = '0x' + log.topics[2].slice(26);
      const parsed = erc20Iface.decodeEventLog('Transfer', log.data, log.topics);
      const value = parsed[2] as bigint;

      const fromLower = from.toLowerCase();
      const toLower = to.toLowerCase();
      if (!isMonitoredLower(fromLower) && !isMonitoredLower(toLower)) return;

      const addr = String(log.address);
      const tok = getMonitoredTokens().find(t => t.address.toLowerCase() === addr.toLowerCase());
      const symbol = tok?.symbol || 'TOKEN';

      await insertTx({
        txHash: String(log.transactionHash),
        logIndex: Number((log as any).index ?? (log as any).logIndex ?? 0),
        blockNumber: Number(log.blockNumber || 0),
        from: fromLower,
        to: toLower,
        amount: value.toString(),
        status: 'success',
        timestamp: new Date(),
        source: 'wss',
        asset_symbol: symbol,
        asset_contract: addr,
        is_native: false
      });
    } catch (e) {
      console.warn('[WSS] handle log error:', String((e as any)?.message || e));
    }
  };
  ws.on(filter as any, onLog as any);
  console.log('[WSS] subscribed to YOY Transfer events');
}

