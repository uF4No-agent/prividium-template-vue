<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { usePrividium } from '../composables/usePrividium';
import { useSsoAccount } from '../composables/useSsoAccount';
import { useWallet } from '../composables/useWallet';
import BaseIcon from './BaseIcon.vue';

const router = useRouter();
const { account: ssoAccount } = useSsoAccount();
const { isAuthenticated, signOut } = usePrividium();
const { disconnectWallet } = useWallet();

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Prividium™';
const companyIcon = import.meta.env.VITE_COMPANY_ICON || 'CubeIcon';

const dropdownOpen = ref(false);
const copied = ref(false);
const canShowSessionControls = computed(() => Boolean(isAuthenticated.value || ssoAccount.value));

const copyAddress = () => {
  if (ssoAccount.value) {
    void navigator.clipboard.writeText(ssoAccount.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
      dropdownOpen.value = false;
    }, 2000);
  }
};

const logout = async () => {
  try {
    await disconnectWallet();
  } catch (error) {
    console.warn('Wallet disconnect during logout failed:', error);
  }

  try {
    signOut();
    dropdownOpen.value = false;
    await router.replace('/login');
  } catch (error) {
    console.error('Logout error:', error);
  }
};

const closeDropdown = (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest('.wallet-dropdown-container')) {
    dropdownOpen.value = false;
  }
};

onMounted(() => window.addEventListener('click', closeDropdown));
onUnmounted(() => window.removeEventListener('click', closeDropdown));
</script>

<template>
  <nav class="floating-navbar">
    <div class="floating-navbar-inner">
      <div class="flex items-center gap-4 min-w-[200px]">
        <div class="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white shadow-lg">
          <BaseIcon :name="companyIcon" class="w-5 h-5" />
        </div>
        <span class="text-2xl font-bold tracking-tight">{{ companyName }}</span>
      </div>
      
      <div class="flex items-center gap-6 justify-end">
        <!-- Network Info -->
        <div class="hidden lg:flex items-center gap-3">
          <BaseIcon name="GlobeAltIcon" class="w-5 h-5 text-neutral-600" />
          <span class="text-sm font-semibold text-neutral-600 tracking-tight whitespace-nowrap">{{ companyName }}</span>
        </div>
        <div v-if="ssoAccount" class="relative wallet-dropdown-container">
          <button 
            @click="dropdownOpen = !dropdownOpen"
            class="bg-neutral-50 border border-neutral-200 hover:bg-neutral-100 text-neutral-900 px-6 py-2.5 rounded-full transition-all flex items-center gap-3 shadow-sm text-sm font-medium"
          >
            <BaseIcon name="WalletIcon" class="w-4 h-4 text-neutral-600" />
            <span class="font-mono">{{ ssoAccount?.slice(0, 6) }}...{{ ssoAccount?.slice(-4) }}</span>
            <BaseIcon name="ChevronDownIcon" :class="{ 'rotate-180': dropdownOpen }" class="w-3 h-3 text-neutral-600 transition-transform" />
          </button>
          
          <div v-if="dropdownOpen" class="absolute right-0 mt-2 w-48 bg-white border border-neutral-100 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <button 
              @click="copyAddress"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-neutral-600 hover:bg-neutral-50 rounded-xl transition-colors text-left"
            >
              <BaseIcon :name="copied ? 'CheckIcon' : 'DocumentDuplicateIcon'" :class="copied ? 'text-green-500' : 'text-neutral-600'" class="w-4 h-4" />
              <span>{{ copied ? 'Copied!' : 'Copy Address' }}</span>
            </button>
          </div>
        </div>

        <div v-else-if="canShowSessionControls" class="text-xs font-semibold text-neutral-600">
          SSO account not linked
        </div>
        <button 
          v-if="canShowSessionControls"
          @click="logout"
          title="Sign Out"
          class="p-3 text-neutral-600 hover:text-red-500 hover:bg-red-50 rounded-full transition-all border border-transparent hover:border-red-100"
        >
          <BaseIcon name="ArrowRightOnRectangleIcon" class="w-5 h-5" />
        </button>
      </div>
    </div>
  </nav>
</template>
