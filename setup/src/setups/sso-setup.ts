import type { Abi } from 'abitype';
import { formatAbiItem } from 'abitype';
import { toFunctionSelector } from 'viem';
import {
  extractRes,
  getContractByAddress,
  getContractPermissions,
  postContractPermissions,
  postContracts
} from '../tools/api-client';
import type { Client } from '../tools/create-admin-client';

import EOAKeyValidatorArtifact from '../system/contracts/EOAKeyValidator.json';
import EntryPointArtifact from '../system/contracts/EntryPoint.json';
import GuardianExecutorArtifact from '../system/contracts/GuardianExecutor.json';
import MSAFactoryArtifact from '../system/contracts/MSAFactory.json';
import ModularSmartAccountArtifact from '../system/contracts/ModularSmartAccount.json';
import SessionKeyValidatorArtifact from '../system/contracts/SessionKeyValidator.json';
import UpgradeableBeaconArtifact from '../system/contracts/UpgradeableBeacon.json';
import WebAuthnValidatorArtifact from '../system/contracts/WebAuthnValidator.json';

type ContractSpec = {
  name: string;
  description: string;
  address: `0x${string}`;
  abi: Abi;
};

function buildSsoContracts(addresses: {
  eoaValidator?: `0x${string}`;
  webauthnValidator?: `0x${string}`;
  sessionValidator?: `0x${string}`;
  guardianExecutor?: `0x${string}`;
  entryPoint?: `0x${string}`;
  accountImplementation: `0x${string}`;
  beacon: `0x${string}`;
  factory: `0x${string}`;
}): ContractSpec[] {
  return [
    ...(addresses.webauthnValidator
      ? [
          {
            name: 'SSO WebAuthn Validator',
            description: 'Validator module for WebAuthn passkey authentication.',
            address: addresses.webauthnValidator,
            abi: WebAuthnValidatorArtifact.abi as Abi
          }
        ]
      : []),
    ...(addresses.eoaValidator
      ? [
          {
            name: 'SSO EOA Validator',
            description: 'Validator module for EOA-based signatures.',
            address: addresses.eoaValidator,
            abi: EOAKeyValidatorArtifact.abi as Abi
          }
        ]
      : []),
    ...(addresses.sessionValidator
      ? [
          {
            name: 'SSO Session Validator',
            description: 'Validator module for session keys.',
            address: addresses.sessionValidator,
            abi: SessionKeyValidatorArtifact.abi as Abi
          }
        ]
      : []),
    ...(addresses.guardianExecutor
      ? [
          {
            name: 'SSO Guardian Executor',
            description: 'Executor module for guardian-based recovery.',
            address: addresses.guardianExecutor,
            abi: GuardianExecutorArtifact.abi as Abi
          }
        ]
      : []),
    ...(addresses.entryPoint
      ? [
          {
            name: 'SSO EntryPoint',
            description: 'ERC-4337 EntryPoint used by SSO smart accounts.',
            address: addresses.entryPoint,
            abi: EntryPointArtifact.abi as Abi
          }
        ]
      : []),
    {
      name: 'SSO Account Implementation',
      description: 'ZKsync SSO Modular Smart Account implementation.',
      address: addresses.accountImplementation,
      abi: ModularSmartAccountArtifact.abi as Abi
    },
    {
      name: 'SSO Account Beacon',
      description: 'Upgradeable beacon for SSO smart accounts.',
      address: addresses.beacon,
      abi: UpgradeableBeaconArtifact.abi as Abi
    },
    {
      name: 'SSO Account Factory',
      description: 'Factory for deploying SSO smart account beacon proxies.',
      address: addresses.factory,
      abi: MSAFactoryArtifact.abi as Abi
    }
  ];
}

async function registerContract(adminApiClient: Client, contract: ContractSpec) {
  const existingRes = await getContractByAddress(adminApiClient, contract.address);
  const created =
    existingRes.response.status === 404
      ? extractRes(
          await postContracts(adminApiClient, {
            abi: JSON.stringify(contract.abi),
            name: contract.name,
            contractAddress: contract.address,
            description: contract.description,
            discloseBytecode: false,
            discloseErc20TotalSupply: false,
            disclosedAddresses: []
          })
        )
      : extractRes(existingRes);

  for (const abiItem of contract.abi) {
    if (abiItem.type !== 'function') {
      continue;
    }

    const methodSelector = toFunctionSelector(abiItem);
    const existingPermission = extractRes(
      await getContractPermissions(adminApiClient, {
        contractAddress: created.contractAddress,
        methodSelector,
        limit: 1,
        offset: 0
      })
    );
    if (existingPermission.items.length > 0) {
      continue;
    }

    extractRes(
      await postContractPermissions(adminApiClient, {
        contractAddress: created.contractAddress,
        accessType:
          abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure'
            ? 'read'
            : 'write',
        argumentRestrictions: [],
        roles: [],
        functionSignature: formatAbiItem(abiItem),
        methodSelector,
        ruleType: 'public'
      })
    );
  }
}

export async function setupSsoContracts(
  adminApiClient: Client,
  addresses: {
    eoaValidator?: `0x${string}`;
    webauthnValidator?: `0x${string}`;
    sessionValidator?: `0x${string}`;
    guardianExecutor?: `0x${string}`;
    entryPoint?: `0x${string}`;
    accountImplementation: `0x${string}`;
    beacon: `0x${string}`;
    factory: `0x${string}`;
  }
) {
  const contracts = buildSsoContracts(addresses);

  for (const contract of contracts) {
    await registerContract(adminApiClient, contract);
  }
}

export type SsoPermissionCheck = {
  contract: ContractSpec;
  missingPermissions: Array<{
    functionSignature: string;
    methodSelector: string;
    accessType: 'read' | 'write';
  }>;
};

export async function auditSsoContracts(
  adminApiClient: Client,
  addresses: {
    eoaValidator?: `0x${string}`;
    webauthnValidator?: `0x${string}`;
    sessionValidator?: `0x${string}`;
    guardianExecutor?: `0x${string}`;
    entryPoint?: `0x${string}`;
    accountImplementation: `0x${string}`;
    beacon: `0x${string}`;
    factory: `0x${string}`;
  }
) {
  const contracts = buildSsoContracts(addresses);
  const missingContracts: ContractSpec[] = [];
  const permissionReport: SsoPermissionCheck[] = [];

  for (const contract of contracts) {
    const existingRes = await getContractByAddress(adminApiClient, contract.address);
    if (existingRes.response.status === 404) {
      missingContracts.push(contract);
      continue;
    }

    const missingPermissions: SsoPermissionCheck['missingPermissions'] = [];

    for (const abiItem of contract.abi) {
      if (abiItem.type !== 'function') {
        continue;
      }

      const methodSelector = toFunctionSelector(abiItem);
      const permissionRes = await getContractPermissions(adminApiClient, {
        contractAddress: contract.address,
        methodSelector,
        limit: 1,
        offset: 0
      });

      const permissions = extractRes(permissionRes);
      if (permissions.items.length === 0) {
        missingPermissions.push({
          functionSignature: formatAbiItem(abiItem),
          methodSelector,
          accessType:
            abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure'
              ? 'read'
              : 'write'
        });
      }
    }

    if (missingPermissions.length > 0) {
      permissionReport.push({ contract, missingPermissions });
    }
  }

  return {
    missingContracts,
    permissionReport
  };
}
