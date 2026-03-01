import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { ENV } from '../config/env.js';
import { erc20Iface, getMonitoredTokens } from './erc20.js';
import { setBalance, setBalanceMulti } from '../db/index.js';

const provider = new JsonRpcProvider(ENV.INFURA_HTTPS, ENV.CHAIN_ID);

export async function refreshBalance(addressChecksum: string) {
  // Refresh YOY legacy balance for backward-compat
  try {
    const yoy = new Contract(ENV.YOY_CONTRACT, erc20Iface, provider);
    const [raw, decimals] = await Promise.all([yoy.balanceOf(addressChecksum), yoy.decimals()]);
    const human = formatUnits(raw, decimals);
    await setBalance(addressChecksum, String(human));
    await setBalanceMulti(addressChecksum, 'YOY', String(human));
  } catch {}

  // Refresh all monitored ERC-20s into balances_multi
  const tokens = getMonitoredTokens();
  for (const t of tokens) {
    try {
      const c = new Contract(t.address, erc20Iface, provider);
      const raw = await c.balanceOf(addressChecksum);
      const human = formatUnits(raw, t.decimals);
      await setBalanceMulti(addressChecksum, t.symbol, String(human));
    } catch {}
  }

  // Refresh native ETH balance
  try {
    const wei = await provider.getBalance(addressChecksum);
    const eth = formatUnits(wei, 18);
    await setBalanceMulti(addressChecksum, 'ETH', String(eth));
  } catch {}
}

