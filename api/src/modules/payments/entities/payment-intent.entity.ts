export enum PaymentIntentStatus {
  INITIATED = 'INITIATED',
  REQUIRES_SIGNATURE = 'REQUIRES_SIGNATURE',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  SETTLED = 'SETTLED',
  FINAL = 'FINAL',
  CANCELED = 'CANCELED',
  REQUIRES_ACTION = 'REQUIRES_ACTION',
}

export enum SettlementStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export type IntentPhaseName =
  | 'SIGNATURE_VERIFICATION'
  | 'ESCROW_LOCKED'
  | 'AWAITING_DELIVERY_PROOF'
  | 'BLOCKCHAIN_CONFIRMATION'
  | 'SETTLEMENT';

export type IntentPhaseStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export type PaymentIntentPhase = {
  phase: IntentPhaseName;
  status: IntentPhaseStatus;
  timestamp?: number;
};

export type PaymentIntentEntity = {
  id: string;
  object: 'payment_intent';
  status: PaymentIntentStatus;

  amount: string;
  currency: string;
  type: string;
  description?: string | null;

  settlementMethod: string;
  settlementDestination: string;
  settlementStatus?: SettlementStatus | null;

  contractAddress?: string | null;
  transactionHash?: string | null;
  chainId?: number | null;

  typedData?: unknown | null;
  signature?: string | null;
  signerAddress?: string | null;

  // Estimates (week-1 mock)
  estimatedFee?: string;
  estimatedDeliveryTime?: string;

  phases?: PaymentIntentPhase[] | null;
  metadata?: Record<string, unknown> | null;

  created: number;
  updated: number;
};


