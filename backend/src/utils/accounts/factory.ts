import type { Address } from 'viem';

import { client } from '../client';
import { SSO_CONTRACTS } from '../constants';
import { ensureBeaconDeployed } from './beacon';

let runtimeFactoryAddress: Address | null = null;

const MSA_FACTORY_READ_ABI = [
  {
    type: 'function',
    name: 'BEACON',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

async function hasCode(address: Address): Promise<boolean> {
  const code = await client.l2.getBytecode({ address });
  return !!code && code !== '0x';
}

export function getFactoryAddress(): Address {
  return runtimeFactoryAddress ?? (SSO_CONTRACTS.factory as Address);
}

export async function ensureFactoryDeployed(): Promise<Address> {
  const configured = SSO_CONTRACTS.factory as Address | undefined;
  if (configured) {
    console.log(`Checking configured factory address: ${configured}`);
    const configuredHasCode = await hasCode(configured);
    if (configuredHasCode) {
      const beaconFromFactory = (await client.l2.readContract({
        address: configured,
        abi: MSA_FACTORY_READ_ABI,
        functionName: 'BEACON'
      })) as Address;
      console.log(`✅ Factory beacon at ${beaconFromFactory}`);
      const beaconHasCode = await hasCode(beaconFromFactory);
      if (!beaconHasCode) {
        throw new Error(
          `Factory beacon has no code at ${beaconFromFactory}. Deploy/point to a valid beacon or set SSO_BEACON_CONTRACT and redeploy the factory.`
        );
      }
      console.log(`✅ Using configured factory at ${configured}`);
      runtimeFactoryAddress = configured;
      return configured;
    }
    console.warn(`⚠️  No code at configured factory address: ${configured}`);
  }

  const defaultFactory = SSO_CONTRACTS.factory as Address;
  console.log(`Checking default factory address: ${defaultFactory}`);
  const defaultHasCode = await hasCode(defaultFactory);
  if (defaultHasCode) {
    const beaconFromFactory = (await client.l2.readContract({
      address: defaultFactory,
      abi: MSA_FACTORY_READ_ABI,
      functionName: 'BEACON'
    })) as Address;
    console.log(`✅ Factory beacon at ${beaconFromFactory}`);
    const beaconHasCode = await hasCode(beaconFromFactory);
    if (!beaconHasCode) {
      throw new Error(
        `Factory beacon has no code at ${beaconFromFactory}. Deploy/point to a valid beacon or set SSO_BEACON_CONTRACT and redeploy the factory.`
      );
    }
    console.log(`✅ Using default factory at ${defaultFactory}`);
    runtimeFactoryAddress = defaultFactory;
    return defaultFactory;
  }

  await ensureBeaconDeployed();
  throw new Error('SSO factory contract not found. Run setup-permissions to deploy SSO contracts.');
}
