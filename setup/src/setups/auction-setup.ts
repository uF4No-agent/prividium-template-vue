import fs from 'node:fs';
import path from 'node:path';
import {
  getRolesByName,
  postApplications,
  postContractPermissions,
  postContracts,
  postRoles
} from '@repo/api-types/permissions-api';
import { type Abi, formatAbiItem } from 'abitype';
import { getAbiItem, toFunctionSelector } from 'viem';
import { assertDotEnv, setDotEnvConfig } from '../tools/config-tools';
import type { Client } from '../tools/create-admin-client';
import { deployAndExtractAddress } from '../tools/deploy';
import { extractRes } from '../tools/hey-api';

const MANAGER_ROLE_NAME = 'auction_manager';

const AUCTION_PORT = 4001;

export async function setupAuctionApp(adminApiClient: Client) {
  const dappDir = path.join(import.meta.dirname, '..', '..', '..', 'sample-dapp-auction');
  const contractsDir = path.join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'sample-dapp-auction-contract'
  );

  assertDotEnv(dappDir);
  assertDotEnv(contractsDir);

  const app = extractRes(
    await postApplications({
      client: adminApiClient,
      body: {
        name: 'Blind Auctions Sample Dapp',
        origin: `http://localhost:${AUCTION_PORT}`,
        oauthRedirectUris: [`http://localhost:${AUCTION_PORT}/auth-callback.html`]
      }
    })
  );
  setDotEnvConfig(dappDir, 'CLIENT_ID', app.oauthClientId);

  const contractAddress = await deployAndExtractAddress(
    contractsDir,
    'Auction contract deployed to'
  );
  setDotEnvConfig(dappDir, 'AUCTION_CONTRACT_ADDRESS', contractAddress);

  const abi = JSON.parse(
    fs.readFileSync(path.join(contractsDir, 'BlindAuctionABI.json')).toString()
  ) as Abi;

  const contract = extractRes(
    await postContracts({
      client: adminApiClient,
      body: {
        name: 'Blind Auction',
        description: 'Blind Auction example dapp contract',
        abi: JSON.stringify(abi, null, 2),
        disclosedAddresses: [],
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        contractAddress
      }
    })
  );

  const getManagerResponse = await getRolesByName({
    client: adminApiClient,
    path: { name: MANAGER_ROLE_NAME }
  });
  const manager =
    getManagerResponse.response.status === 404
      ? extractRes(
          await postRoles({
            client: adminApiClient,
            body: {
              roleName: MANAGER_ROLE_NAME,
              systemPermissions: []
            }
          })
        )
      : extractRes(getManagerResponse);

  const data = [
    {
      fn: 'createAuction',
      type: 'checkRole',
      roles: [{ roleName: manager.roleName }],
      accessType: 'write',
      argumentRestrictions: []
    },
    {
      fn: 'finalizeAuction',
      type: 'checkRole',
      roles: [{ roleName: manager.roleName }],
      accessType: 'write',
      argumentRestrictions: []
    },
    {
      fn: 'getAuction',
      type: 'public',
      accessType: 'read',
      roles: [],
      argumentRestrictions: []
    },
    {
      fn: 'getBid',
      accessType: 'read',
      type: 'restrictArgument',
      argumentRestrictions: [{ argumentIndex: 1 }],
      roles: []
    },
    {
      fn: 'getRefund',
      accessType: 'read',
      type: 'restrictArgument',
      argumentRestrictions: [{ argumentIndex: 1 }],
      roles: []
    },
    {
      fn: 'nextAuctionId',
      accessType: 'read',
      type: 'public',
      roles: [],
      argumentRestrictions: []
    },
    {
      fn: 'placeBid',
      accessType: 'write',
      type: 'public',
      roles: [],
      argumentRestrictions: []
    },
    {
      fn: 'withdrawBidRefund',
      accessType: 'write',
      type: 'public',
      roles: [],
      argumentRestrictions: []
    },
    {
      fn: 'withdrawProceeds',
      accessType: 'write',
      type: 'checkRole',
      roles: [{ roleName: manager.roleName }],
      argumentRestrictions: []
    }
  ] as const;

  for (const item of data) {
    const abiItem = getAbiItem({ abi, name: item.fn });
    if (abiItem === undefined) {
      throw new Error(`Function not found in abi: ${item.fn}`);
    }
    if (abiItem.type !== 'function') {
      throw new Error(`abi item is not a function: ${item.fn}`);
    }

    extractRes(
      await postContractPermissions({
        client: adminApiClient,
        body: {
          contractAddress: contract.contractAddress,
          accessType: item.accessType,
          argumentRestrictions: [...item.argumentRestrictions],
          roles: [...item.roles],
          functionSignature: formatAbiItem(abiItem),
          methodSelector: toFunctionSelector(abiItem),
          ruleType: item.type
        }
      })
    );
  }
}
