import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { FiatAccountService } from './fiat-account.service';

export interface CreateLedgerEntryDto {
  merchantId: string;
  paymentIntentId?: string;
  transactionType: 'CREDIT' | 'DEBIT' | 'SETTLEMENT' | 'RESERVE' | 'RELEASE' | 'REFUND' | 'CHARGEBACK' | 'FEE';
  amount: string;
  currency?: string;
  description?: string;
  settlementMethod?: string;
  settlementDestination?: string;
  settlementTxId?: string;
  status?: 'COMPLETED' | 'PENDING' | 'FAILED';
  metadata?: Record<string, unknown>;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fiatAccountService: FiatAccountService,
  ) {}

  /**
   * Create a ledger entry and update account balance
   */
  async createEntry(dto: CreateLedgerEntryDto): Promise<LedgerEntry> {
    // Get or create fiat account
    const account = await this.fiatAccountService.getOrCreateAccount(
      dto.merchantId,
    );

    const amount = new Decimal(dto.amount);
    const currentAvailable = new Decimal(account.availableBalance);
    const currentPending = new Decimal(account.pendingBalance);
    const currentReserved = new Decimal(account.reservedBalance);

    let newAvailable = currentAvailable;
    let newPending = currentPending;
    let newReserved = currentReserved;
    let balanceBefore = currentAvailable;
    let balanceAfter = currentAvailable;

    // Calculate new balances based on transaction type
    switch (dto.transactionType) {
      case 'CREDIT':
        // Credit increases available balance
        newAvailable = currentAvailable.plus(amount);
        balanceBefore = currentAvailable;
        balanceAfter = newAvailable;
        break;

      case 'DEBIT':
        // Debit decreases available balance
        newAvailable = currentAvailable.minus(amount);
        balanceBefore = currentAvailable;
        balanceAfter = newAvailable;
        break;

      case 'SETTLEMENT':
        // Settlement debits from available balance (funds sent out)
        // Note: RESERVE should be called first to move funds to reserved
        // Then SETTLEMENT moves from reserved to zero (funds sent out)
        newAvailable = currentAvailable.minus(amount);
        balanceBefore = currentAvailable;
        balanceAfter = newAvailable;
        break;

      case 'RESERVE':
        // Reserve moves from available to reserved
        newAvailable = currentAvailable.minus(amount);
        newReserved = currentReserved.plus(amount);
        balanceBefore = currentAvailable;
        balanceAfter = newAvailable;
        break;

      case 'RELEASE':
        // Release moves from reserved back to available
        newReserved = currentReserved.minus(amount);
        newAvailable = currentAvailable.plus(amount);
        balanceBefore = currentReserved;
        balanceAfter = newReserved;
        break;

      case 'REFUND':
        // Refund decreases available balance (merchant refunds customer)
        newAvailable = currentAvailable.minus(amount);
        balanceBefore = currentAvailable;
        balanceAfter = newAvailable;
        break;

      case 'CHARGEBACK':
        // Chargeback decreases available balance (merchant loses money)
        newAvailable = currentAvailable.minus(amount);
        balanceBefore = currentAvailable;
        balanceAfter = newAvailable;
        break;

      case 'FEE':
        // Fee decreases available balance (platform fee)
        newAvailable = currentAvailable.minus(amount);
        balanceBefore = currentAvailable;
        balanceAfter = newAvailable;
        break;
    }

    // Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Update account balance
      await tx.merchantFiatAccount.update({
        where: { id: account.id },
        data: {
          availableBalance: newAvailable.toString(),
          pendingBalance: newPending.toString(),
          reservedBalance: newReserved.toString(),
        },
      });

      // Create ledger entry
      const entry = await tx.ledgerEntry.create({
        data: {
          fiatAccountId: account.id,
          paymentIntentId: dto.paymentIntentId,
          transactionType: dto.transactionType,
          amount: dto.amount,
          currency: dto.currency || account.currency,
          balanceBefore: balanceBefore.toString(),
          balanceAfter: balanceAfter.toString(),
          description: dto.description,
          settlementMethod: dto.settlementMethod,
          settlementDestination: dto.settlementDestination,
          settlementTxId: dto.settlementTxId,
          status: dto.status || 'COMPLETED',
          metadata: dto.metadata ? (dto.metadata as any) : null,
        },
      });

      return entry;
    });

    return result;
  }

  /**
   * Credit funds to merchant account (e.g., from on-chain payment settlement)
   */
  async credit(
    merchantId: string,
    amount: string,
    options?: {
      paymentIntentId?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<LedgerEntry> {
    return this.createEntry({
      merchantId,
      paymentIntentId: options?.paymentIntentId,
      transactionType: 'CREDIT',
      amount,
      description: options?.description || 'Credit to account',
      status: 'COMPLETED',
      metadata: options?.metadata,
    });
  }

  /**
   * Debit funds from merchant account
   */
  async debit(
    merchantId: string,
    amount: string,
    options?: {
      paymentIntentId?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{
    id: string;
    fiatAccountId: string;
    paymentIntentId: string | null;
    transactionType: string;
    amount: string;
    currency: string;
    balanceBefore: string;
    balanceAfter: string;
    description: string | null;
    settlementMethod: string | null;
    settlementDestination: string | null;
    settlementTxId: string | null;
    status: string;
    metadata: unknown;
    createdAt: Date;
  }> {
    return this.createEntry({
      merchantId,
      paymentIntentId: options?.paymentIntentId,
      transactionType: 'DEBIT',
      amount,
      description: options?.description || 'Debit from account',
      status: 'COMPLETED',
      metadata: options?.metadata,
    });
  }

  /**
   * Record settlement transaction (off-ramp)
   */
  async recordSettlement(
    merchantId: string,
    amount: string,
    options: {
      paymentIntentId?: string;
      settlementMethod: string;
      settlementDestination: string;
      settlementTxId: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{
    id: string;
    fiatAccountId: string;
    paymentIntentId: string | null;
    transactionType: string;
    amount: string;
    currency: string;
    balanceBefore: string;
    balanceAfter: string;
    description: string | null;
    settlementMethod: string | null;
    settlementDestination: string | null;
    settlementTxId: string | null;
    status: string;
    metadata: unknown;
    createdAt: Date;
  }> {
    // First, move funds from available to pending (reserve for settlement)
    await this.createEntry({
      merchantId,
      paymentIntentId: options.paymentIntentId,
      transactionType: 'RESERVE',
      amount,
      description: `Reserve for settlement: ${options.settlementMethod}`,
      metadata: { settlementDestination: options.settlementDestination },
    });

    // Then record the settlement (debits pending balance)
    return this.createEntry({
      merchantId,
      paymentIntentId: options.paymentIntentId,
      transactionType: 'SETTLEMENT',
      amount,
      settlementMethod: options.settlementMethod,
      settlementDestination: options.settlementDestination,
      settlementTxId: options.settlementTxId,
      description:
        options.description ||
        `Settlement via ${options.settlementMethod} to ${options.settlementDestination}`,
      status: 'COMPLETED',
      metadata: options.metadata,
    });
  }

  /**
   * Record refund transaction
   */
  async recordRefund(
    merchantId: string,
    amount: string,
    options: {
      paymentIntentId?: string;
      refundId?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<LedgerEntry> {
    return this.createEntry({
      merchantId,
      paymentIntentId: options.paymentIntentId,
      transactionType: 'REFUND',
      amount,
      description: options.description || `Refund for payment ${options.paymentIntentId || options.refundId}`,
      status: 'COMPLETED',
      metadata: {
        refundId: options.refundId,
        ...options.metadata,
      },
    });
  }

  /**
   * Record chargeback/dispute transaction
   */
  async recordChargeback(
    merchantId: string,
    amount: string,
    options: {
      paymentIntentId?: string;
      chargebackId?: string;
      disputeReason?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<LedgerEntry> {
    return this.createEntry({
      merchantId,
      paymentIntentId: options.paymentIntentId,
      transactionType: 'CHARGEBACK',
      amount,
      description: options.description || `Chargeback for payment ${options.paymentIntentId || options.chargebackId}: ${options.disputeReason || 'Unknown reason'}`,
      status: 'COMPLETED',
      metadata: {
        chargebackId: options.chargebackId,
        disputeReason: options.disputeReason,
        ...options.metadata,
      },
    });
  }

  /**
   * Record fee transaction (platform fees, processing fees, etc.)
   */
  async recordFee(
    merchantId: string,
    amount: string,
    options: {
      paymentIntentId?: string;
      feeType?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<LedgerEntry> {
    return this.createEntry({
      merchantId,
      paymentIntentId: options.paymentIntentId,
      transactionType: 'FEE',
      amount,
      description: options.description || `Fee: ${options.feeType || 'platform fee'}`,
      status: 'COMPLETED',
      metadata: {
        feeType: options.feeType,
        ...options.metadata,
      },
    });
  }

  /**
   * Get ledger entries for a merchant
   */
  async getLedgerEntries(
    merchantId: string,
    options?: {
      limit?: number;
      offset?: number;
      transactionType?: string;
      paymentIntentId?: string;
    },
  ): Promise<Array<{
    id: string;
    fiatAccountId: string;
    paymentIntentId: string | null;
    transactionType: string;
    amount: string;
    currency: string;
    balanceBefore: string;
    balanceAfter: string;
    description: string | null;
    settlementMethod: string | null;
    settlementDestination: string | null;
    settlementTxId: string | null;
    status: string;
    metadata: unknown;
    createdAt: Date;
  }>> {
    const account = await this.fiatAccountService.getOrCreateAccount(
      merchantId,
    );

    return this.prisma.ledgerEntry.findMany({
      where: {
        fiatAccountId: account.id,
        ...(options?.transactionType && {
          transactionType: options.transactionType,
        }),
        ...(options?.paymentIntentId && {
          paymentIntentId: options.paymentIntentId,
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 100,
      skip: options?.offset || 0,
    });
  }
}

// Type export for Prisma model
type LedgerEntry = {
  id: string;
  fiatAccountId: string;
  paymentIntentId: string | null;
  transactionType: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  description: string | null;
  settlementMethod: string | null;
  settlementDestination: string | null;
  settlementTxId: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date;
};

