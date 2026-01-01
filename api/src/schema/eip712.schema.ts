import { id, parseUnits } from 'ethers';

export type PaymentIntentTypedData = {
  types: Record<string, Array<{ name: string; type: string }>>;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  message: {
    intentId: string;
    amount: string;
    nonce: number;
  };
};

/**
 * Build EIP-712 typed data for a PaymentIntent signature.
 *
 * Notes:
 * - `intentId` is hashed to bytes32 in the message (client can sign this exact typedData).
 * - `amount` is converted to uint256 using `parseUnits(..., decimals)`.
 */
export function buildPaymentIntentTypedData(params: {
  intentId: string;
  amount: string;
  decimals: number;
  chainId: number;
  verifyingContract: string;
  nonce?: number;
}): PaymentIntentTypedData {
  const nonce = params.nonce ?? 0;

  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      PaymentIntent: [
        { name: 'intentId', type: 'bytes32' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    domain: {
      name: 'Finternet Payment Gateway',
      version: '1',
      chainId: params.chainId,
      verifyingContract: params.verifyingContract,
    },
    message: {
      intentId: id(params.intentId),
      amount: parseUnits(params.amount, params.decimals).toString(),
      nonce,
    },
  };
}


