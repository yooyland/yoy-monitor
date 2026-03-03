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

function maskApiKeyInUrl(u: string): string {
  return u.replace(/(apikey=)[^&]+/i, '$1***');
}

const RATE_DELAY_MS = 1200; // at least 1.2s between requests
const MAX_RETRIES = 4;      // 1 + 3 retries with backoff
let lastEtherscanCallAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithLogs(url: string): Promise<any | null> {
  const masked = maskApiKeyInUrl(url);
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt += 1;
    // Global spacing across all Etherscan calls
    const now = Date.now();
    const waitMs = Math.max(0, RATE_DELAY_MS - (now - lastEtherscanCallAt));
    if (waitMs > 0) await sleep(waitMs);
    lastEtherscanCallAt = Date.now();
    try {
      const res = await fetch(url);
      const ct = String(res.headers.get('content-type') || '');
      const status = res.status;
      const text = await res.text();
      try { console.log('[Etherscan] GET', masked, 'status=', status, 'ct=', ct, 'body.head=', text.slice(0, 120)); } catch {}
      // Guard: Non-JSON responses (e.g., HTML error pages)
      if (!text.trim().startsWith('{')) {
        throw new Error('Non-JSON from Etherscan: ' + text.slice(0, 80));
      }
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error('JSON parse failed'); }
      // Backoff if API signals non-success (status !== '1') and there is a result to check
      const apiStatus = typeof data?.status === 'string' ? data.status : undefined;
      if (apiStatus && apiStatus !== '1' && attempt < MAX_RETRIES) {
        const backoff = RATE_DELAY_MS * (2 ** (attempt - 1));
        try { console.warn('[Etherscan] api status not success (status=', apiStatus, ') retrying in', backoff, 'ms'); } catch {}
        await sleep(backoff);
        continue;
      }
      return data;
    } catch (e) {
      if (attempt >= MAX_RETRIES) {
        console.warn('[Etherscan] fetch failed (final)', masked, String((e as any)?.message || e));
        return null;
      }
      const backoff = RATE_DELAY_MS * (2 ** (attempt - 1));
      console.warn('[Etherscan] fetch failed, retrying in', backoff, 'ms', masked, String((e as any)?.message || e));
      await sleep(backoff);
      continue;
    }
  }
  return null;
}

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
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=transaction&action=gettxreceiptstatus&txhash=${txhash}&apikey=${encodeURIComponent(ENV.ETHERSCAN_API_KEY)}`;
    const data = await fetchJsonWithLogs(url);
    if (!data) return null;
    const s = data?.result?.status;
    if (s === '1') return 'success';
    if (s === '0') return 'failed';
    return null;
  } catch {
    return null;
  }
}

async function fetchTxList(address: string) {
  const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${encodeURIComponent(ENV.ETHERSCAN_API_KEY)}`;
  const data = await fetchJsonWithLogs(url);
  if (!data?.result || !Array.isArray(data.result)) {
    console.log('No result from Etherscan');
    return [];
  }
  if (data.status !== '1') return [];
  return data.result as Tx[];
}

type TokenTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  from: string;
  contractAddress: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  transactionIndex: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  input: string;
  confirmations: string;
};

async function fetchTokenTxList(addressLower: string): Promise<TokenTx[]> {
  // Query per monitored token with pagination to capture historical transfers
  const toks = getMonitoredTokens();
  const all: TokenTx[] = [];
  const pageSize = 1000; // Etherscan allows up to 10,000; stay conservative
  const maxPages = 15;   // up to 15k rows per token+address
  for (const t of toks) {
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&contractaddress=${t.address}` +
          `&address=${addressLower}&startblock=0&endblock=99999999&page=${page}&offset=${pageSize}&sort=desc&apikey=${encodeURIComponent(ENV.ETHERSCAN_API_KEY)}`;
        const data = await fetchJsonWithLogs(url);
        if (!data?.result || !Array.isArray(data.result) || data.result.length === 0) break;
        for (const j of data.result as any[]) {
          all.push(j as TokenTx);
        }
        if (data.result.length < pageSize) break;
      } catch {
        break;
      }
    }
  }
  return all;
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
      // 1) ERC-20 transfers via explicit tokentx endpoint (reliable backfill)
      const tokTxs = await fetchTokenTxList(addrLower);
      for (const tt of tokTxs) {
        try {
          if (await hasTxHashAnyIndex(tt.hash)) continue;
          // Only process if this address is either sender or receiver
          const fromLower = String(tt.from || '').toLowerCase();
          const toLower = String(tt.to || '').toLowerCase();
          if (fromLower !== addrLower && toLower !== addrLower) continue;
          const symbol = String(tt.tokenSymbol || 'YOY').toUpperCase();
          await insertTx({
            txHash: tt.hash,
            logIndex: -1,
            blockNumber: Number(tt.blockNumber || 0),
            from: fromLower,
            to: toLower,
            amount: String(tt.value || '0'),
            status: 'success', // Etherscan tokentx doesn't include receipt status; assume success here
            timestamp: new Date(Number(tt.timeStamp || '0') * 1000),
            source: 'etherscan',
            asset_symbol: symbol,
            asset_contract: String(tt.contractAddress || '').toLowerCase() || null,
            is_native: false
          });
        } catch {}
      }

      // 2) Full txlist for ETH native and ERC-20 function calls (decode)
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
            const fromLower = String(tx.from || '').toLowerCase();
            const toLower = (decodedTo || String(tx.to || '')).toLowerCase();
            if (fromLower !== addrLower && toLower !== addrLower) continue;

            if (await hasTxHashAnyIndex(tx.hash)) continue; // already seen via logs

            const status = await getTxReceiptStatus(tx.hash);
            if (!status) continue;

            await insertTx({
              txHash: tx.hash,
              logIndex: -1, // Etherscan rows always -1 (ERC-20)
              blockNumber: Number(tx.blockNumber || 0),
              from: fromLower,
              to: toLower,
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
            const fromLower = String(tx.from || '').toLowerCase();
            const toLower = String(tx.to || '').toLowerCase();
            if (fromLower !== addrLower && toLower !== addrLower) continue;
            if (await hasTxHashAnyIndex(tx.hash)) continue;
            const status = await getTxReceiptStatus(tx.hash);
            if (!status) continue;
            await insertTx({
              txHash: tx.hash,
              logIndex: -2, // Native ETH marker to avoid clash with -1
              blockNumber: Number(tx.blockNumber || 0),
              from: fromLower,
              to: toLower,
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

