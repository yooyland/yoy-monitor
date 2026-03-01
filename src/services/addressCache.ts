import { getAllActiveAddresses } from '../db/index.js';

// Lowercased in-memory set for fast filtering
let addrSet = new Set<string>();

export async function warmAddressCache() {
  const list = await getAllActiveAddresses();
  addrSet = new Set(list.map((a) => a.toLowerCase()));
}

export function isMonitoredLower(addrLower: string) {
  return addrSet.has(addrLower);
}

export function getCacheSize() {
  return addrSet.size;
}

