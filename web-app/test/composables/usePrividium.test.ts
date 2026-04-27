import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchUser = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn());
const unauthorize = vi.hoisted(() => vi.fn());
const getAuthHeaders = vi.hoisted(() => vi.fn());
const isAuthorized = vi.hoisted(() => vi.fn());
const authorizeTransaction = vi.hoisted(() => vi.fn());
const createPrividiumChain = vi.hoisted(() => vi.fn());

vi.mock('prividium', () => ({
  createPrividiumChain
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_PRIVIDIUM_API_URL', 'http://localhost:8000/api');
  fetchUser.mockReset();
  authorize.mockReset();
  unauthorize.mockReset();
  getAuthHeaders.mockReset();
  isAuthorized.mockReset();
  authorizeTransaction.mockReset();
  createPrividiumChain.mockReset();

  createPrividiumChain.mockReturnValue({
    authorize,
    unauthorize,
    fetchUser,
    isAuthorized,
    getAuthHeaders,
    authorizeTransaction,
    transport: {},
    chain: {}
  });

  isAuthorized.mockReturnValue(false);
  getAuthHeaders.mockReturnValue({ Authorization: 'Bearer token' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('usePrividium', () => {
  it('maps fallback /profiles/me payload into app profile shape', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchUser.mockRejectedValue(new Error('sdk profile unavailable'));

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          userId: 'user-1',
          wallets: [{ walletAddress: '0x0000000000000000000000000000000000000001' }],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          displayName: 'Alice',
          roles: [{ roleName: 'admin' }]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    const { usePrividium } = await import('../../src/composables/usePrividium');
    const prividium = usePrividium();

    await prividium.refreshUserProfile();

    expect(prividium.userEmail.value).toBe('Alice');
    expect(prividium.userWallets.value).toEqual(['0x0000000000000000000000000000000000000001']);
    expect(prividium.userRoles.value).toEqual([{ roleName: 'admin' }]);
  });

  it('clears auth state on signOut', async () => {
    fetchUser.mockResolvedValue({
      id: 'user-1',
      wallets: ['0x0000000000000000000000000000000000000001'],
      displayName: 'Alice',
      roles: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const { usePrividium } = await import('../../src/composables/usePrividium');
    const prividium = usePrividium();

    await prividium.refreshUserProfile();
    expect(prividium.userWallets.value).toHaveLength(1);

    prividium.signOut();

    expect(unauthorize).toHaveBeenCalled();
    expect(prividium.userWallets.value).toEqual([]);
    expect(prividium.isAuthenticated.value).toBe(false);
  });
});
