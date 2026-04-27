import { createViemClient } from '@matterlabs/zksync-js/viem/client';
import { createViemSdk } from '@matterlabs/zksync-js/viem/sdk';
import { http, type Transport, createPublicClient, createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { L1_RPC_URL, L2_RPC_URL, l2Chain } from './constants';
import { env } from './envConfig';

const EXECUTOR_PRIVATE_KEY = env.EXECUTOR_PRIVATE_KEY as `0x${string}`;

if (!EXECUTOR_PRIVATE_KEY) {
  console.error('❌ EXECUTOR_PRIVATE_KEY not found in .env file');
  process.exit(1);
}

export const executorAccount = privateKeyToAccount(EXECUTOR_PRIVATE_KEY);

// --- Auth Handling ---
let authToken: string | null = null;
let tokenExpiry = 0;
let authInFlight: Promise<string> | null = null;
let authCooldownUntil = 0;
const AUTH_COOLDOWN_MS = 30000;

async function getAuthToken(): Promise<string> {
  if (authInFlight) return authInFlight;
  if (Date.now() < authCooldownUntil) {
    throw new Error('Auth is in cooldown after a failure. Retry shortly.');
  }
  // If token is valid (with 30s buffer), return it
  if (authToken && Date.now() < tokenExpiry - 30000) {
    return authToken;
  }

  console.log('🔄 Authenticating with Prividium...');

  // 1. Get Challenge
  // The RPC URL usually has a corresponding API, usually at port 8000 or similar if local.
  // The user says "L2 RPC is a Prividium cli proxy... http://127.0.0.1:24101/rpc".
  // The Prividium API itself is likely at http://localhost:8000 based on previous context/README.
  // We'll try to deduce the API URL or use a known one.
  // For local proxy, usually the proxy *IS* the gateway, but for SIWE we need the actual Admin/Auth API.
  // Let's assume the Auth API is reachable. The README says: "npx prividium proxy -r http://localhost:8000 -u http://localhost:3001".
  // So the API is likely http://localhost:8000.
  // Let's rely on an env var or fallback.
  // BUT: The proxy forwards requests. If we use the proxy URL (127.0.0.1:24101) for RPC, we still need a token?
  // Actually, if using the proxy, the proxy *handles* auth if it's the *local* proxy for *humans*.
  // BUT the logs say "Unauthorized". This means the proxy might be expecting a token if we are hitting it programmatically?
  // OR we are hitting the node directly?
  // The logs show: URL: http://127.0.0.1:24101/rpc
  // The User Guide says: "Deployment Method 1: Local Proxy (Recommended for Humans)... npx prividium proxy... which handles auth automatically".
  // If the proxy handles auth automatically, why are we getting 401?
  // Ah, the proxy might only handle auth if we use the browser/wallet flow URL `.../rpc/wallet/<token>`.
  // OR, maybe we are NOT supposed to use the proxy for the backend script?
  // The guide says: "For standalone scripts... you CANNOT use the browser flow. You must use the Crypto-Native (SIWE) flow."
  // And "Use Authorization: Bearer <token> headers with the standard endpoint."

  // So we should probably target the actual RPC endpoint with a token, or the Proxy *with* a token.
  // Let's implement the SIWE flow and inject the token.

  // URL to perform SIWE. Use backend env if set, fallback to VITE_* for convenience.
  const AUTH_API_URL = env.PRIVIDIUM_API_URL;

  console.log(`Using Auth API: ${AUTH_API_URL}`);

  const run = async () => {
    try {
      // 1. Request Challenge
      const authBaseUrl = env.PRIVIDIUM_AUTH_BASE_URL || env.CORS_ORIGIN || 'http://localhost:3001';
      const authUrl = new URL(authBaseUrl);
      const siweDomain = env.SIWE_DOMAIN || authUrl.host;
      const siweUri = env.SIWE_URI || authUrl.origin;
      console.log(`SIWE domain: ${siweDomain} | SIWE uri: ${siweUri}`);

      const buildUrl = (path: string) =>
        `${AUTH_API_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

      const challengePath = env.SIWE_CHALLENGE_PATH;
      const loginPath = env.SIWE_LOGIN_PATH;

      const postJson = (url: string, body: Record<string, unknown>) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

      const challengeUrl = buildUrl(challengePath);
      console.log(`SIWE challenge URL: ${challengeUrl}`);
      const challengeRes = await postJson(challengeUrl, {
        address: executorAccount.address,
        domain: siweDomain
      });

      if (!challengeRes.ok) {
        const errorText = await challengeRes.text().catch(() => '');
        if (challengeRes.status === 429) {
          const retryAfter = Number(challengeRes.headers.get('retry-after'));
          const cooldownMs =
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : AUTH_COOLDOWN_MS;
          authCooldownUntil = Date.now() + cooldownMs;
        }
        throw new Error(
          `Failed to get challenge: ${challengeRes.status} ${challengeRes.statusText} ${errorText}`
        );
      }
      const challengeJson = await challengeRes.json();
      console.log(`SIWE challenge response: ${JSON.stringify(challengeJson)}`);
      const message = challengeJson?.message || challengeJson?.msg;
      const nonceToken = challengeJson?.nonceToken;
      if (!message) {
        throw new Error(
          `SIWE challenge missing message field. Response: ${JSON.stringify(challengeJson)}`
        );
      }
      if (!nonceToken) {
        throw new Error(
          `SIWE challenge missing nonceToken field. Response: ${JSON.stringify(challengeJson)}`
        );
      }

      // 2. Sign Message
      const signature = await executorAccount.signMessage({ message });

      // 3. Login
      const loginUrl = buildUrl(loginPath);
      console.log(`SIWE login URL: ${loginUrl}`);
      const loginRes = await postJson(loginUrl, { message, signature, nonceToken });

      if (!loginRes.ok) {
        const errorText = await loginRes.text().catch(() => '');
        throw new Error(`Failed to login: ${loginRes.status} ${loginRes.statusText} ${errorText}`);
      }
      const { token, expiresAt } = await loginRes.json();

      authToken = token;
      tokenExpiry = expiresAt ? Date.parse(expiresAt) : Date.now() + 3600 * 1000;

      console.log('✅ Authenticated!');
      return authToken as string;
    } catch (error) {
      console.error('Auth failed:', error);
      authCooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
      throw error;
    } finally {
      authInFlight = null;
    }
  };

  authInFlight = run();
  return authInFlight;
}

export async function getPrividiumAuthToken(): Promise<string> {
  return getAuthToken();
}

// Custom Fetch Wrapper for Viem
const authenticatedFetch: typeof fetch = async (url, init) => {
  const token = await getAuthToken();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
};

// Clients
// For L1 (Sepolia), we don't need Prividium auth usually, unless it's a proxied L1?
// Usually L1 is public. We'll leave L1 as is.
const l1 = createPublicClient({
  chain: sepolia,
  transport: http(L1_RPC_URL)
});

// For L2, we use authenticated transport
const l2 = createPublicClient({
  chain: l2Chain,
  transport: http(L2_RPC_URL, {
    fetchFn: authenticatedFetch
  })
});

export const l1Wallet = createWalletClient({
  account: executorAccount,
  chain: sepolia,
  transport: http(L1_RPC_URL)
});

export const l2Wallet = createWalletClient({
  account: executorAccount,
  transport: http(L2_RPC_URL, {
    fetchFn: authenticatedFetch
  }),
  chain: l2Chain
});

// Create ZKSync client
export const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
export const sdk = createViemSdk(client);
