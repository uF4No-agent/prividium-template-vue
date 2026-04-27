import fs from 'node:fs';
import path from 'node:path';
import type { Abi } from 'abitype';
import { formatAbiItem } from 'abitype';
import { toFunctionSelector } from 'viem';
import { z } from 'zod/v4';
import {
  extractRes,
  postApplications,
  postContractPermissions,
  postContracts
} from '../tools/api-client';
import { assertDotEnv, extractConfig, setDotEnvConfig } from '../tools/config-tools';
import type { Client } from '../tools/create-admin-client';
import { deployAndExtractAddress } from '../tools/deploy';

const OutJsonSchema = z.object({
  abi: z.unknown()
});

const toEnvKey = (name: string) =>
  `VITE_${name
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase()}_CONTRACT_ADDRESS`;

const parseCsv = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export async function setupCounterDapp(
  adminApiClient: Client,
  deployConfig: { rpcUrl: string; privateKey: string; chainId: number; authToken?: string }
): Promise<Record<string, `0x${string}`>> {
  const webAppDir = path.join(import.meta.dirname, '..', '..', '..', 'web-app');
  const contractsDir = path.join(import.meta.dirname, '..', '..', '..', 'contracts');
  const setupDir = path.join(import.meta.dirname, '..', '..');
  const setupEnvPath = path.join(setupDir, '.env');

  assertDotEnv(webAppDir);
  assertDotEnv(contractsDir);
  assertDotEnv(setupDir);

  const appName = extractConfig(setupEnvPath, 'PRIVIDIUM_APP_NAME');
  const appOrigin = extractConfig(setupEnvPath, 'PRIVIDIUM_APP_ORIGIN');
  const appRedirectUris = parseCsv(extractConfig(setupEnvPath, 'PRIVIDIUM_APP_REDIRECT_URIS'));
  const contractArtifacts = parseCsv(
    extractConfig(setupEnvPath, 'PRIVIDIUM_APP_CONTRACT_ARTIFACTS')
  );

  // Create OAuth application
  const app = extractRes(
    await postApplications(adminApiClient, {
      name: appName,
      origin: appOrigin,
      oauthRedirectUris: appRedirectUris
    })
  );
  setDotEnvConfig(webAppDir, 'VITE_CLIENT_ID', app.oauthClientId);

  const deployedContracts = (await deployAndExtractAddress(contractsDir, contractArtifacts, {
    rpcUrl: deployConfig.rpcUrl,
    privateKey: deployConfig.privateKey,
    chainId: deployConfig.chainId,
    authToken: deployConfig.authToken,
    deploymentLabel: 'app contract deployment'
  })) as Record<string, `0x${string}`>;

  for (const [contractName, contractAddress] of Object.entries(deployedContracts)) {
    setDotEnvConfig(webAppDir, toEnvKey(contractName), contractAddress);

    const artifactPath = contractArtifacts.find(
      (artifact) => path.basename(artifact, path.extname(artifact)) === contractName
    );
    if (!artifactPath) {
      throw new Error(`Missing artifact path for deployed contract: ${contractName}`);
    }

    const jsonStr = fs.readFileSync(path.join(contractsDir, artifactPath)).toString();
    const rawJson = z.unknown().parse(JSON.parse(jsonStr));
    const rawAbi = OutJsonSchema.parse(rawJson).abi;
    const contractAbi = rawAbi as Abi;

    const contract = extractRes(
      await postContracts(adminApiClient, {
        abi: JSON.stringify(contractAbi),
        name: contractName,
        contractAddress: contractAddress,
        description: `${contractName} contract`,
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        disclosedAddresses: []
      })
    );

    for (const abiItem of contractAbi) {
      if (abiItem.type !== 'function') {
        continue;
      }

      extractRes(
        await postContractPermissions(adminApiClient, {
          contractAddress: contract.contractAddress,
          accessType:
            abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure'
              ? 'read'
              : 'write',
          argumentRestrictions: [],
          roles: [],
          functionSignature: formatAbiItem(abiItem),
          methodSelector: toFunctionSelector(abiItem),
          ruleType: 'public'
        })
      );
    }
  }

  console.log(`✅ Saved app contract addresses to ${path.join(webAppDir, '.env')}`);

  return deployedContracts;
}
