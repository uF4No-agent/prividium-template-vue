import { defineChain } from 'viem';

type ContractsConfig = {
  sso?: {
    webauthnValidator?: `0x${string}`;
    entryPoint?: `0x${string}`;
  };
};

const parseContractsConfig = (): ContractsConfig => {
  const rawConfig = import.meta.env.VITE_SSO_CONTRACTS_JSON;
  if (!rawConfig) {
    return {};
  }

  try {
    return JSON.parse(rawConfig) as ContractsConfig;
  } catch (error) {
    console.warn('Failed to parse VITE_SSO_CONTRACTS_JSON, falling back to VITE_SSO_* env vars.', error);
    return {};
  }
};

const contractsConfig = parseContractsConfig();
const configSso = contractsConfig.sso ?? {};

export const RP_ID = window.location.hostname;

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4340';
export const DEPLOY_ACCOUNT_ENDPOINT = `${BACKEND_URL}/deploy-account`;

export const DEFAULT_ZKSYNC_OS_RPC_URL = 'https://zksync-os-testnet-alpha.zksync.dev/';
export const SSO_RPC_URL = import.meta.env.VITE_PRIVIDIUM_RPC_URL || DEFAULT_ZKSYNC_OS_RPC_URL;

const ssoChainId = Number(
  import.meta.env.VITE_SSO_CHAIN_ID || import.meta.env.VITE_PRIVIDIUM_CHAIN_ID || 8022833
);
const ssoChainName =
  import.meta.env.VITE_SSO_CHAIN_NAME || import.meta.env.VITE_PRIVIDIUM_CHAIN_NAME || 'ZKsync SSO';

// SSO chain configuration
export const ssoChain = defineChain({
  id: ssoChainId,
  name: ssoChainName,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [SSO_RPC_URL]
    },
    public: {
      http: [SSO_RPC_URL]
    }
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      // TODO: update with prividium explorer
      url: 'https://explorer.zksync.io/'
    }
  }
});

export const ssoContracts = {
  webauthnValidator: (configSso.webauthnValidator ||
    import.meta.env.VITE_SSO_WEBAUTHN_VALIDATOR ||
    '0xD52c9b1bA249f877C8492F64c096E37a8072982A') as `0x${string}`,
  entryPoint: (configSso.entryPoint ||
    import.meta.env.VITE_SSO_ENTRYPOINT ||
    '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108') as `0x${string}`
};

const storageNamespace = [
  'zksync_sso',
  String(ssoChain.id),
  ssoContracts.entryPoint.slice(2, 10).toLowerCase(),
  ssoContracts.webauthnValidator.slice(2, 10).toLowerCase()
].join('_');

// LocalStorage keys
export const STORAGE_KEY_PASSKEY = `${storageNamespace}_passkey`;
export const STORAGE_KEY_ACCOUNT = `${storageNamespace}_account`;
