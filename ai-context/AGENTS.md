# Prividium AGENTS-ONLY Rules (Template Scope)

Use this file for strict, low-context agent execution in this repository.

## Scope

Authoritative implementation references:
- `./web-app`
- `./setup`
- `./backend`

If generic docs conflict, follow these references.

## Hard Rules

1. Assume authenticated access is required for Prividium API/RPC operations.
2. In web-app code, use SDK transport/chain from `usePrividium` (`getTransport`, `getChain`).
3. For setup/backend automation, use SIWE login and Bearer token.
4. After deployment, ensure contract registration + function permissions exist.
5. For smart-account writes, send `eth_sendUserOperation` via authenticated `/rpc` client.
6. For browser-wallet EOAs, configure wallet network with per-user wallet RPC URL (`/rpc/wallet/<token>` path).

## Required Flows

### A) Admin/setup auth

1. `POST /siwe-messages/`
2. Capture both `msg` and `nonceToken` from the response
3. Sign message with admin key
4. `POST /auth/login/crypto-native` with `message`, `signature`, and `nonceToken`
5. Reuse Bearer token for API + RPC

### B) App contract setup

1. Create app (`POST /applications/`)
2. Deploy contracts via authenticated RPC transport
3. Register contract (`POST /contracts/`) with current schema fields:
   - `discloseErc20TotalSupply`
   - `discloseBytecode`
   - `disclosedAddresses`
4. For each ABI function, create permission (`POST /contract-permissions/`) with:
   - `accessType`: `read` for `view/pure`, else `write`
   - `ruleType`: `public`
   - `roles`: `[]`
   - `argumentRestrictions`: `[]`

### C) Web passkey write

1. Build authenticated `PublicClient` from SDK transport
2. Get nonce (`EntryPoint.getNonce`)
3. Optional: pre-authorize primary call via `enableWalletToken` when policy requires tx allowance
4. Build/sign userOp
5. Send `eth_sendUserOperation`
6. Poll `eth_getUserOperationReceipt`

### D) Browser wallet (EOA) flow

1. Authenticate with Prividium SDK.
2. Configure wallet network using per-user wallet RPC URL from `getWalletRpcUrl()` (or `addNetworkToWallet()`).
3. Use authenticated SDK transport for app reads; do not rely on `window.ethereum` reads for protected RPC.
4. For writes, send via wallet provider; if policy requires pre-authorization, call `prividium.authorizeTransaction` first with the matching nonce/call data.

## Template-Specific API Notes

1. In this wrapper, `authorizeTransaction` is called with `toAddress` (not `contractAddress`).
2. `setup` scripts already automate contract registration + permissions.
3. New passkey account creation is backend-driven via `/deploy-account`; backend links wallet to user.
4. `enableWalletToken` is wired in the sample passkey flow but should be treated as policy-dependent, not universally mandatory.
5. Older contract-registration field names like `discloseErc20Balance` and `erc20LockAddresses` are stale for the current API in this repo.

## Do / Don’t

Do:
- Reuse existing helpers before creating new auth/transport logic.

Don’t:
- Use unauthenticated raw RPC for this template’s normal flows.
- Assume manual Admin Panel steps are always required after setup scripts.
- Assume EOA/MetaMask is the primary write path in the sample app.
- Invent tenant-specific login paths; verify against API spec before use.
- Use wallet-RPC (`getWalletRpcUrl`) for smart-account 4337 flows.

## Quick Pre-Flight Checklist

1. Is auth token available and valid?
2. Is transport authenticated for API/RPC call path?
3. Is target contract registered?
4. Is target function permission present?
5. Is the flow passkey smart-account or EOA wallet, and are you using the correct path?
