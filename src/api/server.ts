import express from 'express';
import cors from 'cors';
import { ENV } from '../config/env.js';
import {
  upsertAddress,
  upsertUserAddress,
  getUserAddresses,
  getBalanceByAddress,
  getTransactionsForAddress,
  getBalanceMulti,
  getBalancesForUser,
  getTransactionsForUser
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
      await upsertUserAddress(uid, checksum);
      // Also enroll globally for monitoring and refresh its balances
      await upsertAddress(checksum, uid);
      try { await refreshBalance(checksum); } catch {}
      res.json({ ok: true, uid, address: checksum });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // Aggregated balances for current user (sum across owned addresses)
  app.get('/me/balances', firebaseAuth, async (req, res) => {
    try {
      const uid = (req as any).user?.uid as string | undefined;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const balances = await getBalancesForUser(uid);
      res.json({ ok: true, uid, balances });
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
      const txs = await getTransactionsForUser(uid, { page, limit });
      res.json({ ok: true, uid, page, limit, transactions: txs });
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
      try { await refreshBalance(checksum); } catch {}
      // Seed etherscan polling once for historical catch-up (non-blocking)
      try {
        const { pollAddressesOnce } = await import('../services/etherscanPoller.js');
        void pollAddressesOnce([checksum.toLowerCase()]);
      } catch {}
      res.json({ ok: true, address: checksum });
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

