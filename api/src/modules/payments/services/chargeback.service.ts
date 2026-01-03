import { Injectable, Logger } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from './audit.service';

export interface ChargebackRequest {
  paymentIntentId: string;
  merchantId: string;
  amount: string;
  currency: string;
  disputeReason: string;
  chargebackId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChargebackResult {
  success: boolean;
  chargebackId?: string;
  error?: string;
}

/**
 * Chargeback Service
 * Handles chargebacks/disputes for payment intents.
 * 
 * Queue-based processing considerations:
 * - Chargebacks typically come from external systems (card networks, banks) via webhooks
 * - Processing might involve: notification emails, merchant alerts, dispute management
 * - For high-volume systems, queue-based processing is recommended
 * - For mock/hackathon: synchronous is fine, but structure allows easy migration to queue
 * 
 * Production recommendation: Use queue if:
 * - Processing involves multiple external systems
 * - Need to send notifications/alerts asynchronously
 * - Need to batch process multiple chargebacks
 * - Integration with dispute management systems
 */
@Injectable()
export class ChargebackService {
  private readonly logger = new Logger(ChargebackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Process a chargeback/dispute for a payment intent.
   * 
   * In production, this might be triggered by:
   * - Webhook from card network (Stripe, Visa, Mastercard)
   * - Webhook from bank
   * - Manual dispute creation by support team
   * - Automated fraud detection system
   */
  async processChargeback(request: ChargebackRequest): Promise<ChargebackResult> {
    const {
      paymentIntentId,
      merchantId,
      amount,
      currency,
      disputeReason,
      chargebackId,
      metadata,
    } = request;

    this.logger.log(
      `Processing chargeback: ${amount} ${currency} for payment ${paymentIntentId}, reason: ${disputeReason}`,
    );

    try {
      // Get payment intent to verify it exists
      const intent = await this.prisma.paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });

      if (!intent) {
        return {
          success: false,
          error: `Payment intent not found: ${paymentIntentId}`,
        };
      }

      // Check if payment was successful (chargebacks only apply to successful payments)
      if (intent.status !== 'SUCCEEDED' && intent.status !== 'SETTLED') {
        return {
          success: false,
          error: `Cannot chargeback payment with status: ${intent.status}. Only SUCCEEDED or SETTLED payments can have chargebacks.`,
        };
      }

      // Generate chargeback ID if not provided
      const finalChargebackId =
        chargebackId || `chargeback_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Record chargeback in ledger (debits merchant account)
      await this.ledger.recordChargeback(merchantId, amount, {
        paymentIntentId,
        chargebackId: finalChargebackId,
        disputeReason,
        description: `Chargeback: ${disputeReason}`,
        metadata: {
          currency,
          originalPaymentAmount: intent.amount,
          ...metadata,
        },
      });

      // Log chargeback in audit trail
      // In production, you might want to:
      // - Send notification to merchant
      // - Create dispute record
      // - Trigger compliance review
      // - Update fraud risk score

      this.logger.log(
        `Chargeback processed successfully: ${finalChargebackId} for ${amount} ${currency}`,
      );

      return {
        success: true,
        chargebackId: finalChargebackId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Chargeback processing failed';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Chargeback failed: ${errorMessage}`, errorStack);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

