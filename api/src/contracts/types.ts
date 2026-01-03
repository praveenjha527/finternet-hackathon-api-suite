import DvpArtifact from "./artifacts/DVPEscrowWithSettlement.json";
import ConsentedPullArtifact from "./artifacts/ConsentedPull.json";

// The JSON file is the ABI array directly
export const DVPEscrowWithSettlementAbi = DvpArtifact as any;
export const ConsentedPullAbi = ConsentedPullArtifact.abi;

// Type definitions for DVPEscrowWithSettlement contract
export type DvpEscrowContract = {
  createOrder: (
    merchantId: bigint,
    orderId: bigint,
    buyer: string,
    token: string,
    amount: bigint,
    deliveryPeriod: number,
    expectedDeliveryHash: string,
    autoRelease: boolean,
    deliveryOracle: string,
  ) => Promise<{ hash: string }>;
  
  submitDeliveryProof: (
    orderId: bigint,
    proofHash: string,
    proofURI: string,
    v: number,
    r: string,
    s: string,
  ) => Promise<{ hash: string }>;
  
  executeSettlement: (
    orderId: bigint,
    offrampDestination: string,
    offrampData: string,
  ) => Promise<{ hash: string }>;
  
  markShipped: (orderId: bigint) => Promise<{ hash: string }>;
  
  confirmDelivery: (orderId: bigint) => Promise<{ hash: string }>;
  
  getOrder: (orderId: bigint) => Promise<{
    orderId: bigint;
    merchantId: bigint;
    merchant: string;
    buyer: string;
    token: string;
    amount: bigint;
    createdAt: bigint;
    deliveryDeadline: bigint;
    releasedAt: bigint;
    settlementScheduledAt: bigint;
    deliveryProofHash: string;
    actualDeliveryHash: string;
    status: number; // OrderStatus enum
    settlementStatus: number; // SettlementStatus enum
    feeRate: bigint;
    autoReleaseOnProof: boolean;
    deliveryOracle: string;
  }>;
  
  getDeliveryProof: (orderId: bigint) => Promise<{
    proofHash: string;
    submittedAt: bigint;
    submittedBy: string;
    proofURI: string;
  }>;
  
  getSettlement: (orderId: bigint) => Promise<{
    orderId: bigint;
    merchant: string;
    amount: bigint;
    executedAt: bigint;
    executedBy: string;
    txHash: string;
    status: number; // SettlementStatus enum
  }>;
};

// Legacy type for backward compatibility (deprecated)
export type DvpContract = {
  initiateDvP: (
    intentId: string,
    payer: string,
    payee: string,
    amount: bigint,
  ) => Promise<{ hash: string }>;
};
