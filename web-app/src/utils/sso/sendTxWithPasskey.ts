import {
  type Address,
  type Hex,
  type PublicClient,
  concat,
  encodeAbiParameters,
  pad,
  toHex
} from 'viem';
import { getUserOperationHash } from 'viem/account-abstraction';
import { signWithPasskey } from 'zksync-sso/client/passkey';

import { ssoChain, ssoContracts } from './constants';
import type { PasskeyCredential } from './types';

export async function sendTxWithPasskey(
  accountAddress: Address,
  passkeyCredentials: PasskeyCredential,
  txData: {
    to: Address;
    value: bigint;
    data: Hex;
  }[],
  gasOptions: {
    gasFees: Hex;
    accountGasLimits: Hex;
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  },
  readClient?: PublicClient,
  enableWalletToken?: (params: {
    walletAddress: `0x${string}`;
    contractAddress: `0x${string}`;
    nonce: number;
    calldata: `0x${string}`;
  }) => Promise<{ message: string; activeUntil: string }>
) {
  if (!readClient) {
    throw new Error('Authenticated RPC client required to send transactions.');
  }
  if (txData.length !== 1) {
    throw new Error('Batch transactions are not supported for passkey accounts.');
  }

  const [call] = txData;
  const modeCode = pad('0x01', { dir: 'right', size: 32 });
  const executionData = encodeAbiParameters(
    [
      {
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' }
        ],
        name: 'Call',
        type: 'tuple[]'
      }
    ],
    [txData]
  );
  const callData = concat([
    '0xe9ae5c53',
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [modeCode, executionData])
  ]);

  // Get nonce from EntryPoint
  const ENTRYPOINT_ABI = [
    {
      type: 'function',
      name: 'getNonce',
      inputs: [
        { name: 'sender', type: 'address' },
        { name: 'key', type: 'uint192' }
      ],
      outputs: [{ name: 'nonce', type: 'uint256' }],
      stateMutability: 'view'
    }
  ];

  const nonce = await readClient.readContract({
    address: ssoContracts.entryPoint,
    abi: ENTRYPOINT_ABI,
    functionName: 'getNonce',
    args: [accountAddress, 0n],
    account: accountAddress
  });

  if (enableWalletToken && txData.length > 0) {
    const nonceNumber = Number(nonce);
    if (!Number.isSafeInteger(nonceNumber)) {
      throw new Error('Nonce too large to authorize transaction');
    }
    await enableWalletToken({
      walletAddress: accountAddress,
      contractAddress: call.to,
      nonce: nonceNumber,
      calldata: call.data
    });
  }

  // Create PackedUserOperation for v0.8
  const packedUserOp = {
    sender: accountAddress,
    nonce: nonce as bigint,
    initCode: '0x' as Hex,
    callData,
    accountGasLimits: gasOptions.accountGasLimits,
    preVerificationGas: gasOptions.preVerificationGas,
    gasFees: gasOptions.gasFees,
    paymasterAndData: '0x' as Hex,
    signature: '0x' as Hex
  };

  const userOpHash = getUserOperationHash({
    chainId: ssoChain.id,
    entryPointAddress: ssoContracts.entryPoint,
    entryPointVersion: '0.8',
    userOperation: {
      sender: packedUserOp.sender,
      nonce: packedUserOp.nonce,
      factory: undefined,
      factoryData: undefined,
      callData: packedUserOp.callData,
      verificationGasLimit: gasOptions.verificationGasLimit,
      callGasLimit: gasOptions.callGasLimit,
      preVerificationGas: gasOptions.preVerificationGas,
      maxFeePerGas: gasOptions.maxFeePerGas,
      maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
      paymaster: undefined,
      paymasterVerificationGasLimit: undefined,
      paymasterPostOpGasLimit: undefined,
      paymasterData: undefined,
      signature: '0x'
    }
  });

  console.log('🔐 Requesting passkey authentication...');

  const credentialId =
    passkeyCredentials.credentialId.startsWith('0x')
      ? (passkeyCredentials.credentialId as Hex)
      : (toHex(
          Uint8Array.from(
            atob(
              passkeyCredentials.credentialId
                .replace(/-/g, '+')
                .replace(/_/g, '/')
                .padEnd(
                  passkeyCredentials.credentialId.length +
                    ((4 - (passkeyCredentials.credentialId.length % 4)) % 4),
                  '='
                )
            ),
            (char) => char.charCodeAt(0)
          )
        ) as Hex);

  packedUserOp.signature = await signWithPasskey({
    hash: userOpHash,
    credentialId,
    validatorAddress: ssoContracts.webauthnValidator,
    rpId: window.location.hostname,
    origin: window.location.origin
  });

  console.log('📤 Submitting UserOperation via Prividium RPC...');

  // Submit v0.8 packed format via authenticated RPC proxy
  const userOpForBundler = {
    sender: packedUserOp.sender,
    nonce: toHex(packedUserOp.nonce),
    factory: null, // No factory since account already deployed
    factoryData: null,
    callData: packedUserOp.callData,
    callGasLimit: toHex(gasOptions.callGasLimit),
    verificationGasLimit: toHex(gasOptions.verificationGasLimit),
    preVerificationGas: toHex(gasOptions.preVerificationGas),
    maxFeePerGas: toHex(gasOptions.maxFeePerGas),
    maxPriorityFeePerGas: toHex(gasOptions.maxPriorityFeePerGas),
    paymaster: null, // No paymaster
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    signature: packedUserOp.signature
  };

  type RpcRequestArgs = { method: string; params?: unknown[] };
  const rpcRequest = readClient.request as unknown as (args: RpcRequestArgs) => Promise<unknown>;

  // Submit to bundler (v0.8 RPC format)
  const userOpHashFromBundler = (await rpcRequest({
    method: 'eth_sendUserOperation',
    params: [userOpForBundler, ssoContracts.entryPoint]
  })) as `0x${string}`;
  console.log(`UserOperation submitted: ${userOpHashFromBundler}`);
  console.log('⏳ Waiting for confirmation...');

  // Poll for receipt
  type UserOpReceipt = { success: boolean; receipt: { transactionHash: `0x${string}` } };
  let receipt: UserOpReceipt | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const receiptResult = await rpcRequest({
      method: 'eth_getUserOperationReceipt',
      params: [userOpHashFromBundler]
    });

    if (receiptResult) {
      receipt = receiptResult as UserOpReceipt;
      break;
    }
  }

  if (!receipt) {
    throw new Error('Transaction timeout - could not get receipt');
  }

  if (receipt.success) {
    console.log('RECEIPT:', receipt);
    console.log('✅ Transfer successful!');
    return receipt.receipt.transactionHash;
  }
  throw new Error('Transaction failed');
}
