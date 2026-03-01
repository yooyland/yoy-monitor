import express from 'express';
import cors from 'cors';
import { ENV } from '../config/env.js';
import {
  upsertAddress,
  getBalanceByAddress,
  getTransactionsForAddress,
  setBalance
} from '../db/index.js';
import { normalizeAddress } from '../services/erc20.js';
import { refreshBalance } from '../services/balances.js';

export function startApiServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, chainId: ENV.CHAIN_ID });
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
      res.json({ ok: true, address: checksum });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  // Get balance for an address (from DB; refresh in background when possible)
  app.get('/balances/:address', async (req, res) => {
    try {
      const checksum = normalizeAddress(String(req.params.address));
      const bal = await getBalanceByAddress(checksum);
      // Fire-and-forget refresh
      void refreshBalance(checksum).catch(() => {});
      res.json({ ok: true, address: checksum, balance: bal ?? '0' });
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

  app.listen(ENV.API_PORT, () => {
    console.log(`[API] listening on :${ENV.API_PORT}`);
  });
}

