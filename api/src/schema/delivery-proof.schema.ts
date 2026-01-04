/**
 * EIP-712 Schema for Delivery Proof Submission
 * 
 * This schema is used to sign delivery proof data for the escrow contract.
 * 
 * Note: The contract expects: DeliveryProof(uint256 orderId,bytes32 deliveryHash,uint256 timestamp,uint256 nonce)
 * The proofURI is passed as a function parameter, not part of the signature.
 */

export type DeliveryProofTypedData = {
  types: Record<string, Array<{ name: string; type: string }>>;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  message: {
    orderId: string;
    deliveryHash: string;
    timestamp: string;
    nonce: string;
  };
};

/**
 * Build EIP-712 typed data for Delivery Proof submission signature.
 * 
 * @param params - Delivery proof parameters
 * @returns EIP-712 typed data structure
 */
export function buildDeliveryProofTypedData(params: {
  orderId: bigint | string | number;
  deliveryHash: string; // bytes32 - the proof hash
  timestamp: bigint | string | number; // Unix timestamp (should match block.timestamp when tx is mined)
  nonce: bigint | string | number; // Current nonce for this orderId
  chainId: number;
  verifyingContract: string;
}): DeliveryProofTypedData {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      DeliveryProof: [
        { name: "orderId", type: "uint256" },
        { name: "deliveryHash", type: "bytes32" },
        { name: "timestamp", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    },
    domain: {
      name: "DVPEscrow",
      version: "1",
      chainId: params.chainId,
      verifyingContract: params.verifyingContract,
    },
    message: {
      orderId: params.orderId.toString(),
      deliveryHash: params.deliveryHash,
      timestamp: params.timestamp.toString(),
      nonce: params.nonce.toString(),
    },
  };
}

