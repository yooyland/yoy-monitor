import fetch from 'node-fetch';
import { ENV } from '../config/env.js';
import { insertTx, hasTxHashAnyIndex } from '../db/index.js';
import { isMonitoredLower } from './addressCache.js';
import { getMonitoredTokens } from './erc20.js';

type Tx = {
  hash: string;
  nonce: string;
  blockHash: string;
  blockNumber: string;
  transactionIndex: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  input: string;
  timeStamp: string;
};

function decodeMethod(input: string) {
  const sig = (input || '').slice(0, 10).toLowerCase(); // 4 bytes + 0x
  // transfer(address,uint256) 0xa9059cbb
  // transferFrom(address,address,uint256) 0x23b872dd
  if (sig === '0xa9059cbb') return 'transfer';
  if (sig === '0x23b872dd') return 'transferFrom';
  return null;
}

function tryDecodeToAndValue(input: string) {
  try {
    const data = (input || '').replace(/^0x/i, '');
    const method = data.slice(0, 8);
    if (method === 'a9059cbb') {
      const to = '0x' + data.slice(8 + 24, 8 + 64);
      const valHex = '0x' + data.slice(8 + 64, 8 + 128);
      return { to, value: BigInt(valHex).toString() };
    }
    if (method === '23b872dd') {
      const to = '0x' + data.slice(8 + 64 + 24, 8 + 128);
      const valHex = '0x' + data.slice(8 + 128, 8 + 192);
      return { to, value: BigInt(valHex).toString() };
    }
  } catch {}
  return null;
}

async function getTxReceiptStatus(txhash: string): Promise<'success'|'failed'|null> {
  try {
    const url = `https://api.etherscan.io/api?module=transaction&action=gettxreceiptstatus&txhash=${txhash}&apikey=${encodeURIComponent(ENV.ETHERSCAN_API_KEY)}`;
    const res = await fetch(url);
    const data = (await res.json()) as any;
    const s = data?.result?.status;
    if (s === '1') return 'success';
    if (s === '0') return 'failed';
    return null;
  } catch {
    return null;
  }
}

async function fetchTxList(address: string) {
  const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${encodeURIComponent(ENV.ETHERSCAN_API_KEY)}`;
  const res = await fetch(url);
  const data = (await res.json()) as any;
  if (!data?.result || !Array.isArray(data.result)) {
    console.log('No result from Etherscan');
    return [];
  }
  if (data.status !== '1') return [];
  return data.result as Tx[];
}

export async function startEtherscanPolling() {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (true) {
    try {
      // We don't have direct address iteration here, but we filter by monitored in handleTx
      // Instead of per-address API (which we still do), we will round-robin by addresses drawn from memory cache if needed
      // For simplicity: we call account.txlist for each monitored address is not available here.
      // So we will rely on the real implementation to iterate known addresses.
      await delay(ENV.ETHERSCAN_POLL_INTERVAL);
    } catch (e) {
      console.warn('[Etherscan] loop error:', String((e as any)?.message || e));
      await delay(ENV.ETHERSCAN_POLL_INTERVAL);
    }
  }
}

// For explicit polling batches by caller with provided addresses
export async function pollAddressesOnce(addressesLower: string[]) {
  for (const addrLower of addressesLower) {
    try {
      const txs = await fetchTxList(addrLower);
      const tokenIndex = new Map(getMonitoredTokens().map(t => [t.address.toLowerCase(), t]));
      for (const tx of txs) {
        try {
          // ERC-20 contract interactions
          if (tx.to && tokenIndex.has(tx.to.toLowerCase())) {
            const tok = tokenIndex.get(tx.to.toLowerCase())!;
            const method = decodeMethod(tx.input);
            if (!method) continue;
            const decoded = tryDecodeToAndValue(tx.input);
            const decodedTo = decoded?.to || null;
            const decodedVal = decoded?.value || null;
            const involvesMonitored =
              isMonitoredLower((tx.from || '').toLowerCase()) ||
              (decodedTo ? isMonitoredLower(decodedTo.toLowerCase()) : false);
            if (!involvesMonitored) continue;

            if (await hasTxHashAnyIndex(tx.hash)) continue; // already seen via logs

            const status = await getTxReceiptStatus(tx.hash);
            if (!status) continue;

            await insertTx({
              txHash: tx.hash,
              logIndex: -1, // Etherscan rows always -1 (ERC-20)
              blockNumber: Number(tx.blockNumber || 0),
              from: String(tx.from || '').toLowerCase(),
              to: (decodedTo || String(tx.to || '')).toLowerCase(),
              amount: decodedVal ? decodedVal : null,
              status,
              timestamp: new Date(Number(tx.timeStamp || '0') * 1000),
              source: 'etherscan',
              asset_symbol: tok.symbol,
              asset_contract: tok.address,
              is_native: false
            });
            continue;
          }

          // Native ETH transfer: value > 0
          const val = BigInt(tx.value || '0');
          if (val > 0n) {
            const involvesMonitored =
              isMonitoredLower((tx.from || '').toLowerCase()) ||
              isMonitoredLower((tx.to || '').toLowerCase());
            if (!involvesMonitored) continue;
            if (await hasTxHashAnyIndex(tx.hash)) continue;
            const status = await getTxReceiptStatus(tx.hash);
            if (!status) continue;
            await insertTx({
              txHash: tx.hash,
              logIndex: -2, // Native ETH marker to avoid clash with -1
              blockNumber: Number(tx.blockNumber || 0),
              from: String(tx.from || '').toLowerCase(),
              to: String(tx.to || '').toLowerCase(),
              amount: val.toString(),
              status,
              timestamp: new Date(Number(tx.timeStamp || '0') * 1000),
              source: 'etherscan',
              asset_symbol: 'ETH',
              asset_contract: null,
              is_native: true
            });
          }
        } catch {}
      }
    } catch (e) {
      console.warn('[Etherscan] address poll failed:', addrLower, String((e as any)?.message || e));
    }
  }
}

