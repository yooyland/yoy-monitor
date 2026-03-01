import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { ENV } from '../config/env.js';
import { erc20Iface } from './erc20.js';
import { setBalance } from '../db/index.js';

const provider = new JsonRpcProvider(ENV.INFURA_HTTPS, ENV.CHAIN_ID);

export async function refreshBalance(addressChecksum: string) {
  const contract = new Contract(ENV.YOY_CONTRACT, erc20Iface, provider);
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(addressChecksum),
    contract.decimals()
  ]);
  const human = formatUnits(raw, decimals);
  await setBalance(addressChecksum, String(human));
}

