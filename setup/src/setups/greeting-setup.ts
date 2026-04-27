import fs from 'node:fs';
import path from 'node:path';
import {
  postApplications,
  postContractPermissions,
  postContracts
} from '@repo/api-types/permissions-api';
import type { Abi } from 'abitype';
import { formatAbiItem } from 'abitype';
import { toFunctionSelector } from 'viem';
import { z } from 'zod/v4';
import { assertDotEnv, setDotEnvConfig } from '../tools/config-tools';
import type { Client } from '../tools/create-admin-client';
import { deployAndExtractAddress } from '../tools/deploy';
import { extractRes } from '../tools/hey-api';

const OutJsonSchema = z.object({
  abi: z.unknown()
});

export async function setupGreetingDapp(adminApiClient: Client) {
  const dappDir = path.join(import.meta.dirname, '..', '..', '..', 'sample-dapp');
  const contractsDir = path.join(import.meta.dirname, '..', '..', '..', 'sample-dapp-contract');

  assertDotEnv(dappDir);
  assertDotEnv(contractsDir);

  const app = extractRes(
    await postApplications({
      client: adminApiClient,
      body: {
        name: 'Greetings sample dapp',
        origin: 'http://localhost:4000',
        oauthRedirectUris: ['http://localhost:4000/auth-callback.html']
      }
    })
  );
  setDotEnvConfig(dappDir, 'CLIENT_ID', app.oauthClientId);

  const contractAddress = await deployAndExtractAddress(
    contractsDir,
    'Greeting contract deployed to'
  );
  setDotEnvConfig(dappDir, 'GREETING_CONTRACT_ADDRESS', contractAddress);

  const jsonStr = fs
    .readFileSync(path.join(contractsDir, 'out', 'Greeting.sol', 'Greeting.json'))
    .toString();

  const rawJson = z.unknown().parse(JSON.parse(jsonStr));
  const rawAbi = OutJsonSchema.parse(rawJson).abi;

  const greeterAbi = rawAbi as Abi;

  const greeterContract = extractRes(
    await postContracts({
      client: adminApiClient,
      body: {
        abi: JSON.stringify(greeterAbi),
        name: 'Greeter',
        contractAddress: contractAddress,
        description: 'Contract for greeter example dapp',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        disclosedAddresses: []
      }
    })
  );

  for (const abiItem of greeterAbi) {
    if (abiItem.type !== 'function') {
      continue;
    }

    extractRes(
      await postContractPermissions({
        client: adminApiClient,
        body: {
          contractAddress: greeterContract.contractAddress,
          accessType: 'write',
          argumentRestrictions: [],
          roles: [],
          functionSignature: formatAbiItem(abiItem),
          methodSelector: toFunctionSelector(abiItem),
          ruleType: 'public'
        }
      })
    );
  }
}
