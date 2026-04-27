import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAdminSession } from '../../src/tools/create-admin-client';

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    signMessage: vi.fn().mockResolvedValue('0xsigned')
  }))
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAdminSession', () => {
  it('falls back to /api base url when first SIWE endpoint returns 404 and forwards nonceToken', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ statusCode: 404, message: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ msg: 'Please sign this message', nonceToken: 'nonce-token-123' }),
          {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'token-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

    const { token } = await createAdminSession(
      'http://localhost:8000',
      'localhost:3001',
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      '0x0000000000000000000000000000000000000001'
    );

    expect(token).toBe('token-123');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8000/siwe-messages/');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:8000/api/siwe-messages/');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://localhost:8000/api/auth/login/crypto-native');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        message: 'Please sign this message',
        signature: '0xsigned',
        nonceToken: 'nonce-token-123'
      })
    });
  });
});
