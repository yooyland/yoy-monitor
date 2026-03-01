import { Interface, getAddress } from 'ethers';
import { ENV } from '../config/env.js';

// Minimal ERC-20 ABI
export const erc20Iface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
]);

export const TRANSFER_TOPIC = erc20Iface.getEvent('Transfer')!.topicHash;

export function normalizeAddress(addr: string): string {
  return getAddress(addr);
}

export type MonitoredToken = { address: string; symbol: string; decimals: number };
export function getMonitoredTokens(): MonitoredToken[] {
  // Ensure YOY is always present
  const list = ENV.MONITORED_ERC20S;
  // de-dup by address
  const seen = new Set<string>();
  const out: MonitoredToken[] = [];
  for (const t of list) {
    if (!seen.has(t.address.toLowerCase())) {
      seen.add(t.address.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

