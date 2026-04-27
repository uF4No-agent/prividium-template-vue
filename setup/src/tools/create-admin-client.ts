import { privateKeyToAccount } from 'viem/accounts';
import { ApiClient, extractRes, postAuthLoginCryptoNative, postSiweMessages } from './api-client';

export type Client = ApiClient;

function normalizeBaseUrl(rawBaseUrl: string): string {
  return rawBaseUrl.replace(/\/+$/, '');
}

export async function createAdminSession(
  baseUrl: string,
  siweDomain: string,
  adminPrivateKey: `0x${string}`,
  adminAddress: `0x${string}`
) {
  let normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  let anonApiClient = new ApiClient({ baseUrl: normalizedBaseUrl });

  const viemAccount = privateKeyToAccount(adminPrivateKey);

  let siweMsgRes = await postSiweMessages(anonApiClient, {
    address: adminAddress,
    domain: siweDomain
  });

  if (
    siweMsgRes.error &&
    typeof siweMsgRes.error === 'object' &&
    siweMsgRes.error !== null &&
    'statusCode' in siweMsgRes.error &&
    (siweMsgRes.error as { statusCode?: number }).statusCode === 404 &&
    !normalizedBaseUrl.endsWith('/api')
  ) {
    normalizedBaseUrl = `${normalizedBaseUrl}/api`;
    anonApiClient = new ApiClient({ baseUrl: normalizedBaseUrl });
    siweMsgRes = await postSiweMessages(anonApiClient, {
      address: adminAddress,
      domain: siweDomain
    });
  }

  const siweMsg = extractRes(siweMsgRes);

  const signature = await viemAccount.signMessage({ message: siweMsg.msg });

  const { token } = extractRes(
    await postAuthLoginCryptoNative(anonApiClient, {
      message: siweMsg.msg,
      signature,
      nonceToken: siweMsg.nonceToken
    })
  );

  const client = new ApiClient({
    baseUrl: normalizedBaseUrl,
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  return { client, token };
}

export async function createAdminApiClient(
  baseUrl: string,
  siweDomain: string,
  adminPrivateKey: `0x${string}`,
  adminAddress: `0x${string}`
) {
  const { client } = await createAdminSession(baseUrl, siweDomain, adminPrivateKey, adminAddress);
  return client;
}
