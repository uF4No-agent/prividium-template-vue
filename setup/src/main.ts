import path from 'node:path';
import { intro, outro, spinner } from '@clack/prompts';
import { setupCounterDapp } from './setups/counter-setup';
import { setupSsoContracts } from './setups/sso-setup';
import { assertDotEnv, extractConfig, extractConfigOptional } from './tools/config-tools';
import {
  type ContractsConfig,
  mergeContractsConfig,
  readContractsConfig,
  resolveContractsConfigPath,
  writeContractsConfig
} from './tools/contracts-config';
import { createAdminSession } from './tools/create-admin-client';
import { syncEnvFromContractsConfig } from './tools/env-sync';
import { assertPrividiumApiUp, assertZksyncOsIsUp } from './tools/service-assert';
import { deploySsoContracts } from './tools/sso-deploy';

function shouldSkipSso(): boolean {
  return process.argv.includes('--skip-sso');
}

function printAppDeploymentSummary(appContracts: Record<string, `0x${string}`>) {
  console.log('\nApp deployment summary:');
  for (const [contractName, contractAddress] of Object.entries(appContracts)) {
    console.log(`  ${contractName}: ${contractAddress}`);
  }
}

function formatConfiguredAddressError(error: unknown, contractsConfigPath: string): Error | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (!/^No code at configured /.test(error.message) && !/^Factory beacon has no code at /.test(error.message)) {
    return null;
  }

  return new Error(
    [
      error.message,
      `The setup script reuses existing SSO addresses from ${contractsConfigPath} when that file is present.`,
      'Those addresses appear to be stale for the current Prividium deployment, so the script cannot inspect contract code at them.',
      'Update or remove the stale addresses in that file, or delete the file to let setup deploy fresh contracts.'
    ].join('\n')
  );
}

async function main() {
  intro('Starting Prividium setup...');

  const rootPath = path.join(import.meta.dirname, '..', '..');
  const setupPermissionsPath = path.join(rootPath, 'setup');
  const webAppPath = path.join(rootPath, 'web-app');
  const backendPath = path.join(rootPath, 'backend');
  const setupEnvPath = path.join(setupPermissionsPath, '.env');

  assertDotEnv(setupPermissionsPath);
  assertDotEnv(webAppPath);
  assertDotEnv(backendPath);

  const contractsConfigPath = resolveContractsConfigPath(
    rootPath,
    extractConfigOptional(setupEnvPath, 'CONTRACTS_CONFIG_PATH'),
    setupPermissionsPath
  );
  const existingContractsConfig = readContractsConfig(contractsConfigPath);

  // Extract configuration from setup .env
  const permissionsApiUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_API_URL');
  const authBaseUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_AUTH_BASE_URL');
  const proxyUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_RPC_URL');

  // Parse URLs to get ports and domains
  const siweDomain = new URL(authBaseUrl).host;
  const zksyncOsUrl = proxyUrl;

  console.log('\nConfiguration:');
  console.log(`  Permissions API: ${permissionsApiUrl}`);
  console.log(`  Auth Base URL: ${authBaseUrl}`);
  console.log(`  ZKsync OS URL: ${zksyncOsUrl}`);
  console.log(`  SIWE Domain: ${siweDomain}\n`);

  const resolvedApiBaseUrl = await assertPrividiumApiUp(permissionsApiUrl);
  const chainIdRaw = extractConfig(setupEnvPath, 'PRIVIDIUM_CHAIN_ID');
  const l2ChainId = Number(chainIdRaw);
  if (!Number.isFinite(l2ChainId)) {
    throw new Error(`Invalid PRIVIDIUM_CHAIN_ID in ${setupEnvPath}: ${chainIdRaw}`);
  }
  await assertZksyncOsIsUp(zksyncOsUrl, BigInt(l2ChainId));

  const s = spinner();
  s.start('Authenticating as admin...');
  const adminPrivateKey = extractConfig(setupEnvPath, 'ADMIN_PRIVATE_KEY') as `0x${string}`;
  const adminAddress = extractConfig(setupEnvPath, 'ADMIN_ADDRESS') as `0x${string}`;
  const { client: adminApiClient, token: adminAuthToken } = await createAdminSession(
    resolvedApiBaseUrl,
    siweDomain,
    adminPrivateKey,
    adminAddress
  );
  s.stop('Authenticated as admin!');

  const skipSso = shouldSkipSso();
  const backendEnvPath = path.join(backendPath, '.env');
  const executorPrivateKey =
    (extractConfigOptional(setupEnvPath, 'EXECUTOR_PRIVATE_KEY') as `0x${string}` | undefined) ??
    adminPrivateKey;

  let ssoContracts: Awaited<ReturnType<typeof deploySsoContracts>> | undefined;
  if (skipSso) {
    console.log('\nSkipping SSO contract deployment and SSO permissions setup (--skip-sso).');
  } else {
    console.log('\nDeploying SSO contracts (implementation, beacon, factory)...');
    try {
      ssoContracts = await deploySsoContracts({
        rpcUrl: proxyUrl,
        chainId: l2ChainId,
        executorPrivateKey,
        authToken: adminAuthToken,
        configured: {
          eoaValidator:
            existingContractsConfig?.sso?.eoaValidator ??
            (extractConfigOptional(setupEnvPath, 'SSO_EOA_VALIDATOR_CONTRACT') as
              | `0x${string}`
              | undefined),
          webauthnValidator:
            existingContractsConfig?.sso?.webauthnValidator ??
            (extractConfigOptional(setupEnvPath, 'SSO_WEBAUTHN_VALIDATOR_CONTRACT') as
              | `0x${string}`
              | undefined),
          sessionValidator:
            existingContractsConfig?.sso?.sessionValidator ??
            (extractConfigOptional(setupEnvPath, 'SSO_SESSION_VALIDATOR_CONTRACT') as
              | `0x${string}`
              | undefined),
          guardianExecutor:
            existingContractsConfig?.sso?.guardianExecutor ??
            (extractConfigOptional(setupEnvPath, 'SSO_GUARDIAN_EXECUTOR_CONTRACT') as
              | `0x${string}`
              | undefined),
          entryPoint:
            existingContractsConfig?.sso?.entryPoint ??
            (extractConfigOptional(setupEnvPath, 'PRIVIDIUM_ENTRYPOINT_ADDRESS') as
              | `0x${string}`
              | undefined),
          accountImplementation:
            existingContractsConfig?.sso?.accountImplementation ??
            (extractConfigOptional(setupEnvPath, 'SSO_ACCOUNT_IMPLEMENTATION_CONTRACT') as
              | `0x${string}`
              | undefined),
          beacon:
            existingContractsConfig?.sso?.beacon ??
            (extractConfigOptional(setupEnvPath, 'SSO_BEACON_CONTRACT') as
              | `0x${string}`
              | undefined),
          factory:
            existingContractsConfig?.sso?.factory ??
            (extractConfigOptional(setupEnvPath, 'SSO_FACTORY_CONTRACT') as
              | `0x${string}`
              | undefined)
        }
      });
    } catch (error) {
      throw formatConfiguredAddressError(error, contractsConfigPath) ?? error;
    }
  }

  const interopConfig: ContractsConfig['interop'] = {
    l1InteropHandler:
      existingContractsConfig?.interop?.l1InteropHandler ??
      (extractConfigOptional(backendEnvPath, 'L1_INTEROP_HANDLER') as `0x${string}` | undefined),
    l2InteropCenter:
      existingContractsConfig?.interop?.l2InteropCenter ??
      (extractConfigOptional(backendEnvPath, 'L2_INTEROP_CENTER') as `0x${string}` | undefined)
  };

  const updatedContractsConfig = mergeContractsConfig(existingContractsConfig, {
    ...(ssoContracts
      ? {
          sso: {
            eoaValidator: ssoContracts.eoaValidator,
            webauthnValidator: ssoContracts.webauthnValidator,
            sessionValidator: ssoContracts.sessionValidator,
            guardianExecutor: ssoContracts.guardianExecutor,
            entryPoint: ssoContracts.entryPoint,
            accountImplementation: ssoContracts.accountImplementation,
            beacon: ssoContracts.beacon,
            factory: ssoContracts.factory,
            ssoBytecodeHash: ssoContracts.ssoBytecodeHash
          }
        }
      : {}),
    interop: interopConfig
  });

  writeContractsConfig(contractsConfigPath, updatedContractsConfig);

  syncEnvFromContractsConfig({
    rootPath,
    setupEnvPath,
    setupPath: setupPermissionsPath,
    backendPath,
    webAppPath,
    contractsConfigPath
  });

  if (ssoContracts) {
    console.log('\nRegistering SSO contracts and configuring permissions...');
    await setupSsoContracts(adminApiClient, {
      eoaValidator: ssoContracts.eoaValidator,
      webauthnValidator: ssoContracts.webauthnValidator,
      sessionValidator: ssoContracts.sessionValidator,
      guardianExecutor: ssoContracts.guardianExecutor,
      entryPoint: ssoContracts.entryPoint,
      accountImplementation: ssoContracts.accountImplementation,
      beacon: ssoContracts.beacon,
      factory: ssoContracts.factory
    });
  }

  console.log('\nDeploying app contracts and configuring permissions...');
  const appContracts = await setupCounterDapp(adminApiClient, {
    rpcUrl: proxyUrl,
    privateKey: executorPrivateKey,
    chainId: l2ChainId,
    authToken: adminAuthToken
  });

  const finalContractsConfig = mergeContractsConfig(readContractsConfig(contractsConfigPath), {
    app: appContracts
  });
  writeContractsConfig(contractsConfigPath, finalContractsConfig);

  syncEnvFromContractsConfig({
    rootPath,
    setupEnvPath,
    setupPath: setupPermissionsPath,
    backendPath,
    webAppPath,
    contractsConfigPath
  });

  if (ssoContracts) {
    console.log('\nSSO deployment summary:');
    console.log(
      `  WebAuthn validator: ${ssoContracts.webauthnValidator} (${ssoContracts.deployed.webauthnValidator ? 'deployed' : 'existing'})`
    );
    console.log(
      `  EOA validator: ${ssoContracts.eoaValidator} (${ssoContracts.deployed.eoaValidator ? 'deployed' : 'existing'})`
    );
    console.log(
      `  Session validator: ${ssoContracts.sessionValidator} (${ssoContracts.deployed.sessionValidator ? 'deployed' : 'existing'})`
    );
    console.log(
      `  Guardian executor: ${ssoContracts.guardianExecutor} (${ssoContracts.deployed.guardianExecutor ? 'deployed' : 'existing'})`
    );
    console.log(
      `  EntryPoint: ${ssoContracts.entryPoint} (${ssoContracts.deployed.entryPoint ? 'deployed' : 'existing'})`
    );
    console.log(
      `  Account implementation: ${ssoContracts.accountImplementation} (${ssoContracts.deployed.accountImplementation ? 'deployed' : 'existing'})`
    );
    console.log(
      `  Beacon: ${ssoContracts.beacon} (${ssoContracts.deployed.beacon ? 'deployed' : 'existing'})`
    );
    console.log(
      `  Factory: ${ssoContracts.factory} (${ssoContracts.deployed.factory ? 'deployed' : 'existing'})`
    );
    console.log(`  Account bytecode hash: ${ssoContracts.ssoBytecodeHash}`);
  }
  printAppDeploymentSummary(appContracts);

  outro(
    'Setup complete! 🎉\n\nYou must now run both the backend and web app in separate terminals:\n\n1. Backend: pnpm dev:backend\n2. Web App: pnpm dev'
  );
}

main().catch((e) => {
  console.error('\n❌ Setup failed:');
  console.error(e);
  process.exit(1);
});
