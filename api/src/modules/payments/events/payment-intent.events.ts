import { PaymentIntentStatus, SettlementStatus } from '../entities/payment-intent.entity';

/**
 * Payment Intent Event Types
 */
export enum PaymentIntentEventType {
  CREATED = 'payment_intent.created',
  SIGNATURE_REQUIRED = 'payment_intent.signature_required',
  SIGNATURE_VERIFIED = 'payment_intent.signature_verified',
  BLOCKCHAIN_TX_SUBMITTED = 'payment_intent.blockchain_tx_submitted',
  BLOCKCHAIN_TX_CONFIRMED = 'payment_intent.blockchain_tx_confirmed',
  PROCESSING = 'payment_intent.processing',
  SUCCEEDED = 'payment_intent.succeeded',
  SETTLEMENT_INITIATED = 'payment_intent.settlement_initiated',
  SETTLEMENT_COMPLETED = 'payment_intent.settlement_completed',
  SETTLEMENT_FAILED = 'payment_intent.settlement_failed',
  SETTLED = 'payment_intent.settled',
  CANCELED = 'payment_intent.canceled',
  FAILED = 'payment_intent.failed',
  STATUS_CHANGED = 'payment_intent.status_changed',
}

/**
 * Base event payload for all payment intent events
 */
export interface PaymentIntentEventPayload {
  paymentIntentId: string;
  merchantId: string;
  status: PaymentIntentStatus;
  amount: string;
  currency: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Payment Intent Created Event
 */
export interface PaymentIntentCreatedEvent extends PaymentIntentEventPayload {
  type: PaymentIntentEventType.CREATED;
  settlementMethod: string;
  settlementDestination: string;
}

/**
 * Blockchain Transaction Submitted Event
 */
export interface BlockchainTxSubmittedEvent extends PaymentIntentEventPayload {
  type: PaymentIntentEventType.BLOCKCHAIN_TX_SUBMITTED;
  transactionHash: string;
  contractAddress: string;
  chainId: number;
  payerAddress: string;
}

/**
 * Blockchain Transaction Confirmed Event
 */
export interface BlockchainTxConfirmedEvent extends PaymentIntentEventPayload {
  type: PaymentIntentEventType.BLOCKCHAIN_TX_CONFIRMED;
  transactionHash: string;
  blockNumber?: bigint;
  blockTimestamp?: Date;
}

/**
 * Settlement Initiated Event
 */
export interface SettlementInitiatedEvent extends PaymentIntentEventPayload {
  type: PaymentIntentEventType.SETTLEMENT_INITIATED;
  settlementMethod: string;
  settlementDestination: string;
  settlementStatus: SettlementStatus;
}

/**
 * Settlement Completed Event
 */
export interface SettlementCompletedEvent extends PaymentIntentEventPayload {
  type: PaymentIntentEventType.SETTLEMENT_COMPLETED;
  settlementMethod: string;
  settlementDestination: string;
  settlementTxId: string;
  settlementStatus: SettlementStatus;
}

/**
 * Status Changed Event
 */
export interface StatusChangedEvent extends PaymentIntentEventPayload {
  type: PaymentIntentEventType.STATUS_CHANGED;
  fromStatus: PaymentIntentStatus;
  toStatus: PaymentIntentStatus;
  reason?: string;
}

/**
 * Union type for all payment intent events
 */
export type PaymentIntentEvent =
  | PaymentIntentCreatedEvent
  | BlockchainTxSubmittedEvent
  | BlockchainTxConfirmedEvent
  | SettlementInitiatedEvent
  | SettlementCompletedEvent
  | StatusChangedEvent;

