import { type PrividiumChain, type UserProfile, createPrividiumChain } from 'prividium';
import { computed, ref } from 'vue';

const stripApiSuffix = (url?: string) => {
  const base = url?.replace(/\/$/, '');
  if (!base) return undefined;
  return base.endsWith('/api') ? base.slice(0, -4) : base;
};

const prividiumSdkChain = {
  id: Number.parseInt(import.meta.env.VITE_PRIVIDIUM_CHAIN_ID),
  name: import.meta.env.VITE_PRIVIDIUM_CHAIN_NAME,
  nativeCurrency: {
    name: import.meta.env.VITE_PRIVIDIUM_NATIVE_CURRENCY_SYMBOL,
    symbol: import.meta.env.VITE_PRIVIDIUM_NATIVE_CURRENCY_SYMBOL,
    decimals: 18
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: 'https://explorer.zksync.io/'
    }
  }
} as const;

let prividiumInstance: PrividiumChain | null = null;

type AppUserProfile = UserProfile & {
  userId: string;
  walletAddresses: string[];
};

const isAuthenticated = ref(false);
const isAuthenticating = ref(false);
const userProfile = ref<AppUserProfile | null>(null);
const authError = ref<string | null>(null);

function mapWalletAddresses(wallets: unknown[]): string[] {
  return wallets
    .map((wallet) => {
      if (typeof wallet === 'string') {
        return wallet;
      }
      if (
        wallet &&
        typeof wallet === 'object' &&
        'walletAddress' in wallet &&
        typeof (wallet as { walletAddress?: unknown }).walletAddress === 'string'
      ) {
        return (wallet as { walletAddress: string }).walletAddress;
      }
      return null;
    })
    .filter((walletAddress): walletAddress is string => walletAddress !== null);
}

function toAppUserProfile(profile: UserProfile): AppUserProfile {
  return {
    ...profile,
    userId: profile.id,
    walletAddresses: mapWalletAddresses(profile.wallets)
  };
}

function initializePrividium(): PrividiumChain | null {
  if (!prividiumInstance) {
    try {
      const prividiumApiBaseUrl = stripApiSuffix(import.meta.env.VITE_PRIVIDIUM_API_URL) ?? '';
      prividiumInstance = createPrividiumChain({
        clientId: import.meta.env.VITE_CLIENT_ID,
        chain: prividiumSdkChain,
        authBaseUrl: import.meta.env.VITE_PRIVIDIUM_AUTH_BASE_URL,
        redirectUrl: `${window.location.origin}/auth-callback.html`,
        prividiumApiBaseUrl,
        onAuthExpiry: () => {
          console.log('Authentication expired');
          isAuthenticated.value = false;
          userProfile.value = null;
        }
      });

      isAuthenticated.value = prividiumInstance.isAuthorized();

      if (isAuthenticated.value) {
        void loadUserProfile();
      }
    } catch (e) {
      // TODO: TEMP - allow app to render without backend for UI review
      console.warn('Prividium SDK init failed (backend not running?):', e);
      return null;
    }
  }
  return prividiumInstance;
}

async function loadUserProfile() {
  const prividium = initializePrividium();
  if (!prividium) return;
  try {
    const sdkProfile = await prividium.fetchUser();
    console.debug('[prividium] fetchUser result', sdkProfile);
    userProfile.value = toAppUserProfile(sdkProfile);
    return;
  } catch (error) {
    console.error('Failed to fetch user profile via SDK:', error);
  }

  const headers = prividium.getAuthHeaders();
  if (!headers) {
    userProfile.value = null;
    return;
  }

  const apiBaseUrl = import.meta.env.VITE_PRIVIDIUM_API_URL?.replace(/\/$/, '');
  const candidates = apiBaseUrl ? [`${apiBaseUrl}/profiles/me`] : [];

  for (const url of candidates ?? []) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      });
      if (!response.ok) {
        continue;
      }
      const data = (await response.json()) as {
        walletAddresses?: string[];
        wallets?: Array<{ walletAddress: string }>;
        userId?: string;
        id?: string;
        user?: { id?: string };
        profileId?: string;
        createdAt: string;
        updatedAt: string;
        displayName?: string;
        roles?: unknown[];
      };
      console.debug('[prividium] /profiles/me response', data);
      const walletAddresses =
        data.walletAddresses ??
        (Array.isArray(data.wallets) ? data.wallets.map((w) => w.walletAddress) : []);
      const userId = data.userId ?? data.id ?? data.user?.id ?? data.profileId ?? null;
      if (!userId) {
        throw new Error('User profile missing id');
      }
      const roles = Array.isArray(data.roles)
        ? data.roles
            .map((role) => {
              if (typeof role === 'string') {
                return { roleName: role };
              }
              if (
                role &&
                typeof role === 'object' &&
                'roleName' in role &&
                typeof (role as { roleName?: unknown }).roleName === 'string'
              ) {
                return { roleName: (role as { roleName: string }).roleName };
              }
              return null;
            })
            .filter((role): role is { roleName: string } => role !== null)
        : [];
      userProfile.value = {
        id: userId,
        userId,
        createdAt: new Date(data.createdAt),
        displayName: data.displayName ?? null,
        updatedAt: new Date(data.updatedAt),
        roles,
        wallets: walletAddresses,
        walletAddresses
      };
      return;
    } catch (fallbackError) {
      console.warn('Fallback profile fetch failed:', fallbackError);
    }
  }

  userProfile.value = null;
}

export function usePrividium() {
  const prividium = initializePrividium();

  const userEmail = computed(
    () => userProfile.value?.displayName || userProfile.value?.userId || null
  );
  const userName = computed(() => userProfile.value?.displayName || 'User');
  const userRoles = computed(() => userProfile.value?.roles || []);
  const userWallets = computed(() => userProfile.value?.walletAddresses || []);

  async function authenticate() {
    if (!prividium) return false;
    isAuthenticating.value = true;
    authError.value = null;

    try {
      await prividium.authorize();
      isAuthenticated.value = true;
      await loadUserProfile();

      return true;
    } catch (error) {
      console.error('Authentication failed:', error);
      authError.value = error instanceof Error ? error.message : 'Authentication failed';
      isAuthenticated.value = false;
      return false;
    } finally {
      isAuthenticating.value = false;
    }
  }

  function signOut() {
    prividium?.unauthorize();
    isAuthenticated.value = false;
    userProfile.value = null;
    authError.value = null;
  }

  function getAuthHeaders() {
    return prividium?.getAuthHeaders() ?? null;
  }

  async function refreshUserProfile() {
    await loadUserProfile();
    return userProfile.value;
  }

  function getTransport() {
    return prividium?.transport;
  }

  function getChain() {
    return prividium?.chain;
  }

  async function enableWalletToken(params: {
    walletAddress: `0x${string}`;
    contractAddress: `0x${string}`;
    nonce: number;
    calldata: `0x${string}`;
  }): Promise<{ message: string; activeUntil: string }> {
    if (!prividium) {
      throw new Error('Prividium SDK is not initialized.');
    }

    return await prividium.authorizeTransaction({
      walletAddress: params.walletAddress,
      toAddress: params.contractAddress,
      nonce: params.nonce,
      calldata: params.calldata
    });
  }

  async function addNetworkToWallet() {
    return prividium?.addNetworkToWallet();
  }

  async function getWalletToken() {
    return prividium?.getWalletToken();
  }

  async function getWalletRpcUrl(): Promise<string> {
    if (!prividium) {
      throw new Error('Prividium SDK is not initialized.');
    }

    return await prividium.getWalletRpcUrl();
  }

  return {
    isAuthenticated: computed(() => isAuthenticated.value),
    isAuthenticating: computed(() => isAuthenticating.value),
    userEmail,
    userName,
    userRoles,
    userWallets,
    authError: computed(() => authError.value),
    userProfile: computed(() => userProfile.value),

    authenticate,
    signOut,
    getAuthHeaders,
    refreshUserProfile,
    getTransport,
    getChain,
    enableWalletToken,
    addNetworkToWallet,
    getWalletToken,
    getWalletRpcUrl,

    prividium
  };
}
