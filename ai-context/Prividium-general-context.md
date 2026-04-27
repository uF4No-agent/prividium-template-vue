# Prividium General Context (Template-Accurate)

This file provides general context for this template.
It reflects the actual implementation in:
- `web-app`
- `setup`
- `backend`

If this file conflicts with generic Prividium docs, prefer this file for this template.

## 1. Non-Negotiable Rules

1. All meaningful RPC/API access is authenticated.
2. Use the Prividium SDK transport for web-app RPC clients.
3. Setup/admin jobs authenticate with SIWE, then send `Authorization: Bearer <token>` to API and RPC.
4. Contract registration and method permissions are required; this template configures them automatically via API.
5. For passkey smart-account writes, submit `eth_sendUserOperation` through authenticated `/rpc` transport.

## 2. Frontend (Web App) Truths

### 2.1 Auth + SDK Initialization

- The app initializes Prividium via `createPrividiumChain(...)`.
- It uses:
  - `prividium.transport` for authenticated RPC
  - `prividium.chain` for chain config
  - `prividium.getAuthHeaders()` for authenticated API calls

Reference:
- `web-app/src/composables/usePrividium.ts`

### 2.2 Read Path (Current Template)

- Reads are done with a `PublicClient` created from `getTransport()` and `getChain()`.
- Do not build reads from unauthenticated raw RPC in this template.

Reference:
- `web-app/src/composables/useRpcClient.ts`

### 2.3 Write Path (Current Template = Passkeys / 4337)

The active app flow is passkey + smart account, not MetaMask EOA transactions.

Flow:
1. Build call data.
2. Fetch smart-account nonce from EntryPoint `getNonce(...)` using authenticated RPC.
3. Build/sign user operation with passkey.
4. Send `eth_sendUserOperation` via authenticated RPC client.
5. Poll `eth_getUserOperationReceipt`.

References:
- `web-app/src/composables/useCounterContract.ts`
- `web-app/src/utils/sso/sendTxWithPasskey.ts`
- `web-app/src/composables/usePrividium.ts`

Important param detail:
- In this template wrapper, authorization uses `toAddress`, not `contractAddress`.

### 2.4 New Passkey Account Creation

Frontend sends to backend `/deploy-account`:
- `userId`
- `originDomain`
- `credentialId`
- `credentialPublicKey`

Backend then:
1. Deploys smart account.
2. Configures smart-account permissions in Prividium API.
3. Associates wallet to user profile.

**Important**: the `backend` server is a helper service with minimal functionality. It's not intended to be used for production. It's only used to showcase the flow of creating a new passkey account.

References:
- `web-app/src/views/LoginView.vue`
- `backend/src/api/deployAccountRouter.ts`
- `backend/src/utils/accounts/deploy-account.ts`

## 3. Setup Job Truths (API + Deployment + Permissions)

### 3.1 Admin Auth (SIWE)

Setup authenticates admin via:
1. `POST /siwe-messages/`
2. Read both `msg` and `nonceToken` from the response.
3. Sign `msg` with the admin private key.
4. `POST /auth/login/crypto-native` with `message`, `signature`, and `nonceToken`.
5. Use Bearer token in subsequent API/RPC calls.

Reference:
- `setup/src/tools/create-admin-client.ts`
- `setup/src/tools/api-client.ts`

### 3.2 Contract Deployment

Setup deploys contracts with viem wallet/public clients over authenticated transport:
- Adds `Authorization: Bearer <token>` in transport `fetchFn`.
- Uses `walletClient.deployContract(...)`.
- Waits receipt and extracts `contractAddress`.

Reference:
- `setup/src/tools/deploy.ts`
- `setup/src/tools/sso-deploy.ts`

### 3.3 Contract Registration + Permissions

Setup registers each contract in Prividium API (`/contracts/`) and configures function permissions (`/contract-permissions/`) from ABI.

Current contract-registration payloads must use:
- `discloseErc20TotalSupply`
- `discloseBytecode`
- `disclosedAddresses`

Older field names such as `discloseErc20Balance` and `erc20LockAddresses` are stale for the current API.

Function permissions still follow:
- `accessType`: `read` for `view/pure`, else `write`
- `ruleType`: `public`
- `roles`: `[]`
- `argumentRestrictions`: `[]`

Reference:
- `setup/src/setups/counter-setup.ts`
- `setup/src/setups/sso-setup.ts`

### 3.4 Manual Admin-Panel Step?

In this template’s automated flows: usually no manual admin panel step is needed after deploy, because setup/backend scripts register contracts and permissions programmatically.

Manual panel work is only needed if you deploy outside these scripts.

## 4. EOA Wallet Network Notes

This repo has helper code for EOA wallet network configuration:
- fetch per-user wallet RPC URL via `getWalletRpcUrl()`
- call `wallet_addEthereumChain` with that URL

Reference:
- `web-app/src/composables/useWallet.ts`

The sample app’s main write path remains passkey smart accounts.

## 5. API Endpoints Used By This Template

Auth:
- `POST /siwe-messages/`
- `POST /auth/login/crypto-native`

Auth note:
- `/siwe-messages/` returns `nonce`, `msg`, and `nonceToken`.
- `/auth/login/crypto-native` now requires `nonceToken` alongside `message` and `signature`.

App + contract setup:
- `POST /applications/`
- `POST /contracts/`
- `GET /contracts/{contractAddress}`
- `POST /contract-permissions/`
- `GET /contract-permissions/?contractAddress=...&methodSelector=...`

User linkage (backend flow):
- `GET /users/{userId}`
- `PUT /users/{userId}` (updates wallets list)

## 6. Agent Do/Don’t

Do:
- Reuse authenticated transports from SDK/setup helpers.

Do not:
- Assume newly deployed contracts are usable before registration/permissions.
- Assume this template’s main write path is EOA MetaMask.
- Assume tenant-specific flows unless explicitly needed for a task.
