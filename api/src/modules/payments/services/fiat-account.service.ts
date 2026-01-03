import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

export interface CreateFiatAccountDto {
  merchantId: string;
  currency?: string;
  accountNumber?: string;
  routingNumber?: string;
  bankName?: string;
  accountHolderName?: string;
  country?: string;
  initialBalance?: string;
}

export interface FiatAccountBalance {
  availableBalance: string;
  pendingBalance: string;
  reservedBalance: string;
  totalBalance: string;
  currency: string;
}

@Injectable()
export class FiatAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get or create a fiat account for a merchant
   */
  async getOrCreateAccount(
    merchantId: string,
  ): Promise<{
    id: string;
    merchantId: string;
    currency: string;
    availableBalance: string;
    pendingBalance: string;
    reservedBalance: string;
    accountNumber: string;
    routingNumber: string | null;
    bankName: string | null;
    accountHolderName: string | null;
    country: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    let account = await this.prisma.merchantFiatAccount.findUnique({
      where: { merchantId },
    });

    if (!account) {
      account = await this.createAccount({
        merchantId,
      });
    }

    return account;
  }

  /**
   * Create a new fiat account for a merchant
   */
  async createAccount(dto: CreateFiatAccountDto): Promise<MerchantFiatAccount> {
    const accountNumber =
      dto.accountNumber || this.generateAccountNumber();
    const routingNumber = dto.routingNumber || this.generateRoutingNumber();

    return this.prisma.merchantFiatAccount.create({
      data: {
        merchantId: dto.merchantId,
        currency: dto.currency || 'USD',
        accountNumber,
        routingNumber,
        bankName: dto.bankName || 'Simulated Bank',
        accountHolderName: dto.accountHolderName || `Merchant ${dto.merchantId.slice(0, 8)}`,
        country: dto.country || 'US',
        availableBalance: dto.initialBalance || '0',
        pendingBalance: '0',
        reservedBalance: '0',
      },
    });
  }

  /**
   * Get account balance
   */
  async getBalance(merchantId: string): Promise<FiatAccountBalance> {
    const account = await this.getOrCreateAccount(merchantId);

    const available = this.parseDecimal(account.availableBalance);
    const pending = this.parseDecimal(account.pendingBalance);
    const reserved = this.parseDecimal(account.reservedBalance);
    const total = available.plus(pending).plus(reserved);

    return {
      availableBalance: available.toString(),
      pendingBalance: pending.toString(),
      reservedBalance: reserved.toString(),
      totalBalance: total.toString(),
      currency: account.currency,
    };
  }

  /**
   * Get account details
   */
  async getAccount(merchantId: string): Promise<MerchantFiatAccount | null> {
    return this.prisma.merchantFiatAccount.findUnique({
      where: { merchantId },
      include: {
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 10, // Last 10 transactions
        },
      },
    });
  }

  /**
   * Generate a simulated account number
   */
  private generateAccountNumber(): string {
    // Generate a 10-digit account number
    return Array.from({ length: 10 }, () =>
      Math.floor(Math.random() * 10),
    ).join('');
  }

  /**
   * Generate a simulated routing number (US format: 9 digits)
   */
  private generateRoutingNumber(): string {
    return Array.from({ length: 9 }, () =>
      Math.floor(Math.random() * 10),
    ).join('');
  }

  /**
   * Parse decimal string to Decimal
   */
  private parseDecimal(value: string): Decimal {
    return new Decimal(value || '0');
  }
}

// Type export for Prisma model
type MerchantFiatAccount = {
  id: string;
  merchantId: string;
  currency: string;
  availableBalance: string;
  pendingBalance: string;
  reservedBalance: string;
  accountNumber: string;
  routingNumber: string | null;
  bankName: string | null;
  accountHolderName: string | null;
  country: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

