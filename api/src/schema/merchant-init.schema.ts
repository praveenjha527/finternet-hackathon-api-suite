/**
 * EIP-712 Schema for Merchant Initialization
 * 
 * This schema is used to sign merchant initialization data for the escrow contract.
 */

export type MerchantInitTypedData = {
  types: Record<string, Array<{ name: string; type: string }>>;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  message: {
    merchantId: string;
    merchantAddress: string;
    nonce: string;
    signatureDeadline: string;
  };
};

/**
 * Build EIP-712 typed data for Merchant Initialization signature.
 * 
 * @param params - Merchant initialization parameters
 * @returns EIP-712 typed data structure
 */
export function buildMerchantInitTypedData(params: {
  merchantId: bigint | string | number;
  merchantAddress: string;
  nonce: bigint | string | number;
  signatureDeadline: bigint | string | number;
  chainId: number;
  verifyingContract: string;
}): MerchantInitTypedData {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      MerchantInit: [
        { name: "merchantId", type: "uint256" },
        { name: "merchantAddress", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "signatureDeadline", type: "uint256" },
      ],
    },
    domain: {
      name: "DVPEscrow",
      version: "1",
      chainId: params.chainId,
      verifyingContract: params.verifyingContract,
    },
    message: {
      merchantId: params.merchantId.toString(),
      merchantAddress: params.merchantAddress,
      nonce: params.nonce.toString(),
      signatureDeadline: params.signatureDeadline.toString(),
    },
  };
}

