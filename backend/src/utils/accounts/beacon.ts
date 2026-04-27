import type { Address } from 'viem';

import { client } from '../client';
import { SSO_CONTRACTS } from '../constants';

let runtimeBeaconAddress: Address | null = null;
let runtimeImplementationAddress: Address | null = null;

const BEACON_READ_ABI = [
  {
    type: 'function',
    name: 'implementation',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

async function hasCode(address: Address): Promise<boolean> {
  const code = await client.l2.getBytecode({ address });
  return !!code && code !== '0x';
}

export function getBeaconAddress(): Address {
  return runtimeBeaconAddress ?? (SSO_CONTRACTS.beacon as Address);
}

export function getAccountImplementationAddress(): Address {
  return runtimeImplementationAddress ?? (SSO_CONTRACTS.accountImplementation as Address);
}

async function ensureAccountImplementationAvailable(): Promise<Address> {
  const configured = SSO_CONTRACTS.accountImplementation as Address | undefined;
  if (configured) {
    const has = await hasCode(configured);
    if (has) {
      runtimeImplementationAddress = configured;
      return configured;
    }
    throw new Error(`No code at configured account implementation: ${configured}`);
  }

  const defaultImpl = SSO_CONTRACTS.accountImplementation as Address;
  if (await hasCode(defaultImpl)) {
    runtimeImplementationAddress = defaultImpl;
    return defaultImpl;
  }

  throw new Error(
    'SSO account implementation contract not found. Run setup-permissions to deploy SSO contracts.'
  );
}

export async function ensureBeaconDeployed(): Promise<Address> {
  const configured = SSO_CONTRACTS.beacon as Address | undefined;
  if (configured) {
    if (!(await hasCode(configured))) {
      throw new Error(`No code at configured beacon address: ${configured}`);
    }
    const implementation = (await client.l2.readContract({
      address: configured,
      abi: BEACON_READ_ABI,
      functionName: 'implementation'
    })) as Address;
    if (!(await hasCode(implementation))) {
      throw new Error(`Beacon implementation has no code at ${implementation}.`);
    }
    runtimeImplementationAddress = implementation;
    runtimeBeaconAddress = configured;
    console.log(`✅ Using configured beacon at ${configured}`);
    console.log(`✅ Beacon implementation at ${implementation}`);
    return configured;
  }

  const defaultBeacon = SSO_CONTRACTS.beacon as Address;
  if (await hasCode(defaultBeacon)) {
    const implementation = (await client.l2.readContract({
      address: defaultBeacon,
      abi: BEACON_READ_ABI,
      functionName: 'implementation'
    })) as Address;
    if (!(await hasCode(implementation))) {
      throw new Error(`Beacon implementation has no code at ${implementation}.`);
    }
    runtimeImplementationAddress = implementation;
    runtimeBeaconAddress = defaultBeacon;
    console.log(`✅ Using default beacon at ${defaultBeacon}`);
    console.log(`✅ Beacon implementation at ${implementation}`);
    return defaultBeacon;
  }

  await ensureAccountImplementationAvailable();
  throw new Error('SSO beacon contract not found. Run setup-permissions to deploy SSO contracts.');
}
