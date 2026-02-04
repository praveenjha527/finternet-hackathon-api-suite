import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { BlockchainService } from "../services/blockchain.service";
import { AuditService } from "../services/audit.service";
import { PaymentEventService } from "../services/payment-event.service";
import { PaymentStateMachineService } from "../services/payment-state-machine.service";
import { LedgerService } from "../services/ledger.service";
import { SettlementQueueService } from "./settlement-queue.service";
import { EscrowService } from "../services/escrow.service";
import {
  PaymentIntentStatus,
  PaymentIntentPhase,
  SettlementStatus,
} from "../entities/payment-intent.entity";
import { Contract, formatUnits } from "ethers";
import { DVPEscrowWithSettlementAbi } from "../../../contracts/types";

export interface TransactionConfirmationJobData {
  paymentIntentId: string;
  merchantId: string;
  transactionHash: string;
  retryCount?: number;
}

@Processor("transaction-confirmation")
@Injectable()
export class TransactionConfirmationQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(TransactionConfirmationQueueProcessor.name);
  private readonly MAX_RETRIES = 60; // Retry up to 60 times (roughly 10 minutes with 10s delay)

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchain: BlockchainService,
    private readonly audit: AuditService,
    private readonly events: PaymentEventService,
    private readonly stateMachine: PaymentStateMachineService,
    private readonly ledger: LedgerService,
    private readonly settlementQueue: SettlementQueueService,
    private readonly escrow: EscrowService,
  ) {
    super();
    this.logger.log("TransactionConfirmationQueueProcessor initialized and ready to process jobs");
  }

  async process(job: Job<TransactionConfirmationJobData>): Promise<void> {
    this.logger.log(
      `Processing transaction confirmation job for payment intent: ${job.data.paymentIntentId}`,
    );
    const { paymentIntentId, merchantId, transactionHash, retryCount = 0 } = job.data;

    try {
      // Fetch current payment intent
      const existing = await this.prisma.paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });

      if (!existing) {
        this.logger.error(`Payment intent not found: ${paymentIntentId}`);
        throw new Error(`Payment intent not found: ${paymentIntentId}`);
      }

      // If already in a terminal state, skip
      if (
        existing.status === PaymentIntentStatus.SUCCEEDED ||
        existing.status === PaymentIntentStatus.SETTLED ||
        existing.status === PaymentIntentStatus.FINAL ||
        existing.status === PaymentIntentStatus.CANCELED
      ) {
        this.logger.log(
          `Payment intent ${paymentIntentId} is already in terminal state (${existing.status}), skipping`,
        );
        return;
      }

      // Check transaction receipt status (pending/success/failed)
      const receiptStatus = await this.blockchain.getTransactionReceiptStatus(transactionHash);
      this.logger.log(
        `Transaction ${transactionHash} receipt status: ${receiptStatus} (attempt ${retryCount + 1}/${this.MAX_RETRIES})`,
      );

      // If pending, retry later
      if (receiptStatus === 'pending') {
        if (retryCount < this.MAX_RETRIES) {
          this.logger.log(
            `Transaction ${transactionHash} is still pending, will retry (attempt ${retryCount + 1}/${this.MAX_RETRIES})`,
          );
          throw new Error(
            `Transaction receipt is pending. Will retry.`,
          );
        } else {
          this.logger.warn(
            `Max retries reached for ${paymentIntentId}, transaction still pending`,
          );
          // Mark as failed after max retries
          await this.handleTransactionFailed(
            paymentIntentId,
            merchantId,
            transactionHash,
            "TRANSACTION_PENDING_TIMEOUT",
          );
          return;
        }
      }

      // If failed, handle failure
      if (receiptStatus === 'failed') {
        this.logger.error(
          `Transaction ${transactionHash} failed/reverted on-chain`,
        );
        await this.handleTransactionFailed(
          paymentIntentId,
          merchantId,
          transactionHash,
          "TRANSACTION_REVERTED",
        );
        return;
      }

      // If success, update payment intent to SUCCEEDED
      if (receiptStatus === 'success') {
        // Only process if status is PROCESSING or INITIATED
        if (
          existing.status !== PaymentIntentStatus.PROCESSING &&
          existing.status !== PaymentIntentStatus.INITIATED
        ) {
          this.logger.warn(
            `Payment intent ${paymentIntentId} is not in PROCESSING or INITIATED status (current: ${existing.status}), skipping status update`,
          );
          return;
        }

        await this.handleTransactionSuccess(
          paymentIntentId,
          merchantId,
          transactionHash,
          existing.status as PaymentIntentStatus,
        );
        return;
      }

      // This should never be reached, but TypeScript requires it
      this.logger.error(
        `Unexpected receipt status for transaction ${transactionHash}: ${receiptStatus}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing transaction confirmation for ${paymentIntentId}:`,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined,
      );
      throw error; // Re-throw to trigger retry mechanism
    }
  }

  private async handleTransactionSuccess(
    paymentIntentId: string,
    merchantId: string,
    transactionHash: string,
    currentStatus: PaymentIntentStatus,
  ): Promise<void> {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
    });

    if (!existing) {
      this.logger.warn(`Payment intent ${paymentIntentId} not found during success handling.`);
      return;
    }

    const phases = (existing.phases as PaymentIntentPhase[] | null) ?? [];
    const now = Math.floor(Date.now() / 1000);
    const updatedPhases: PaymentIntentPhase[] = [
      ...phases.filter((p) => p.phase !== "BLOCKCHAIN_CONFIRMATION"),
      {
        phase: "BLOCKCHAIN_CONFIRMATION",
        status: "COMPLETED",
        timestamp: now,
      },
      // DvP demo phase (kept aligned with spec example)
      { phase: "ESCROW_LOCKED", status: "COMPLETED", timestamp: now },
      { phase: "AWAITING_DELIVERY_PROOF", status: "IN_PROGRESS" },
    ];

    const targetStatus = this.stateMachine.transition(
      currentStatus,
      PaymentIntentStatus.SUCCEEDED,
      { reason: "Transaction receipt confirmed success" },
    );

    const updated = await this.prisma.paymentIntent.update({
      where: { id: existing.id },
      data: {
        status: targetStatus,
        phases: updatedPhases,
        settlementStatus: SettlementStatus.IN_PROGRESS,
      },
    });

    this.logger.log(
      `Payment intent ${paymentIntentId} status updated to ${targetStatus} after successful transaction receipt`,
    );

    // Log blockchain transaction confirmation
    await this.audit.logBlockchainTxConfirmed({
      paymentIntentId: updated.id,
      merchantId,
      transactionHash: updated.transactionHash!,
    });

    // Credit merchant account (payment succeeded - gateway now owes merchant)
    try {
      /**
       * For DELIVERY_VS_PAYMENT type:
       * 1. Check merchant balance from escrow contract
       * 2. Verify order exists and funds are locked
       * 3. Credit internal ledger (funds are locked in escrow, not yet released)
       * 
       * Settlement execution happens later when:
       * - Delivery proof is submitted (via programmable payment queue)
       * - Time lock expires (via programmable payment queue)
       * - Milestone is completed (via programmable payment queue)
       * 
       * For other payment types:
       * - Credit ledger directly (funds are already transferred)
       */

      if (updated.type === "DELIVERY_VS_PAYMENT" && updated.contractAddress) {
        // For escrow-based payments, verify funds are locked in contract
        try {
          // Get escrow order from database
          const escrowOrder = await this.prisma.escrowOrder.findUnique({
            where: { paymentIntentId: updated.id },
          });

          if (!escrowOrder) {
            this.logger.warn(
              `Escrow order not found for payment intent ${updated.id}, skipping balance check`,
            );
          } else {
            // Get contract merchant ID and merchant address
            const contractMerchantId = await this.escrow.getContractMerchantId(merchantId);
            const orderId = BigInt(escrowOrder.orderId);
            
            // Get merchant address from contract
            if (!this.blockchain.isMockMode() && this.blockchain.getSigner()) {
              const escrowContract = new Contract(
                updated.contractAddress,
                DVPEscrowWithSettlementAbi,
                this.blockchain.getSigner()!,
              ) as any;

              // 1. Check merchant balance from contract
              const tokenAddress = escrowOrder.tokenAddress || process.env.TOKEN_ADDRESS;
              const merchantOnChain = await escrowContract.merchants(contractMerchantId);
              const merchantAddress = merchantOnChain.merchantAddress;
              
              const balance = await escrowContract.merchantBalances(merchantAddress, tokenAddress);
              const balanceFormatted = formatUnits(balance, 6); // Assuming 6 decimals for USDC
              
              this.logger.log(
                `Merchant ${merchantAddress} balance in escrow: ${balanceFormatted} ${updated.currency}`,
              );

              // 2. Get order state to verify it exists
              const orderState = await escrowContract.getOrder(orderId);
              if (orderState) {
                this.logger.log(
                  `Order ${orderId} verified in contract. Status: ${orderState.status}, Settlement Status: ${orderState.settlementStatus}`,
                );
              }

            }
          }
        } catch (error) {
          // Log error but don't fail - balance check is informational
          this.logger.warn(
            `Failed to check escrow balance for payment ${updated.id}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      // Credit internal ledger (this represents our accounting, not on-chain funds)
      await this.ledger.credit((updated as any).merchantId, updated.amount, {
        paymentIntentId: updated.id,
        description: `Payment received: ${updated.id}`,
        metadata: {
          transactionHash: updated.transactionHash,
          currency: updated.currency,
          type: updated.type,
        },
      });
      this.logger.log(`Merchant account credited for payment intent ${updated.id}`);
    } catch (error) {
      // Log error but don't fail the payment confirmation
      this.logger.error(
        `Failed to credit merchant account for payment ${updated.id}:`,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined,
      );
    }

    // Enqueue settlement job if settlement method is OFF_RAMP_MOCK
    // For DELIVERY_VS_PAYMENT, settlement is handled by programmable payment queue
    // (after delivery proof, time lock, or milestone completion)
    // For CONSENTED_PULL and other types, settlement happens immediately
    if (
      updated.settlementMethod === "OFF_RAMP_MOCK" &&
      updated.type !== "DELIVERY_VS_PAYMENT"
    ) {
      await this.settlementQueue.enqueueSettlement({
        paymentIntentId: updated.id,
        merchantId: (updated as any).merchantId,
        settlementMethod: updated.settlementMethod,
        settlementDestination: updated.settlementDestination,
        amount: updated.amount,
        currency: updated.currency,
      });
      this.logger.log(`Settlement job enqueued for payment intent ${updated.id}`);
    } else if (
      updated.settlementMethod === "OFF_RAMP_MOCK" &&
      updated.type === "DELIVERY_VS_PAYMENT"
    ) {
      this.logger.log(
        `Skipping immediate settlement for DELIVERY_VS_PAYMENT payment intent ${updated.id}. Settlement will be handled by programmable payment queue after delivery proof, time lock, or milestone completion.`,
      );
    }

    // Emit blockchain transaction confirmed event
    await this.events.emitBlockchainTxConfirmed({
      paymentIntentId: updated.id,
      merchantId,
      status: targetStatus,
      amount: updated.amount,
      currency: updated.currency,
      transactionHash: updated.transactionHash!,
    });

    this.logger.log(
      `Transaction success processing completed for payment intent ${paymentIntentId}`,
    );
  }

  private async handleTransactionFailed(
    paymentIntentId: string,
    merchantId: string,
    transactionHash: string,
    reason: string,
  ): Promise<void> {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
    });

    if (!existing) {
      this.logger.warn(`Payment intent ${paymentIntentId} not found during failure handling.`);
      return;
    }

    const currentStatus = existing.status as PaymentIntentStatus;
    const targetStatus = this.stateMachine.transition(
      currentStatus,
      PaymentIntentStatus.REQUIRES_ACTION,
      { reason: `Transaction receipt failed: ${reason}` },
    );

    const phases = (existing.phases as PaymentIntentPhase[] | null) ?? [];
    const now = Math.floor(Date.now() / 1000);

    const updated = await this.prisma.paymentIntent.update({
      where: { id: existing.id },
      data: {
        status: targetStatus,
        settlementStatus: SettlementStatus.FAILED,
        phases: [
          ...phases.filter((p) => p.phase !== "BLOCKCHAIN_CONFIRMATION"),
          {
            phase: "BLOCKCHAIN_CONFIRMATION",
            status: "FAILED",
            timestamp: now,
            reason: `Transaction receipt failed: ${reason}`,
          },
        ],
      },
    });

    this.logger.error(
      `Payment intent ${paymentIntentId} status updated to ${targetStatus} due to transaction failure: ${reason}`,
    );

    await this.audit.log({
      paymentIntentId: updated.id,
      merchantId,
      eventType: "BLOCKCHAIN_TX_FAILED",
      category: "ON_CHAIN",
      blockchainTxHash: transactionHash,
      blockchainTxStatus: "FAILED",
      fromStatus: currentStatus,
      toStatus: targetStatus,
      phase: "BLOCKCHAIN_CONFIRMATION",
      phaseStatus: "FAILED",
      actorType: "SYSTEM",
      metadata: {
        reason: `Transaction receipt failed: ${reason}`,
      },
    });

    await this.events.emitStatusChanged({
      paymentIntentId: updated.id,
      merchantId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      amount: updated.amount,
      currency: updated.currency,
      reason: `Blockchain transaction failed: ${reason}`,
    });

    this.logger.log(
      `Transaction failure processing completed for payment intent ${paymentIntentId}`,
    );
  }
}

