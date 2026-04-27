/**
 * Simple API client for Prividium Admin API
 * Replaces the @repo/api-types dependency with a lightweight fetch-based implementation
 */

export interface ApiClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface ApiResponse<T> {
  response: Response;
  data?: T;
  error?: unknown;
}

export class ApiClient {
  constructor(private config: ApiClientConfig) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        return { response, error, data: undefined };
      }

      const data = (await response.json()) as T;
      return { response, data, error: undefined };
    } catch (error) {
      throw new Error(`API request failed: ${error}`);
    }
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }
}

// Type definitions for API responses
export interface SiweMessage {
  msg: string;
  nonce?: string;
  nonceToken?: string;
}

export interface AuthResponse {
  token: string;
}

export interface Application {
  id: string;
  name: string;
  origin: string;
  oauthClientId: string;
  oauthRedirectUris: string[];
}

export interface Contract {
  id: string;
  contractAddress: string;
  name: string;
  description: string;
  abi: string;
}

export interface Role {
  id: string;
  roleName: string;
  systemPermissions: string[];
}

export interface ContractPermission {
  id: string;
  contractAddress: string;
  functionSignature: string;
  methodSelector: string;
  accessType: 'read' | 'write';
  ruleType: 'public' | 'checkRole' | 'restrictArgument';
  roles: Array<{ roleName: string }>;
  argumentRestrictions: Array<{ argumentIndex: number }>;
}

export interface ContractPermissionList {
  items: ContractPermission[];
  total?: number;
}

// API helper functions
export async function postSiweMessages(
  client: ApiClient,
  body: { address: string; domain: string }
): Promise<ApiResponse<SiweMessage>> {
  return client.post<SiweMessage>('/siwe-messages/', body);
}

export async function postAuthLoginCryptoNative(
  client: ApiClient,
  body: { message: string; signature: string; nonceToken?: string }
): Promise<ApiResponse<AuthResponse>> {
  return client.post<AuthResponse>('/auth/login/crypto-native', body);
}

export async function postApplications(
  client: ApiClient,
  body: { name: string; origin: string; oauthRedirectUris: string[] }
): Promise<ApiResponse<Application>> {
  return client.post<Application>('/applications/', body);
}

export async function postContracts(
  client: ApiClient,
  body: {
    name: string;
    description: string;
    abi: string;
    contractAddress: string;
    discloseBytecode: boolean;
    discloseErc20TotalSupply: boolean;
    disclosedAddresses?: Array<{ address: string }>;
  }
): Promise<ApiResponse<Contract>> {
  return client.post<Contract>('/contracts/', body);
}

export async function getContractByAddress(
  client: ApiClient,
  contractAddress: string
): Promise<ApiResponse<Contract>> {
  return client.get<Contract>(`/contracts/${encodeURIComponent(contractAddress)}`);
}

export async function postContractPermissions(
  client: ApiClient,
  body: {
    contractAddress: string;
    functionSignature: string;
    methodSelector: string;
    accessType: 'read' | 'write';
    ruleType: 'public' | 'checkRole' | 'restrictArgument';
    roles: Array<{ roleName: string }>;
    argumentRestrictions: Array<{ argumentIndex: number }>;
  }
): Promise<ApiResponse<ContractPermission>> {
  return client.post<ContractPermission>('/contract-permissions/', body);
}

export async function getContractPermissions(
  client: ApiClient,
  params: { contractAddress?: string; methodSelector?: string; limit?: number; offset?: number }
): Promise<ApiResponse<ContractPermissionList>> {
  const search = new URLSearchParams();
  if (params.contractAddress) search.set('contractAddress', params.contractAddress);
  if (params.methodSelector) search.set('methodSelector', params.methodSelector);
  if (params.limit !== undefined) search.set('limit', params.limit.toString());
  if (params.offset !== undefined) search.set('offset', params.offset.toString());
  const query = search.toString();
  const path = `/contract-permissions/${query ? `?${query}` : ''}`;
  return client.get<ContractPermissionList>(path);
}

export async function postRoles(
  client: ApiClient,
  body: { roleName: string; systemPermissions: string[] }
): Promise<ApiResponse<Role>> {
  return client.post<Role>('/roles/', body);
}

export async function getRolesByName(client: ApiClient, name: string): Promise<ApiResponse<Role>> {
  return client.get<Role>(`/roles/${encodeURIComponent(name)}`);
}

export function extractRes<D>(obj: ApiResponse<D>): D {
  if (obj.error !== undefined) {
    throw new Error(`Error received from API: ${JSON.stringify(obj.error, null, 2)}`);
  }
  if (obj.data === undefined) {
    throw new Error('No data received from API');
  }
  return obj.data;
}
