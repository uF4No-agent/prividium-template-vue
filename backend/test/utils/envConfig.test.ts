import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadEnv, parseEnv } from '@/utils/envConfig';

function createBaseEnv() {
  return {
    NODE_ENV: 'test',
    EXECUTOR_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    L1_RPC_URL: 'http://localhost:8545',
    PRIVIDIUM_API_URL: 'http://localhost:8000/api'
  };
}

describe('envConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses valid env values and applies defaults', () => {
    const parsed = parseEnv(createBaseEnv());

    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(4340);
    expect(parsed.POLL_INTERVAL).toBe(30000);
    expect(parsed.PRIVIDIUM_CHAIN_ID).toBe(8022833);
  });

  it('throws for invalid required values', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      parseEnv({
        ...createBaseEnv(),
        EXECUTOR_PRIVATE_KEY: '0x123'
      })
    ).toThrow('Invalid environment variables');
  });

  it('supports explicit loading without dotenv side effects', () => {
    const env = loadEnv({ loadDotenv: false, env: createBaseEnv() });

    expect(env.isTest).toBe(true);
    expect(env.isDevelopment).toBe(false);
  });
});
