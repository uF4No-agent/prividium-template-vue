# Prividium Template Vue Monorepo

This template is a starting point for building privacy-focused decentralized applications on Prividium™ chains. It includes a basic counter contract, a setup script to deploy contracts and configure permissions for the sample counter contract in the ZKsync Prividium™ ecosystem, a Node.js backend service necessary for ZKsync SSO Smart Account deployment, and a Vue 3 + TypeScript frontend demonstrating Prividium authentication and secure RPC proxying to interact with smart contracts.

## Main Features

- 🔐 ZKsync SSO Smart accounts and Passkeys (no browser wallets needed)
- 🫆 Transaction signing with biometrics
- 🤖 AI Agents context files
- ⚙️ Setup script for Prividium permissions
- 🎨 Easy branding and style customization
 
## Using this template

[Click here to create a new repo from this template](https://github.com/new?template_name=prividium-template-vue&template_owner=uF4No)

## Requirements

### System requirements

- Node.js v22.10.0 or higher
- pnpm v9.16.1 or higher
- Foundry v1.0.0 or higher
- Docker

### Prividium base chain

This project requires a target ZKsync Prividium™ chain to connect to. You can either run a local Prividium instance following the instructions in the [local Prividium repo](https://github.com/matter-labs/local-prividium) (requires access to private Docker registry) or use a remote Prividium instance.

Make sure the Prividium chain is running with the Bundler service enabled. It requires configuring the permissions API with the following environment variables:

```sh
# Bundler (ERC-4337) Configuration
# Set BUNDLER_ENABLED=true to enable bundler RPC methods
BUNDLER_ENABLED=true
BUNDLER_RPC_URL=http://localhost:4337 # or BUNDLER_RPC_URL=http://bundler:4337 in local-prividium

```

> [!NOTE]
> Bundler service is enabled by default in [local-prividium](https://github.com/matter-labs/local-prividium).

## Quick Start

> [!IMPORTANT]
> You need to have a Prividium base chain running with the Bundler service enabled. See the [Prividium base chain](#prividium-base-chain) section for more information.

### 1. Install Dependencies

This project uses `pnpm` workspaces. Install everything from the root:

```bash
pnpm install
```

### 2. Compile app contracts

Compile the app contracts (e.g. Counter) with:

```bash
pnpm --filter contracts build
```

### 3. Pre-deploy contracts and permissions

The setup script deploys the app specific contracts (e.g. Counter) and configures permissions for them in the Prividium API.

Configure the `.env` file in the `setup/` directory with the required env vars and endpoints to your target Prividium chain and API, app client name etc. See the `setup/.env.example` as reference.

Run the setup script with:

```sh
pnpm run setup:no-sso
```

You'll see the progress of the deployment and app creation on the terminal. Contract addresses will be stored in `config/contracts.json`.

Finally, the job synchronizes contract addresses to the `.env` files in the `web-app/` and `backend/` directories.

### 4. SSO Smart Account Configuration

As this demo uses ZKsync SSO smart accounts, the `DISPATCHER_SSO_BYTECODE_HASHES` and `DISPATCHER_SSO_IMPLEMENTATIONS` are required in the Prividium Permissions API. 

Update the Permissions API `.env` file (or pass this values via Dockerfile) to include the following values. You can find both values in the `local-prividium/dev/sso-setup/contracts.env` file.

```sh
# SSO Smart Account Dispatcher Configuration (optional)
# Used for verifying smart account proxy contracts

# SSO implementation contract address
DISPATCHER_SSO_IMPLEMENTATIONS=0x998abeb3e57409262ae5b751f60747921b33613e
# Calculated with cast keccak $(cast code SMART_ACCOUNT_ADDRESS --rpc-url http://localhost:5050)
DISPATCHER_SSO_BYTECODE_HASHES=0x77a9210e5f94158c7e8f7e84e9601f427e8c1d5f09dfd434afd16314456b0a0f
```

> [!NOTE]
> After updating the `.env` file for the permissions API, restart all Prividium services.

### 5. Start Backend service

The backend service (in `./backend`) provides different endpoints to allow the deployment of the SSO smart contract accounts from the web app (in `./web-app`). This service requires multiple environment variables like the Prividium endpoints (RPC, auth, api), the SSO contract addresses (factory, beacon, account implementation, webauthn validator, eoa validator, session validator, guardian executor, entry point). Configure them in the `backend/.env` file using the `env.exmaple` as a reference.

To start the backend service run:

```sh
pnpm dev:backend
```

The backend service also enables interop transactions (optional and not used in this example app) via the the `L1_INTEROP_HANDLER` and `L2_INTEROP_CENTER` env variables.

### 6. Start Web app

The web app (in `./web-app`) is a Vue.js application that allows users to create Passkeys and deploy SSO smart contract accounts. It requires multiple environment variables like the Prividium endpoints (RPC, auth, api), and the Counter contract address. Configure them in the `web-app/.env` file using the `web-app/env.example` as a reference.

To start the web app run:

```sh
pnpm dev:web-app
```

> [!IMPORTANT]
> Start the web app and backend services in separate terminals.

### 7. Use the app

Navigate to [http://localhost:3002](http://localhost:3002) and log in with a Prividium user (e.g. user@local.dev / password)Create a new passkey and use the app to interact with the Counter contract using passkeys.

### Working with AI

You can find AI context files in the `ai-context/` directory. These files provide context to AI agents about the project structure, code references, and best practices when building applications for Prividium chains.

### Branding and style customization

The web app can be easily updated to use different branding by updating the following environment variables in the `web-app/.env` file:

```sh
# Company name
VITE_COMPANY_NAME="Matter Labs"
# Accent color (hex)
VITE_ACCENT_COLOR="#3a00adff"
# Company icon (from https://heroicons.com/)
VITE_COMPANY_ICON="ArrowPathRoundedSquareIcon"
```

## Repository Structure

- [`setup/`](./setup): Setup scripts to deploy contracts and configure permissions for the sample counter contract in the ZKsync Prividium™ ecosystem. Can be easily extended to support multiple contracts.
- [`contracts/`](./contracts): A basic Foundry-based project with a sample counter contract. You can add other contracts here.
- [`backend/`](./backend): A Node.js backend service necessary for ZKsync SSO Smart Account deployment and interop transactions.
- [`web-app/`](./web-app): A Vue 3 + TypeScript frontend demonstrating Prividium authentication and secure RPC proxying to interact with smart contracts.

## Configuration Source of Truth

Contract addresses live in a single canonical file:

- `config/contracts.json`

This file is **generated by the setup scripts**. Do not edit contract addresses manually in `.env` files.  
If you need to refresh env files from the canonical config, run:

```bash
pnpm -C setup refresh:env
```

## Global Scripts

We provide several convenient scripts at the root level:

- `pnpm build`: Builds all packages (Contracts & Web App).
- `pnpm test`: Runs the default unit test suite (contracts + backend + setup + web-app).
- `pnpm test:unit`: Same as `pnpm test`.
- `pnpm test:ci`: Runs `test:unit` plus the setup Anvil deployment smoke test.
- `pnpm test:integration:local`: Runs opt-in live integration tests (requires local Prividium services running).
- `pnpm test:contracts`: Runs only `forge test` in `contracts`.
- `pnpm lint`: Runs Biome linter on all supported files.
- `pnpm format`: Automatically formats the codebase using Biome and Forge.
- `pnpm check`: Runs both linting and formatting verification.
- `pnpm -C setup refresh:env`: Sync `.env` files from `config/contracts.json`.

### Test execution model

- PR/CI-safe tests use mocks for Prividium API/auth and run deterministically.
- A real-chain smoke test runs against local Anvil for deployment validation:

```bash
pnpm --filter prividium-setup test:anvil-smoke
```

- Live Prividium integration tests are gated behind `RUN_LIVE_PRIVIDIUM_TESTS=1` and are intended for local/manual runs:

```bash
pnpm test:integration:local
```

For full testing commands and env behavior, see [`TESTING.md`](./TESTING.md).

## Troubleshooting

### Error `Details: Unknown dispatcher type`

This error means that the SSO smart account dispatcher is not configured in the Prividium Permissions API. See the [Step 4](#step-4-sso-smart-account-configuration) in the Quick Start section for more information.

### Error: `Untrusted smart account implementation Version`

This error means that the SSO smart account implementation is not configured in the Prividium Permissions API is not correct. Most likely, the SSO bytecode hash is not correct. See the [Step 4](#step-4-sso-smart-account-configuration) in the Quick Start section for more information.

## License

This project is licensed under the MIT License.
