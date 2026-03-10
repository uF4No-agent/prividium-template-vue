import { metaMask } from '@wagmi/connectors';
import { connect, disconnect, getAccount, getChainId, watchAccount } from '@wagmi/core';
import { createWalletClient, custom } from 'viem';
import { computed, ref } from 'vue';
import { config, prividiumChain } from '../wagmi';
import { usePrividium } from './usePrividium';

// Shared state
const account = ref(getAccount(config));
const currentChainId = ref(getChainId(config));
const isConnecting = ref(false);
const error = ref<string | null>(null);

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

// Initialize watchers once
watchAccount(config, {
  onChange(data) {
    account.value = data;
    currentChainId.value = data.chainId ?? getChainId(config);
  }
});

// Computed properties
const isConnected = computed(() => account.value.isConnected);
const address = computed(() => account.value.address);
const isCorrectNetwork = computed(() => currentChainId.value === prividiumChain.id);

// Wallet client for direct viem interactions
const walletClient = computed(() => {
  if (!isConnected.value || !isCorrectNetwork.value || !window.ethereum) {
    return null;
  }

  return createWalletClient({
    account: account.value.address,
    chain: prividiumChain,
    transport: custom(window.ethereum)
  });
});

export function useWallet() {
  const { getWalletRpcUrl } = usePrividium();

  // Connect wallet
  const connectWallet = async () => {
    try {
      isConnecting.value = true;
      error.value = null;

      await connect(config, {
        connector: metaMask()
      });

      account.value = getAccount(config);
      currentChainId.value = getChainId(config);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to connect wallet';
      throw err;
    } finally {
      isConnecting.value = false;
    }
  };

  // Disconnect wallet
  const disconnectWallet = async () => {
    try {
      await disconnect(config);
      account.value = getAccount(config);
      currentChainId.value = getChainId(config);
      error.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to disconnect wallet';
      throw err;
    }
  };

  // Helper function to ensure network is configured with /wallet/{token} RPC URL (matching React)
  const ensureNetworkConfigured = async (): Promise<void> => {
    if (!window.ethereum) {
      throw new Error('Wallet not detected');
    }

    const ethereum = window.ethereum as EthereumProvider;
    const chainIdHex = `0x${prividiumChain.id.toString(16)}`;

    try {
      // 1. Try to switch first
      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }]
        });
        console.log('Switched to Prividium network');
      } catch (switchError) {
        const errorWithCode = switchError as { code?: number };
        if (errorWithCode.code === 4902) {
          console.log('Network not found, adding it...');
        } else {
          throw switchError;
        }
      }

      // 2. Add/Update with the per-user RPC URL
      const walletRpcUrl = await getWalletRpcUrl();

      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: prividiumChain.name,
            nativeCurrency: {
              name: prividiumChain.nativeCurrency?.name || 'Ether',
              symbol: prividiumChain.nativeCurrency?.symbol || 'ETH',
              decimals: prividiumChain.nativeCurrency?.decimals || 18
            },
            rpcUrls: [walletRpcUrl],
            blockExplorerUrls: prividiumChain.blockExplorers?.default?.url
              ? [prividiumChain.blockExplorers.default.url]
              : undefined
          }
        ]
      });
      console.log('Prividium network configured with /wallet/{token} RPC URL');
    } catch (err) {
      console.error('Error ensuring network configuration:', err);
      throw err;
    }
  };

  // Switch to the correct network
  const switchToCorrectNetwork = async () => {
    try {
      error.value = null;
      console.log('Switching to Prividium network...');

      await ensureNetworkConfigured();

      // Poll for chain ID update (matching React's polling logic)
      const maxAttempts = 20;
      let attempts = 0;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250));

        if (window.ethereum) {
          const hexId = (await (window.ethereum as EthereumProvider).request({
            method: 'eth_chainId'
          })) as string;
          const providerChainId = Number.parseInt(hexId, 16);

          if (providerChainId === prividiumChain.id) {
            console.log('Chain switch completed successfully. ChainId:', providerChainId);
            break;
          }
        }
        attempts++;
      }

      account.value = getAccount(config);
      currentChainId.value = getChainId(config);
    } catch (err) {
      console.error('Switch network error:', err);
      error.value = err instanceof Error ? err.message : 'Failed to switch network';
      throw err;
    }
  };

  // Ensure wallet is ready
  const ensureWalletReady = async (): Promise<boolean> => {
    if (!isConnected.value) {
      await connectWallet();
    }

    // Direct check of the provider's chain ID
    const getActualChainId = async () => {
      if (!window.ethereum) return 0;
      const hexId = (await (window.ethereum as EthereumProvider).request({
        method: 'eth_chainId'
      })) as string;
      return Number.parseInt(hexId, 16);
    };

    let actualCid = await getActualChainId();
    if (actualCid !== prividiumChain.id) {
      console.log(
        `Current chain ${actualCid} does not match target ${prividiumChain.id}. Switching...`
      );
      await switchToCorrectNetwork();
      actualCid = await getActualChainId();
    }

    currentChainId.value = actualCid;
    account.value = getAccount(config);

    return isConnected.value && actualCid === prividiumChain.id;
  };

  return {
    account: computed(() => account.value),
    chainId: currentChainId,
    isConnecting: computed(() => isConnecting.value),
    error: computed(() => error.value),
    isConnected,
    address,
    isCorrectNetwork,
    walletClient,
    connectWallet,
    disconnectWallet,
    switchToCorrectNetwork,
    ensureWalletReady,
    cleanup: () => {},
    customChain: prividiumChain
  };
}
