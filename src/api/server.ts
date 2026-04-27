import express from 'express';
import cors from 'cors';
import { ENV } from '../config/env.js';
import { JsonRpcProvider, Contract } from 'ethers';
import { erc20Iface } from '../services/erc20.js';
import {
  upsertAddress,
  upsertUserAddress,
  getUserAddresses,
  getBalanceByAddress,
  getTransactionsForAddress,
  getBalanceMulti,
  getBalancesForUser,
  getTransactionsForUser,
  getUserAddressesWithSource
} from '../db/index.js';
import { normalizeAddress } from '../services/erc20.js';
import { refreshBalance } from '../services/balances.js';
import { firebaseAuth } from '../middleware/firebaseAuth.js';

export function startApiServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, chainId: ENV.CHAIN_ID });
  });

  // Debug: show address linkage sources
  app.get('/debug/me/addresses', firebaseAuth, async (req, res) => {
    try {
      const uid = (req as any).user?.uid as string | undefined;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const details = await getUserAddressesWithSource(uid);
      const addresses = Array.from(new Set(details.map(d => d.address)));
      res.json({ ok: true, uid, addresses, details });
    } catch (e:any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // Authenticated: current user's addresses
  app.get('/me/addresses', firebaseAuth, async (req, res) => {
    try {
      const uid = (req as any).user?.uid as string | undefined;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const list = await getUserAddresses(uid);
      res.json({ ok: true, uid, addresses: list });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  app.post('/me/addresses', firebaseAuth, async (req, res) => {
    try {
      const uid = (req as any).user?.uid as string | undefined;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const raw = String(req.body?.address || '');
      if (!raw) return res.status(400).json({ error: 'address required' });
      const checksum = normalizeAddress(raw);
      await upsertUserAddress(uid, checksum.toLowerCase());
      // Also enroll globally for monitoring and refresh its balances
      await upsertAddress(checksum, uid);
      void refreshBalance(checksum).catch(() => {});
      console.log('[me/addresses] upsert', { uid, incoming: raw, checksum, stored: checksum.toLowerCase() });
      res.json({ ok: true, uid, address: checksum, stored: checksum.toLowerCase() });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // Aggregated balances for current user (sum across owned addresses)
  app.get('/me/balances', firebaseAuth, async (req, res) => {
    try {
      const uid = (req as any).user?.uid as string | undefined;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });

      const listRaw = await getUserAddresses(uid);
      // Defensive: ensure unique lowercased addresses (avoids duplicate refresh/count confusion)
      const addrs = Array.from(new Set(listRaw.map((a) => String(a).toLowerCase())));
      if (addrs.length === 0) {
        return res.json({ ok: true, uid, addresses: [], balances: {}, refreshed: { success: 0, fail: 0 }, debug: { failures: [], note: 'no addresses registered' } });
      }

      const provider = new JsonRpcProvider(ENV.INFURA_HTTPS, ENV.CHAIN_ID);
      const yoy = new Contract(ENV.YOY_CONTRACT, erc20Iface, provider);
      const failures: Array<{ address: string; error: string }> = [];
      const queue = addrs.slice();
      const perAddress: Record<string, { YOY?: string; ETH?: string }> = {};

      const worker = async () => {
        while (queue.length) {
          const a = queue.shift()!;
          try {
            // YOY balance with simple backoff on 429
            let retries = 0;
            let ok = false;
            let yoyWei = '0';
            while (!ok && retries < 4) {
              try {
                const raw = await yoy.balanceOf(a);
                yoyWei = raw.toString();
                ok = true;
              } catch (e: any) {
                if (String(e?.message || '').includes('429')) {
                  await new Promise((r) => setTimeout(r, 500 * (2 ** retries)));
                  retries++;
                } else {
                  throw e;
                }
              }
            }

            // ETH balance with backoff
            retries = 0;
            ok = false;
            let ethWei = '0';
            while (!ok && retries < 4) {
              try {
                const raw = await provider.getBalance(a);
                ethWei = raw.toString();
                ok = true;
              } catch (e: any) {
                if (String(e?.message || '').includes('429')) {
                  await new Promise((r) => setTimeout(r, 500 * (2 ** retries)));
                  retries++;
                } else {
                  throw e;
                }
              }
            }

            perAddress[a] = { YOY: yoyWei, ETH: ethWei };
          } catch (e: any) {
            failures.push({ address: a, error: String(e?.message || e) });
          }
        }
      };

      await Promise.all([worker(), worker(), worker()]);

      const toBig = (s: string) => {
        try {
          return BigInt(s || '0');
        } catch {
          return 0n;
        }
      };
      let sumYOY = 0n;
      let sumETH = 0n;
      for (const v of Object.values(perAddress)) {
        sumYOY += toBig(v.YOY || '0');
        sumETH += toBig(v.ETH || '0');
      }

      const balances = { YOY: sumYOY.toString(), ETH: sumETH.toString() };
      res.json({
        ok: true,
        uid,
        addresses: addrs,
        refreshed: { success: addrs.length - failures.length, fail: failures.length },
        balances,
        perAddress,
        debug: {
          failures,
          asOf: new Date().toISOString(),
          units: 'wei',
          tokenDecimals: { YOY: 18, ETH: 18 },
          note: 'Balances are fetched live from chain via Infura (not from cached DB). If a tx is pending, results may change after it is mined.',
        },
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });
  // Transactions across all owned addresses
  app.get('/me/transactions', firebaseAuth, async (req, res) => {
    try {
      const uid = (req as any).user?.uid as string | undefined;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
      const addrs = await getUserAddresses(uid);
      const txs = await getTransactionsForUser(uid, { page, limit });
      res.json({ ok: true, uid, page, limit, addressesUsed: addrs.map(a=>a.toLowerCase()), transactions: txs });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // Add or reactivate a monitored address
  app.post('/monitored-addresses', async (req, res) => {
    try {
      const raw = String(req.body?.address || '');
      const userId = req.body?.user_id ? String(req.body.user_id) : undefined;
      if (!raw) return res.status(400).json({ error: 'address required' });
      const checksum = normalizeAddress(raw);
      await upsertAddress(checksum, userId);
      // Optional: refresh balance immediately
      void refreshBalance(checksum).catch(() => {});
      // Seed etherscan polling once for historical catch-up (non-blocking)
      try {
        const { pollAddressesOnce } = await import('../services/etherscanPoller.js');
        void pollAddressesOnce([checksum.toLowerCase()]).catch(() => {});
      } catch {}
      res.json({ ok: true, address: checksum });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // DEBUG: Unauthenticated address registration and immediate tokentx backfill
  app.post('/debug/register-address', async (req, res) => {
    try {
      const raw = String(req.body?.address || '');
      if (!raw) return res.status(400).json({ error: 'address required' });
      const checksum = normalizeAddress(raw);
      await upsertAddress(checksum, undefined);
      void refreshBalance(checksum).catch(() => {});
      try {
        const { pollAddressesOnce } = await import('../services/etherscanPoller.js');
        void pollAddressesOnce([checksum.toLowerCase()]).catch(() => {});
      } catch {}
      res.json({ ok: true, address: checksum, note: 'debug registration queued backfill' });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // Get balance for an address; if ?asset= omitted, returns multi-assets map
  app.get('/balances/:address', async (req, res) => {
    try {
      const checksum = normalizeAddress(String(req.params.address));
      const asset = req.query.asset ? String(req.query.asset).toUpperCase() : undefined;
      if (asset) {
        const bal = await getBalanceMulti(checksum, asset);
        void refreshBalance(checksum).catch(() => {});
        return res.json({ ok: true, address: checksum, asset, balance: bal ?? '0' });
      }
      // default: return common assets
      const [yoy, eth] = await Promise.all([
        getBalanceMulti(checksum, 'YOY'),
        getBalanceMulti(checksum, 'ETH')
      ]);
      void refreshBalance(checksum).catch(() => {});
      res.json({
        ok: true,
        address: checksum,
        balances: {
          YOY: yoy ?? '0',
          ETH: eth ?? '0'
        }
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // Get transactions for an address with pagination
  app.get('/transactions', async (req, res) => {
    try {
      const raw = String(req.query.address || '');
      if (!raw) return res.status(400).json({ error: 'address query required' });
      const checksum = normalizeAddress(raw);
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
      const txs = await getTransactionsForAddress(checksum.toLowerCase(), { page, limit });
      res.json({ ok: true, address: checksum, page, limit, transactions: txs });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  const port = Number(process.env.PORT || ENV.API_PORT);
  app.listen(port, () => {
    console.log(`[API] listening on :${port}`);
  });
}

