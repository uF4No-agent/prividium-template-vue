import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { defineComponent, ref, nextTick } from 'vue';

import { clearStoredSsoState, saveAccountAddress } from '../../src/utils/sso/passkeys';

const userWallets = ref<string[]>([]);
const isAuthenticated = ref(true);

vi.mock('../../src/composables/usePrividium', () => ({
  usePrividium: () => ({
    userWallets,
    isAuthenticated
  })
}));

import { useSsoAccount } from '../../src/composables/useSsoAccount';

const TestComponent = defineComponent({
  setup() {
    return useSsoAccount();
  },
  template: '<div />'
});

afterEach(() => {
  clearStoredSsoState();
  userWallets.value = [];
  isAuthenticated.value = true;
});

describe('useSsoAccount', () => {
  it('keeps account when wallet is linked', async () => {
    saveAccountAddress('0x0000000000000000000000000000000000000001');
    userWallets.value = ['0x0000000000000000000000000000000000000001'];

    const wrapper = mount(TestComponent);

    expect((wrapper.vm as { account: string | null }).account).toBe(
      '0x0000000000000000000000000000000000000001'
    );
    wrapper.unmount();
  });

  it('clears account when linked wallets exclude saved account', async () => {
    saveAccountAddress('0x0000000000000000000000000000000000000001');
    userWallets.value = ['0x0000000000000000000000000000000000000002'];

    const wrapper = mount(TestComponent);

    expect((wrapper.vm as { account: string | null }).account).toBeNull();
    wrapper.unmount();
  });

  it('clears account immediately after logout even if local storage still has a saved wallet', async () => {
    saveAccountAddress('0x0000000000000000000000000000000000000001');
    userWallets.value = ['0x0000000000000000000000000000000000000001'];

    const wrapper = mount(TestComponent);

    expect((wrapper.vm as { account: string | null }).account).toBe(
      '0x0000000000000000000000000000000000000001'
    );

    isAuthenticated.value = false;
    await nextTick();

    expect((wrapper.vm as { account: string | null }).account).toBeNull();
    wrapper.unmount();
  });
});
