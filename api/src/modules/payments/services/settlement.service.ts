import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerService } from './ledger.service';
import { FiatAccountService } from './fiat-account.service';

export interface OffRampSettlementResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  settlementDetails?: {
    method: string;
    destination: string;
    amount: string;
    currency: string;
    estimatedArrival?: string;
    fees?: string;
  };
}

/**
 * Settlement Service
 * Handles off-ramp settlement to merchant fiat accounts.
 * The actual fiat/bank gateway integration is mocked, but the ledger is real.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly ledgerService: LedgerService,
    private readonly fiatAccountService: FiatAccountService,
  ) {}

  /**
   * Process off-ramp mock settlement
   * Mocks the actual bank/fiat gateway but uses real ledger
   */
  async processOffRampMock(
    merchantId: string,
    settlementDestination: string,
    amount: string,
    currency: string = 'USD',
    options?: {
      paymentIntentId?: string;
      settlementMethod?: string;
    },
  ): Promise<OffRampSettlementResult> {
    const settlementMethod =
      options?.settlementMethod || this.detectSettlementMethod(settlementDestination);
    const delay = this.configService.get<number>('OFF_RAMP_MOCK_DELAY', 10000);

    this.logger.log(
      `Processing mock off-ramp settlement: ${amount} ${currency} to ${settlementDestination} via ${settlementMethod}`,
    );

    try {
      // Get account details for settlement info
      const account = await this.fiatAccountService.getOrCreateAccount(merchantId);

      // Simulate processing delay (mocking bank gateway processing time)
      await this.delay(delay);

      // Generate mock settlement transaction ID
      const settlementTxId = this.generateSettlementTxId(settlementMethod);

      // Record settlement in ledger (real ledger, mocked bank gateway)
      await this.ledgerService.recordSettlement(merchantId, amount, {
        paymentIntentId: options?.paymentIntentId,
        settlementMethod,
        settlementDestination,
        settlementTxId,
        description: `Off-ramp settlement via ${settlementMethod}`,
        metadata: {
          mock: true,
          currency,
          processedAt: new Date().toISOString(),
          accountNumber: account.accountNumber,
          routingNumber: account.routingNumber,
          bankName: account.bankName,
        },
      });

      // Calculate fees (mocked)
      const fees = this.calculateFees(amount, settlementMethod);

      // Calculate estimated arrival (mocked, but realistic)
      const estimatedArrival = this.calculateEstimatedArrival(settlementMethod);

      this.logger.log(
        `Mock settlement completed: ${settlementTxId} for ${amount} ${currency}`,
      );

      return {
        success: true,
        transactionId: settlementTxId,
        settlementDetails: {
          method: settlementMethod,
          destination: settlementDestination,
          amount,
          currency,
          estimatedArrival,
          fees: fees.toString(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Settlement processing failed';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Settlement failed: ${errorMessage}`, errorStack);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Detect settlement method based on destination
   */
  private detectSettlementMethod(destination: string): string {
    // Simple detection based on format
    if (destination.startsWith('0x')) {
      return 'crypto_wallet';
    }
    if (destination.match(/^[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}$/)) {
      return 'sepa'; // IBAN format
    }
    if (destination.match(/^\d{9}$/)) {
      return 'ach'; // US routing number or account number
    }
    if (destination.match(/^[A-Z]{2}\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}$/)) {
      return 'wire_transfer';
    }
    return 'wire_transfer'; // Default
  }

  /**
   * Generate mock settlement transaction ID
   */
  private generateSettlementTxId(method: string): string {
    const prefix = method.toUpperCase().replace('_', '');
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Calculate fees (mocked but realistic)
   */
  private calculateFees(amount: string, method: string): string {
    const amountNum = parseFloat(amount);
    let fee = 0;

    switch (method) {
      case 'wire_transfer':
        fee = Math.max(25, amountNum * 0.001); // $25 or 0.1%
        break;
      case 'ach':
        fee = Math.max(1, amountNum * 0.0005); // $1 or 0.05%
        break;
      case 'sepa':
        fee = Math.max(5, amountNum * 0.001); // €5 or 0.1%
        break;
      case 'crypto_wallet':
        fee = Math.max(5, amountNum * 0.002); // $5 or 0.2%
        break;
      default:
        fee = amountNum * 0.001; // 0.1% default
    }

    return fee.toFixed(2);
  }

  /**
   * Calculate estimated arrival time (mocked but realistic)
   */
  private calculateEstimatedArrival(method: string): string {
    const now = new Date();
    let hours = 0;

    switch (method) {
      case 'wire_transfer':
        hours = 1; // Same day or next business day
        break;
      case 'ach':
        hours = 24; // 1-2 business days
        break;
      case 'sepa':
        hours = 24; // 1 business day
        break;
      case 'crypto_wallet':
        hours = 0.5; // Near-instant
        break;
      default:
        hours = 24;
    }

    const arrival = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return arrival.toISOString();
  }

  /**
   * Delay utility for mock processing
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
