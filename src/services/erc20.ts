import { Interface, AbiCoder, getAddress, zeroPadValue } from 'ethers';

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

