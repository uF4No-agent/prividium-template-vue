import { type Address, type PublicClient, encodeFunctionData, getContract, pad, toHex } from 'viem';
import { loadExistingPasskey } from '../utils/sso/passkeys';
import { sendTxWithPasskey } from '../utils/sso/sendTxWithPasskey';

// Counter Contract ABI
const counterAbi = [
  {
    inputs: [],
    name: 'inc',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'y',
        type: 'uint256'
      }
    ],
    name: 'incBy',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'x',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

export function useCounterContract(
  contractAddress: Address,
  rpcClient: PublicClient,
  enableWalletToken?: (params: {
    walletAddress: `0x${string}`;
    contractAddress: `0x${string}`;
    nonce: number;
    calldata: `0x${string}`;
  }) => Promise<{ message: string; activeUntil: string }>,
  _browserWallet?: {
    walletClient?: unknown;
    address?: Address | null;
  }
) {
  const contract = getContract({
    address: contractAddress,
    abi: counterAbi,
    client: rpcClient
  });

  // Read functions
  const getValue = async (): Promise<bigint> => {
    const { savedAccount } = loadExistingPasskey();
    if (!savedAccount) {
      throw new Error('No linked wallet found. Please link a passkey account first.');
    }
    return await contract.read.x({ account: savedAccount });
  };

  // Internal helper for defensive checks (matching React)
  const buildGasOptions = () => {
    const callGasLimit = 500000n;
    const verificationGasLimit = 2000000n;
    const maxFeePerGas = 10000000000n;
    const maxPriorityFeePerGas = 5000000000n;
    const preVerificationGas = 200000n;

    const accountGasLimits = pad(toHex((verificationGasLimit << 128n) | callGasLimit), {
      size: 32
    });
    const gasFees = pad(toHex((maxPriorityFeePerGas << 128n) | maxFeePerGas), { size: 32 });

    return {
      gasFees,
      accountGasLimits,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
      maxPriorityFeePerGas
    };
  };

  const sendWithPasskey = async (data: `0x${string}`) => {
    const { savedPasskey, savedAccount } = loadExistingPasskey();
    if (!savedPasskey || !savedAccount) {
      throw new Error('No SSO account found. Create and link a passkey first.');
    }

    const txData = [
      {
        to: contractAddress,
        value: 0n,
        data
      }
    ];

    const gasOptions = buildGasOptions();
    return await sendTxWithPasskey(
      savedAccount,
      savedPasskey,
      txData,
      gasOptions,
      rpcClient,
      enableWalletToken
    );
  };

  // Write functions
  const increment = async () => {
    const data = encodeFunctionData({
      abi: counterAbi,
      functionName: 'inc',
      args: []
    });
    return await sendWithPasskey(data);
  };

  const incrementBy = async (amount: bigint) => {
    const data = encodeFunctionData({
      abi: counterAbi,
      functionName: 'incBy',
      args: [amount]
    });
    return await sendWithPasskey(data);
  };

  return {
    contract,
    getValue,
    increment,
    incrementBy
  };
}
