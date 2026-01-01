import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PaymentIntentEvent,
  PaymentIntentEventType,
  PaymentIntentCreatedEvent,
  BlockchainTxSubmittedEvent,
  BlockchainTxConfirmedEvent,
  SettlementInitiatedEvent,
  SettlementCompletedEvent,
  StatusChangedEvent,
} from '../events/payment-intent.events';
import { PaymentIntentStatus, SettlementStatus } from '../entities/payment-intent.entity';

/**
 * Service for emitting payment intent events.
 * Centralizes event emission logic.
 */
@Injectable()
export class PaymentEventService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Emit a payment intent event
   */
  async emit(event: PaymentIntentEvent): Promise<void> {
    this.eventEmitter.emit(event.type, event);
  }

  /**
   * Emit payment intent created event
   */
  async emitCreated(payload: {
    paymentIntentId: string;
    merchantId: string;
    status: PaymentIntentStatus;
    amount: string;
    currency: string;
    settlementMethod: string;
    settlementDestination: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const event: PaymentIntentCreatedEvent = {
      type: PaymentIntentEventType.CREATED,
      paymentIntentId: payload.paymentIntentId,
      merchantId: payload.merchantId,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      settlementMethod: payload.settlementMethod,
      settlementDestination: payload.settlementDestination,
      timestamp: new Date(),
      metadata: payload.metadata,
    };
    await this.emit(event);
  }

  /**
   * Emit blockchain transaction submitted event
   */
  async emitBlockchainTxSubmitted(payload: {
    paymentIntentId: string;
    merchantId: string;
    status: PaymentIntentStatus;
    amount: string;
    currency: string;
    transactionHash: string;
    contractAddress: string;
    chainId: number;
    payerAddress: string;
  }): Promise<void> {
    const event: BlockchainTxSubmittedEvent = {
      type: PaymentIntentEventType.BLOCKCHAIN_TX_SUBMITTED,
      paymentIntentId: payload.paymentIntentId,
      merchantId: payload.merchantId,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      transactionHash: payload.transactionHash,
      contractAddress: payload.contractAddress,
      chainId: payload.chainId,
      payerAddress: payload.payerAddress,
      timestamp: new Date(),
    };
    await this.emit(event);
  }

  /**
   * Emit blockchain transaction confirmed event
   */
  async emitBlockchainTxConfirmed(payload: {
    paymentIntentId: string;
    merchantId: string;
    status: PaymentIntentStatus;
    amount: string;
    currency: string;
    transactionHash: string;
    blockNumber?: bigint;
    blockTimestamp?: Date;
  }): Promise<void> {
    const event: BlockchainTxConfirmedEvent = {
      type: PaymentIntentEventType.BLOCKCHAIN_TX_CONFIRMED,
      paymentIntentId: payload.paymentIntentId,
      merchantId: payload.merchantId,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      transactionHash: payload.transactionHash,
      blockNumber: payload.blockNumber,
      blockTimestamp: payload.blockTimestamp,
      timestamp: new Date(),
    };
    await this.emit(event);
  }

  /**
   * Emit settlement initiated event
   */
  async emitSettlementInitiated(payload: {
    paymentIntentId: string;
    merchantId: string;
    status: PaymentIntentStatus;
    amount: string;
    currency: string;
    settlementMethod: string;
    settlementDestination: string;
    settlementStatus: SettlementStatus;
  }): Promise<void> {
    const event: SettlementInitiatedEvent = {
      type: PaymentIntentEventType.SETTLEMENT_INITIATED,
      paymentIntentId: payload.paymentIntentId,
      merchantId: payload.merchantId,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      settlementMethod: payload.settlementMethod,
      settlementDestination: payload.settlementDestination,
      settlementStatus: payload.settlementStatus,
      timestamp: new Date(),
    };
    await this.emit(event);
  }

  /**
   * Emit settlement completed event
   */
  async emitSettlementCompleted(payload: {
    paymentIntentId: string;
    merchantId: string;
    status: PaymentIntentStatus;
    amount: string;
    currency: string;
    settlementMethod: string;
    settlementDestination: string;
    settlementTxId: string;
    settlementStatus: SettlementStatus;
  }): Promise<void> {
    const event: SettlementCompletedEvent = {
      type: PaymentIntentEventType.SETTLEMENT_COMPLETED,
      paymentIntentId: payload.paymentIntentId,
      merchantId: payload.merchantId,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      settlementMethod: payload.settlementMethod,
      settlementDestination: payload.settlementDestination,
      settlementTxId: payload.settlementTxId,
      settlementStatus: payload.settlementStatus,
      timestamp: new Date(),
    };
    await this.emit(event);
  }

  /**
   * Emit status changed event
   */
  async emitStatusChanged(payload: {
    paymentIntentId: string;
    merchantId: string;
    fromStatus: PaymentIntentStatus;
    toStatus: PaymentIntentStatus;
    amount: string;
    currency: string;
    reason?: string;
  }): Promise<void> {
    const event: StatusChangedEvent = {
      type: PaymentIntentEventType.STATUS_CHANGED,
      paymentIntentId: payload.paymentIntentId,
      merchantId: payload.merchantId,
      status: payload.toStatus,
      amount: payload.amount,
      currency: payload.currency,
      fromStatus: payload.fromStatus,
      toStatus: payload.toStatus,
      reason: payload.reason,
      timestamp: new Date(),
    };
    await this.emit(event);
  }
}

