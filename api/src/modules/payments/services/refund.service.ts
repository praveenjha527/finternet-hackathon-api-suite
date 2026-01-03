import { Injectable, Logger } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from './audit.service';

export interface RefundRequest {
  paymentIntentId: string;
  merchantId: string;
  amount: string;
  currency: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

/**
 * Refund Service
 * Handles refunds for payment intents.
 * 
 * Note: For mock/hackathon purposes, refunds are processed immediately.
 * In production, refunds might need queue-based processing if they involve:
 * - External payment processor API calls
 * - Complex reversal logic
 * - Batch refund processing
 * - Integration with banking APIs
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Process a refund for a payment intent.
   * 
   * Queue-based processing considerations:
   * - If refunds involve external API calls (payment processors, banks), use queue
   * - If refunds need batching or rate limiting, use queue
   * - For simple mock refunds (like this), synchronous is fine
   * 
   * For production: Consider moving to queue if:
   * - Refund API calls are slow/unreliable
   * - Need to handle high volume
   * - Need retry logic with exponential backoff
   */
  async processRefund(request: RefundRequest): Promise<RefundResult> {
    const { paymentIntentId, merchantId, amount, currency, reason, metadata } = request;

    this.logger.log(`Processing refund: ${amount} ${currency} for payment ${paymentIntentId}`);

    try {
      // Get payment intent to verify it exists and is refundable
      const intent = await this.prisma.paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });

      if (!intent) {
        return {
          success: false,
          error: `Payment intent not found: ${paymentIntentId}`,
        };
      }

      // Check if payment was successful (can only refund successful payments)
      if (intent.status !== 'SUCCEEDED' && intent.status !== 'SETTLED') {
        return {
          success: false,
          error: `Cannot refund payment with status: ${intent.status}. Only SUCCEEDED or SETTLED payments can be refunded.`,
        };
      }

      // Check if refund amount doesn't exceed payment amount
      const paymentAmount = parseFloat(intent.amount);
      const refundAmount = parseFloat(amount);
      if (refundAmount > paymentAmount) {
        return {
          success: false,
          error: `Refund amount ${amount} exceeds payment amount ${intent.amount}`,
        };
      }

      // Generate refund ID
      const refundId = `refund_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Record refund in ledger (debits merchant account)
      await this.ledger.recordRefund(merchantId, amount, {
        paymentIntentId,
        refundId,
        description: reason ? `Refund: ${reason}` : `Refund for payment ${paymentIntentId}`,
        metadata: {
          currency,
          originalPaymentAmount: intent.amount,
          ...metadata,
        },
      });

      // Log refund in audit trail
      // Note: You might want to add a specific audit log method for refunds
      // For now, we'll log it as a status change or add to metadata

      this.logger.log(`Refund processed successfully: ${refundId} for ${amount} ${currency}`);

      return {
        success: true,
        refundId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Refund processing failed';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Refund failed: ${errorMessage}`, errorStack);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if a payment intent can be refunded.
   */
  async canRefund(paymentIntentId: string, merchantId: string): Promise<{
    canRefund: boolean;
    reason?: string;
  }> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
    });

    if (!intent) {
      return { canRefund: false, reason: 'Payment intent not found' };
    }

    if ((intent as any).merchantId !== merchantId) {
      return { canRefund: false, reason: 'Payment intent does not belong to merchant' };
    }

    if (intent.status !== 'SUCCEEDED' && intent.status !== 'SETTLED') {
      return {
        canRefund: false,
        reason: `Payment status ${intent.status} does not allow refunds`,
      };
    }

    return { canRefund: true };
  }
}

