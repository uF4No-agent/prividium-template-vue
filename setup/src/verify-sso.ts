import fs from 'node:fs';
import path from 'node:path';
import { intro, outro } from '@clack/prompts';
import { formatAbiItem } from 'abitype';
import {
  http,
  type Abi,
  type Address,
  type Transport,
  createPublicClient,
  defineChain
} from 'viem';
import { toFunctionSelector } from 'viem';
import { z } from 'zod/v4';

import { auditSsoContracts, setupSsoContracts } from './setups/sso-setup';
import {
  extractRes,
  getContractByAddress,
  getContractPermissions,
  postContractPermissions,
  postContracts
} from './tools/api-client';
import { assertDotEnv, extractConfig, extractConfigOptional } from './tools/config-tools';
import { readContractsConfig, resolveContractsConfigPath } from './tools/contracts-config';
import { createAdminSession } from './tools/create-admin-client';
import { assertPrividiumApiUp } from './tools/service-assert';

const CounterArtifactSchema = z.object({
  abi: z.unknown()
});

function createTransport(rpcUrl: string, authToken?: string): Transport {
  if (!authToken) {
    return http(rpcUrl);
  }

  const fetchFn: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${authToken}`);
    return fetch(url, { ...init, headers });
  };

  return http(rpcUrl, { fetchFn });
}

async function main() {
  intro('Verifying SSO contracts & permissions...');

  const rootPath = path.join(import.meta.dirname, '..', '..');
  const setupPermissionsPath = path.join(rootPath, 'setup');
  const setupEnvPath = path.join(setupPermissionsPath, '.env');

  assertDotEnv(setupPermissionsPath);

  const permissionsApiUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_API_URL');
  const authBaseUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_AUTH_BASE_URL');
  const proxyUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_RPC_URL');
  const chainIdRaw = extractConfig(setupEnvPath, 'PRIVIDIUM_CHAIN_ID');
  const chainId = Number(chainIdRaw);
  if (!Number.isFinite(chainId)) {
    throw new Error(`Invalid PRIVIDIUM_CHAIN_ID in ${setupEnvPath}: ${chainIdRaw}`);
  }

  const resolvedApiBaseUrl = await assertPrividiumApiUp(permissionsApiUrl);
  const siweDomain = new URL(authBaseUrl).host;

  const adminPrivateKey = extractConfig(setupEnvPath, 'ADMIN_PRIVATE_KEY') as `0x${string}`;
  const adminAddress = extractConfig(setupEnvPath, 'ADMIN_ADDRESS') as `0x${string}`;
  const { client: adminApiClient, token: adminAuthToken } = await createAdminSession(
    resolvedApiBaseUrl,
    siweDomain,
    adminPrivateKey,
    adminAddress
  );

  const contractsConfigPath = resolveContractsConfigPath(
    rootPath,
    extractConfigOptional(setupEnvPath, 'CONTRACTS_CONFIG_PATH'),
    setupPermissionsPath
  );
  const contractsConfig = readContractsConfig(contractsConfigPath);
  if (!contractsConfig?.sso) {
    throw new Error(`Missing SSO contract config at ${contractsConfigPath}.`);
  }

  const addresses = {
    eoaValidator: contractsConfig.sso.eoaValidator as Address | undefined,
    webauthnValidator: contractsConfig.sso.webauthnValidator as Address | undefined,
    sessionValidator: contractsConfig.sso.sessionValidator as Address | undefined,
    guardianExecutor: contractsConfig.sso.guardianExecutor as Address | undefined,
    entryPoint: contractsConfig.sso.entryPoint as Address | undefined,
    accountImplementation: contractsConfig.sso.accountImplementation as Address | undefined,
    beacon: contractsConfig.sso.beacon as Address | undefined,
    factory: contractsConfig.sso.factory as Address | undefined
  };

  if (!addresses.accountImplementation || !addresses.beacon || !addresses.factory) {
    throw new Error(
      'Missing required SSO contract addresses. Ensure setup or backend .env is populated.'
    );
  }

  const transport = createTransport(proxyUrl, adminAuthToken);
  const chain = defineChain({
    id: chainId,
    name: 'Prividium L2',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [proxyUrl] }, public: { http: [proxyUrl] } }
  });
  const publicClient = createPublicClient({ chain, transport });

  const codeCheckResults: Array<{ name: string; address?: Address; hasCode: boolean }> = [];
  const codeTargets: Array<[string, Address | undefined]> = [
    ['SSO WebAuthn Validator', addresses.webauthnValidator],
    ['SSO EOA Validator', addresses.eoaValidator],
    ['SSO Session Validator', addresses.sessionValidator],
    ['SSO Guardian Executor', addresses.guardianExecutor],
    ['SSO EntryPoint', addresses.entryPoint],
    ['SSO Account Implementation', addresses.accountImplementation],
    ['SSO Beacon', addresses.beacon],
    ['SSO Factory', addresses.factory]
  ];

  for (const [name, address] of codeTargets) {
    if (!address) {
      codeCheckResults.push({ name, address, hasCode: false });
      continue;
    }
    const code = await publicClient.getBytecode({ address });
    codeCheckResults.push({ name, address, hasCode: !!code && code !== '0x' });
  }

  const audit = await auditSsoContracts(adminApiClient, {
    eoaValidator: addresses.eoaValidator,
    webauthnValidator: addresses.webauthnValidator,
    sessionValidator: addresses.sessionValidator,
    guardianExecutor: addresses.guardianExecutor,
    entryPoint: addresses.entryPoint,
    accountImplementation: addresses.accountImplementation,
    beacon: addresses.beacon,
    factory: addresses.factory
  });

  console.log('\nSSO contract code checks:');
  for (const entry of codeCheckResults) {
    const status = entry.hasCode ? 'ok' : 'missing';
    const addr = entry.address ?? 'unset';
    console.log(`  ${entry.name}: ${addr} (${status})`);
  }

  if (audit.missingContracts.length > 0) {
    console.log('\nContracts missing in Permissions API:');
    for (const contract of audit.missingContracts) {
      console.log(`  ${contract.name} (${contract.address})`);
    }
  } else {
    console.log('\nAll SSO contracts are registered in the Permissions API.');
  }

  if (audit.permissionReport.length > 0) {
    console.log('\nMissing SSO contract permissions:');
    for (const report of audit.permissionReport) {
      console.log(`  ${report.contract.name} (${report.contract.address})`);
      for (const perm of report.missingPermissions) {
        console.log(`    - ${perm.functionSignature} [${perm.accessType}]`);
      }
    }
  } else {
    console.log('\nAll SSO contract permissions are configured.');
  }

  const shouldFix = process.argv.includes('--fix');
  if (shouldFix && (audit.missingContracts.length > 0 || audit.permissionReport.length > 0)) {
    console.log('\nApplying missing registrations/permissions...');
    await setupSsoContracts(adminApiClient, {
      eoaValidator: addresses.eoaValidator,
      webauthnValidator: addresses.webauthnValidator,
      sessionValidator: addresses.sessionValidator,
      guardianExecutor: addresses.guardianExecutor,
      entryPoint: addresses.entryPoint,
      accountImplementation: addresses.accountImplementation,
      beacon: addresses.beacon,
      factory: addresses.factory
    });
    console.log('✅ SSO contract permissions updated.');
  }

  const counterAddress = contractsConfig.app?.counter as Address | undefined;
  if (counterAddress) {
    const counterArtifactPath = path.join(
      rootPath,
      'contracts',
      'out',
      'Counter.sol',
      'Counter.json'
    );
    if (!fs.existsSync(counterArtifactPath)) {
      console.warn(
        `⚠️  Counter artifact missing at ${counterArtifactPath}. Skipping counter permission audit.`
      );
    } else {
      const rawJson = JSON.parse(fs.readFileSync(counterArtifactPath, 'utf8'));
      const counterAbi = CounterArtifactSchema.parse(rawJson).abi as Abi;

      const counterContractRes = await getContractByAddress(adminApiClient, counterAddress);
      const counterRegistered = counterContractRes.response.status !== 404;
      const missingCounterPermissions: Array<{
        signature: string;
        selector: string;
        access: 'read' | 'write';
      }> = [];

      for (const abiItem of counterAbi) {
        if (abiItem.type !== 'function') continue;
        const selector = toFunctionSelector(abiItem);
        const permissionRes = await getContractPermissions(adminApiClient, {
          contractAddress: counterAddress,
          methodSelector: selector,
          limit: 1,
          offset: 0
        });
        const permissions = extractRes(permissionRes);
        if (permissions.items.length === 0) {
          missingCounterPermissions.push({
            signature: formatAbiItem(abiItem),
            selector,
            access:
              abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure'
                ? 'read'
                : 'write'
          });
        }
      }

      console.log('\nCounter contract permissions:');
      if (!counterRegistered) {
        console.log(`  Counter contract is not registered (${counterAddress}).`);
      }
      if (missingCounterPermissions.length > 0) {
        console.log(
          `  Missing ${missingCounterPermissions.length} permissions for Counter contract.`
        );
        for (const perm of missingCounterPermissions) {
          console.log(`    - ${perm.signature} [${perm.access}]`);
        }
      } else if (counterRegistered) {
        console.log('  All Counter permissions are configured.');
      }

      if (shouldFix && (!counterRegistered || missingCounterPermissions.length > 0)) {
        console.log('\nApplying Counter permissions...');
        if (!counterRegistered) {
          extractRes(
            await postContracts(adminApiClient, {
              abi: JSON.stringify(counterAbi),
              name: 'Counter',
              contractAddress: counterAddress,
              description: 'Simple counter contract for demo app',
              discloseBytecode: false,
              discloseErc20TotalSupply: false,
              disclosedAddresses: []
            })
          );
        }

        for (const perm of missingCounterPermissions) {
          extractRes(
            await postContractPermissions(adminApiClient, {
              contractAddress: counterAddress,
              accessType: perm.access,
              argumentRestrictions: [],
              roles: [],
              functionSignature: perm.signature,
              methodSelector: perm.selector,
              ruleType: 'public'
            })
          );
        }

        console.log('✅ Counter contract permissions updated.');
      }
    }
  }

  outro('SSO verification complete.');
}

main().catch((e) => {
  console.error('\n❌ SSO verification failed:');
  console.error(e);
  process.exit(1);
});
