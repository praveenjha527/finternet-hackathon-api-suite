import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PaymentIntentEventType,
  PaymentIntentEvent,
  PaymentIntentCreatedEvent,
  BlockchainTxSubmittedEvent,
  BlockchainTxConfirmedEvent,
  SettlementInitiatedEvent,
  SettlementCompletedEvent,
  StatusChangedEvent,
} from '../events/payment-intent.events';
import { AuditService } from '../services/audit.service';

/**
 * Event listener for payment intent events.
 * Handles side effects and integrations when payment events occur.
 */
@Injectable()
export class PaymentIntentEventListener {
  private readonly logger = new Logger(PaymentIntentEventListener.name);

  constructor(private readonly audit: AuditService) {}

  @OnEvent(PaymentIntentEventType.CREATED)
  async handleCreated(event: PaymentIntentCreatedEvent) {
    this.logger.log(`Payment intent created: ${event.paymentIntentId}`);
    // Additional side effects can be added here (e.g., webhooks, notifications)
  }

  @OnEvent(PaymentIntentEventType.BLOCKCHAIN_TX_SUBMITTED)
  async handleBlockchainTxSubmitted(event: BlockchainTxSubmittedEvent) {
    this.logger.log(`Blockchain transaction submitted: ${event.transactionHash} for intent ${event.paymentIntentId}`);
    // Additional side effects can be added here
  }

  @OnEvent(PaymentIntentEventType.BLOCKCHAIN_TX_CONFIRMED)
  async handleBlockchainTxConfirmed(event: BlockchainTxConfirmedEvent) {
    this.logger.log(`Blockchain transaction confirmed: ${event.transactionHash} for intent ${event.paymentIntentId}`);
    // Additional side effects can be added here (e.g., trigger settlement)
  }

  @OnEvent(PaymentIntentEventType.SETTLEMENT_INITIATED)
  async handleSettlementInitiated(event: SettlementInitiatedEvent) {
    this.logger.log(`Settlement initiated for intent ${event.paymentIntentId}`);
    // Additional side effects can be added here
  }

  @OnEvent(PaymentIntentEventType.SETTLEMENT_COMPLETED)
  async handleSettlementCompleted(event: SettlementCompletedEvent) {
    this.logger.log(`Settlement completed for intent ${event.paymentIntentId} with tx ${event.settlementTxId}`);
    // Additional side effects can be added here (e.g., webhooks, notifications)
  }

  @OnEvent(PaymentIntentEventType.SETTLED)
  async handleSettled(event: PaymentIntentEvent) {
    this.logger.log(`Payment intent settled: ${event.paymentIntentId}`);
    // Additional side effects can be added here (e.g., final notifications)
  }

  @OnEvent(PaymentIntentEventType.STATUS_CHANGED)
  async handleStatusChanged(event: StatusChangedEvent) {
    this.logger.log(
      `Payment intent status changed: ${event.paymentIntentId} from ${event.fromStatus} to ${event.toStatus}`,
    );
    // Additional side effects can be added here
  }
}

