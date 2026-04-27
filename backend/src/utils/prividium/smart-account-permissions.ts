import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toFunctionSelector } from 'viem';

import type { Hex } from 'viem';
import { unknown } from 'zod/v4';
import { getPrividiumAuthToken } from '../client';
import { env } from '../envConfig';

type AbiItem = {
  type?: string;
};

type AbiFunction = {
  type: 'function';
  name: string;
  inputs: Array<{
    type: string;
    components?: Array<{ type: string; components?: unknown[] }>;
  }>;
  outputs?: Array<{
    type: string;
    components?: Array<{ type: string; components?: unknown[] }>;
  }>;
  stateMutability: string;
};

type ContractRecord = {
  contractAddress: string;
};

function buildApiUrl(path: string, apiBaseUrl: string) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function getModularSmartAccountArtifact(): {
  abi: unknown[];
  functions: readonly AbiFunction[];
  hasReceive: boolean;
} {
  const candidates = [
    resolve(process.cwd(), 'setup/src/system/contracts/ModularSmartAccount.json'),
    resolve(__dirname, '../../../../setup/src/system/contracts/ModularSmartAccount.json')
  ];

  const artifactPath = candidates.find((candidate) => existsSync(candidate));
  if (!artifactPath) {
    throw new Error('ModularSmartAccount artifact not found for permission setup');
  }

  const raw = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi?: unknown };
  if (!Array.isArray(raw.abi)) {
    throw new Error('ModularSmartAccount artifact is missing abi');
  }

  const abi = raw.abi as unknown[];
  const functions = abi.filter(
    (item): item is AbiFunction =>
      Boolean(item) &&
      typeof item === 'object' &&
      (item as AbiItem).type === 'function' &&
      'name' in (item as object) &&
      typeof (item as { name?: unknown }).name === 'string' &&
      'inputs' in (item as object) &&
      Array.isArray((item as { inputs?: unknown }).inputs) &&
      'stateMutability' in (item as object) &&
      typeof (item as { stateMutability?: unknown }).stateMutability === 'string'
  );

  const hasReceive = abi.some(
    (u: unknown) => typeof u === 'object' && u !== null && 'type' in u && u.type === 'receive'
  );

  return { abi, functions, hasReceive };
}

function formatParamType(param: {
  type: string;
  components?: Array<{ type: string; components?: unknown[] }>;
}): string {
  if (!param.type.startsWith('tuple')) {
    return param.type;
  }

  const suffix = param.type.slice('tuple'.length);
  const tupleMembers: string = (param.components ?? [])
    .map((component) => {
      return formatParamType({
        type: component.type,
        components: component.components as
          | Array<{ type: string; components?: unknown[] }>
          | undefined
      });
    })
    .join(',');

  return `(${tupleMembers})${suffix}`;
}

function formatFunctionSignature(abiItem: AbiFunction): string {
  const params = abiItem.inputs.map((input) => formatParamType(input)).join(',');
  return `${abiItem.name}(${params})`;
}

function formatFunctionSignatureForApi(abiItem: AbiFunction): string {
  const params = abiItem.inputs.map((input) => formatParamType(input)).join(',');
  const returns = (abiItem.outputs ?? []).map((output) => formatParamType(output)).join(', ');
  const mutability =
    abiItem.stateMutability === 'view' ||
    abiItem.stateMutability === 'pure' ||
    abiItem.stateMutability === 'payable'
      ? ` ${abiItem.stateMutability}`
      : '';
  const returnsPart = returns ? ` returns (${returns})` : '';
  return `function ${abiItem.name}(${params})${mutability}${returnsPart}`;
}

async function ensureContractRegistered(
  token: string,
  contractAddress: Hex,
  deps: SmartAccountPermissionsDeps
): Promise<ContractRecord | null> {
  const { abi } = deps.getModularSmartAccountArtifact();

  const createResponse = await deps.fetchFn(buildApiUrl('/contracts/', deps.apiBaseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      abi: JSON.stringify(abi),
      name: 'SSO Smart Account',
      contractAddress,
      description: 'Deployed SSO smart account',
      discloseBytecode: false,
      discloseErc20TotalSupply: false,
      disclosedAddresses: []
    })
  });

  if (createResponse.ok) {
    return (await createResponse.json()) as ContractRecord;
  }

  const existingResponse = await deps.fetchFn(
    buildApiUrl(`/contracts/${encodeURIComponent(contractAddress)}`, deps.apiBaseUrl),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (existingResponse.ok) {
    return (await existingResponse.json()) as ContractRecord;
  }

  const createError = await createResponse.text().catch(() => '');
  const existingError = await existingResponse.text().catch(() => '');
  throw new Error(
    `Failed to register contract ${contractAddress}. create=${createResponse.status} ${createError}; get=${existingResponse.status} ${existingError}`
  );
}

export type SmartAccountPermissionsDeps = {
  getPrividiumAuthToken: typeof getPrividiumAuthToken;
  fetchFn: typeof fetch;
  getModularSmartAccountArtifact: typeof getModularSmartAccountArtifact;
  apiBaseUrl: string;
};

function getSmartAccountPermissionsDeps(
  deps: Partial<SmartAccountPermissionsDeps>
): SmartAccountPermissionsDeps {
  return {
    getPrividiumAuthToken,
    fetchFn: fetch,
    getModularSmartAccountArtifact,
    apiBaseUrl: env.PRIVIDIUM_API_URL,
    ...deps
  };
}

export async function configureSmartAccountPermissions(
  contractAddress: Hex,
  deps: Partial<SmartAccountPermissionsDeps> = {}
) {
  const mergedDeps = getSmartAccountPermissionsDeps(deps);
  const token = await mergedDeps.getPrividiumAuthToken();
  const contract = await ensureContractRegistered(token, contractAddress, mergedDeps);
  const targetAddress = (contract?.contractAddress || contractAddress) as Hex;
  const { functions, hasReceive } = mergedDeps.getModularSmartAccountArtifact();

  if (hasReceive) {
    await mergedDeps.fetchFn(buildApiUrl('/contract-permissions/', mergedDeps.apiBaseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contractAddress: targetAddress,
        accessType: 'write',
        argumentRestrictions: [],
        roles: [],
        functionSignature: 'receive() external payable',
        methodSelector: '0x',
        ruleType: 'public'
      })
    });
  }

  for (const abiItem of functions) {
    const accessType =
      abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure' ? 'read' : 'write';
    const selectorSignature = formatFunctionSignature(abiItem);
    const functionSignature = formatFunctionSignatureForApi(abiItem);
    const methodSelector = toFunctionSelector(selectorSignature);

    const response = await mergedDeps.fetchFn(
      buildApiUrl('/contract-permissions/', mergedDeps.apiBaseUrl),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contractAddress: targetAddress,
          accessType,
          argumentRestrictions: [],
          roles: [],
          functionSignature,
          methodSelector,
          ruleType: 'public'
        })
      }
    );

    if (response.ok) {
      continue;
    }

    const body = await response.text().catch(() => '');
    if (response.status === 409 || /already|exists/i.test(body)) {
      continue;
    }

    throw new Error(
      `Failed to configure permission for ${functionSignature} (${methodSelector}): ${response.status} ${response.statusText} ${body}`
    );
  }
}
