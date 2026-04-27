import type { Address } from 'viem';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { loadExistingPasskey } from '../utils/sso/passkeys';
import { PRIVIDIUM_LOGOUT_EVENT } from '../utils/sso/session';
import { usePrividium } from './usePrividium';

const ssoAccount = ref<Address | null>(null);

export function useSsoAccount() {
  const { userWallets, isAuthenticated } = usePrividium();

  const refresh = () => {
    if (!isAuthenticated.value) {
      ssoAccount.value = null;
      return;
    }

    const { savedAccount } = loadExistingPasskey();
    if (!savedAccount) {
      ssoAccount.value = null;
      return;
    }

    const linkedWallets = (userWallets.value ?? []).map((wallet) => wallet.toLowerCase());
    if (!linkedWallets.length) {
      // Keep the locally selected account visible if profile wallets are temporarily unavailable.
      ssoAccount.value = savedAccount;
      return;
    }
    const isLinked = linkedWallets.includes(savedAccount.toLowerCase());
    ssoAccount.value = isLinked ? savedAccount : null;
  };

  onMounted(() => {
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener(PRIVIDIUM_LOGOUT_EVENT, refresh);
  });

  onUnmounted(() => {
    window.removeEventListener('storage', refresh);
    window.removeEventListener(PRIVIDIUM_LOGOUT_EVENT, refresh);
  });

  watch([userWallets, isAuthenticated], refresh);

  return {
    account: computed(() => ssoAccount.value),
    refresh
  };
}
