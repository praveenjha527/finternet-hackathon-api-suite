import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { Prisma } from "@prisma/client";

type AuditLogData = {
  paymentIntentId: string;
  merchantId: string;
  eventType: string;
  category: "ON_CHAIN" | "OFF_RAMP" | "LIFECYCLE" | "AUTHORIZATION";
  amount?: string;
  currency?: string;
  blockchainTxHash?: string;
  blockchainTxStatus?: "PENDING" | "CONFIRMED" | "FAILED";
  contractAddress?: string;
  chainId?: number;
  blockNumber?: bigint;
  blockTimestamp?: Date;
  settlementMethod?: string;
  settlementDestination?: string;
  settlementTxId?: string;
  settlementStatus?: string;
  fromStatus?: string;
  toStatus?: string;
  phase?: string;
  phaseStatus?: string;
  actorType?: "MERCHANT" | "PAYER" | "SYSTEM" | "BLOCKCHAIN";
  actorId?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an audit event for money trail tracking.
   * This creates an immutable audit log entry.
   */
  async log(data: AuditLogData): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          paymentIntentId: data.paymentIntentId,
          merchantId: data.merchantId,
          eventType: data.eventType,
          category: data.category,
          amount: data.amount,
          currency: data.currency,
          blockchainTxHash: data.blockchainTxHash,
          blockchainTxStatus: data.blockchainTxStatus,
          contractAddress: data.contractAddress,
          chainId: data.chainId,
          blockNumber: data.blockNumber,
          blockTimestamp: data.blockTimestamp,
          settlementMethod: data.settlementMethod,
          settlementDestination: data.settlementDestination,
          settlementTxId: data.settlementTxId,
          settlementStatus: data.settlementStatus,
          fromStatus: data.fromStatus,
          toStatus: data.toStatus,
          phase: data.phase,
          phaseStatus: data.phaseStatus,
          actorType: data.actorType,
          actorId: data.actorId,
          metadata: data.metadata
            ? (data.metadata as Prisma.InputJsonValue)
            : undefined,
        },
      });
    } catch (error) {
      // Log error but don't throw - audit logging should not break the main flow
      console.error("Failed to create audit log:", error);
    }
  }

  /**
   * Log payment intent creation.
   */
  async logIntentCreated(params: {
    paymentIntentId: string;
    merchantId: string;
    amount: string;
    currency: string;
    type: string;
    settlementMethod: string;
    settlementDestination: string;
  }): Promise<void> {
    await this.log({
      paymentIntentId: params.paymentIntentId,
      merchantId: params.merchantId,
      eventType: "INTENT_CREATED",
      category: "LIFECYCLE",
      amount: params.amount,
      currency: params.currency,
      settlementMethod: params.settlementMethod,
      settlementDestination: params.settlementDestination,
      toStatus: "INITIATED",
      actorType: "MERCHANT",
      actorId: params.merchantId,
      metadata: {
        paymentType: params.type,
      },
    });
  }

  /**
   * Log blockchain transaction submission.
   */
  async logBlockchainTxSubmitted(params: {
    paymentIntentId: string;
    merchantId: string;
    amount: string;
    currency: string;
    transactionHash: string;
    contractAddress: string;
    chainId: number;
    payerAddress: string;
  }): Promise<void> {
    await this.log({
      paymentIntentId: params.paymentIntentId,
      merchantId: params.merchantId,
      eventType: "BLOCKCHAIN_TX_SUBMITTED",
      category: "ON_CHAIN",
      amount: params.amount,
      currency: params.currency,
      blockchainTxHash: params.transactionHash,
      blockchainTxStatus: "PENDING",
      contractAddress: params.contractAddress,
      chainId: params.chainId,
      fromStatus: "INITIATED",
      toStatus: "PROCESSING",
      phase: "BLOCKCHAIN_CONFIRMATION",
      phaseStatus: "IN_PROGRESS",
      actorType: "PAYER",
      actorId: params.payerAddress,
    });
  }

  /**
   * Log blockchain transaction confirmation.
   */
  async logBlockchainTxConfirmed(params: {
    paymentIntentId: string;
    merchantId: string;
    transactionHash: string;
    blockNumber?: bigint;
    blockTimestamp?: Date;
  }): Promise<void> {
    await this.log({
      paymentIntentId: params.paymentIntentId,
      merchantId: params.merchantId,
      eventType: "BLOCKCHAIN_TX_CONFIRMED",
      category: "ON_CHAIN",
      blockchainTxHash: params.transactionHash,
      blockchainTxStatus: "CONFIRMED",
      blockNumber: params.blockNumber,
      blockTimestamp: params.blockTimestamp,
      toStatus: "SUCCEEDED",
      phase: "BLOCKCHAIN_CONFIRMATION",
      phaseStatus: "COMPLETED",
      actorType: "BLOCKCHAIN",
    });
  }

  /**
   * Log settlement initiation.
   */
  async logSettlementInitiated(params: {
    paymentIntentId: string;
    merchantId: string;
    amount: string;
    currency: string;
    settlementMethod: string;
    settlementDestination: string;
  }): Promise<void> {
    await this.log({
      paymentIntentId: params.paymentIntentId,
      merchantId: params.merchantId,
      eventType: "SETTLEMENT_INITIATED",
      category: "OFF_RAMP",
      amount: params.amount,
      currency: params.currency,
      settlementMethod: params.settlementMethod,
      settlementDestination: params.settlementDestination,
      settlementStatus: "IN_PROGRESS",
      toStatus: "SUCCEEDED",
      phase: "SETTLEMENT",
      phaseStatus: "IN_PROGRESS",
      actorType: "SYSTEM",
    });
  }

  /**
   * Log settlement completion.
   */
  async logSettlementCompleted(params: {
    paymentIntentId: string;
    merchantId: string;
    amount: string;
    currency: string;
    settlementMethod: string;
    settlementDestination: string;
    settlementTxId: string;
  }): Promise<void> {
    await this.log({
      paymentIntentId: params.paymentIntentId,
      merchantId: params.merchantId,
      eventType: "SETTLEMENT_COMPLETED",
      category: "OFF_RAMP",
      amount: params.amount,
      currency: params.currency,
      settlementMethod: params.settlementMethod,
      settlementDestination: params.settlementDestination,
      settlementTxId: params.settlementTxId,
      settlementStatus: "COMPLETED",
      fromStatus: "SUCCEEDED",
      toStatus: "SETTLED",
      phase: "SETTLEMENT",
      phaseStatus: "COMPLETED",
      actorType: "SYSTEM",
    });
  }

  /**
   * Log status change.
   */
  async logStatusChange(params: {
    paymentIntentId: string;
    merchantId: string;
    fromStatus: string;
    toStatus: string;
    phase?: string;
    phaseStatus?: string;
  }): Promise<void> {
    await this.log({
      paymentIntentId: params.paymentIntentId,
      merchantId: params.merchantId,
      eventType: "STATUS_CHANGED",
      category: "LIFECYCLE",
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      phase: params.phase,
      phaseStatus: params.phaseStatus,
      actorType: "SYSTEM",
    });
  }
}
