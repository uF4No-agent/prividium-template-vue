import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const routerReplace = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const disconnectWallet = vi.hoisted(() => vi.fn(async () => undefined));
const isAuthenticated = ref(true);
const ssoAccount = ref<string | null>(null);

vi.mock('vue-router', () => ({
  useRouter: () => ({
    replace: routerReplace
  })
}));

vi.mock('../../src/composables/usePrividium', () => ({
  usePrividium: () => ({
    isAuthenticated,
    signOut
  })
}));

vi.mock('../../src/composables/useWallet', () => ({
  useWallet: () => ({
    disconnectWallet
  })
}));
vi.mock('../../src/composables/useSsoAccount', () => ({
  useSsoAccount: () => ({
    account: ssoAccount
  })
}));

import AppNavbar from '../../src/components/AppNavbar.vue';

afterEach(() => {
  vi.clearAllMocks();
  isAuthenticated.value = true;
  ssoAccount.value = null;
  disconnectWallet.mockReset();
});

describe('AppNavbar', () => {
  it('shows session warning when authenticated but no linked account', () => {
    const wrapper = mount(AppNavbar, {
      global: {
        stubs: {
          BaseIcon: true
        }
      }
    });

    expect(wrapper.text()).toContain('SSO account not linked');
  });

  it('copies wallet address from dropdown', async () => {
    ssoAccount.value = '0x0000000000000000000000000000000000000001';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    const wrapper = mount(AppNavbar, {
      global: {
        stubs: {
          BaseIcon: true
        }
      }
    });

    const walletButton = wrapper.find('.wallet-dropdown-container button');
    await walletButton.trigger('click');

    const copyButton = wrapper.find('.wallet-dropdown-container div button');
    await copyButton.trigger('click');

    expect(writeText).toHaveBeenCalledWith('0x0000000000000000000000000000000000000001');
  });

  it('logs out and redirects to login', async () => {
    const wrapper = mount(AppNavbar, {
      global: {
        stubs: {
          BaseIcon: true
        }
      }
    });

    const logoutButton = wrapper.find('button[title="Sign Out"]');
    await logoutButton.trigger('click');

    expect(disconnectWallet).toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
    expect(routerReplace).toHaveBeenCalledWith('/login');
  });
});
