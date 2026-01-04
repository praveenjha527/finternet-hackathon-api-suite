import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { SettlementService } from "../services/settlement.service";
import { AuditService } from "../services/audit.service";
import { PaymentEventService } from "../services/payment-event.service";
import { PaymentStateMachineService } from "../services/payment-state-machine.service";
import { EscrowService } from "../services/escrow.service";
import {
  PaymentIntentStatus,
  PaymentIntentPhase,
  SettlementStatus,
} from "../entities/payment-intent.entity";
import { ethers } from "ethers";

export interface SettlementJobData {
  paymentIntentId: string;
  merchantId: string;
  settlementMethod: string;
  settlementDestination: string;
  amount: string;
  currency: string;
}

@Processor("settlement")
@Injectable()
export class SettlementQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
    private readonly audit: AuditService,
    private readonly events: PaymentEventService,
    private readonly stateMachine: PaymentStateMachineService,
    private readonly escrow: EscrowService,
  ) {
    super();
    this.logger.log("SettlementQueueProcessor initialized and ready to process jobs");
  }

  async process(job: Job<SettlementJobData>): Promise<void> {
    this.logger.log(`Processing settlement job for payment intent: ${job.data.paymentIntentId}`);
    const {
      paymentIntentId,
      merchantId,
      settlementMethod,
      settlementDestination,
      amount,
      currency,
    } = job.data;

    // Get current payment intent
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
    });

    if (!intent) {
      throw new Error(`Payment intent not found: ${paymentIntentId}`);
    }

    let settlementTxHash: string | null = null;
    let offRampResult: Awaited<ReturnType<typeof this.settlement.processOffRampMock>> | null = null;

    // For DELIVERY_VS_PAYMENT type, execute settlement on-chain first
    if (intent.type === "DELIVERY_VS_PAYMENT" && intent.contractAddress) {
      try {
        // Get escrow order
        const escrowOrder = await this.prisma.escrowOrder.findUnique({
          where: { paymentIntentId },
        });

        if (!escrowOrder) {
          this.logger.warn(
            `Escrow order not found for payment intent ${paymentIntentId}, skipping on-chain settlement`,
          );
        } else {
          // Check order state from contract to verify it's ready for settlement
          const orderId = BigInt(escrowOrder.orderId);
          const orderState = await this.escrow.getOrderState(
            intent.contractAddress,
            orderId,
          );

          if (!orderState) {
            throw new Error(`Order state not found for orderId ${orderId}`);
          }

          // Check if settlement is already executed on-chain
          // SettlementStatus enum: None(0), Scheduled(1), Ready(2), Processing(3), Completed(4), Cancelled(5), Failed(6)
          // If settlement is executed, status will be Processing(3) or Completed(4), and txHash will be non-zero
          const settlementState = await this.escrow.getSettlementState(
            intent.contractAddress,
            orderId,
          );

          // Check if settlement was already executed
          // SettlementStatus enum: None(0), Scheduled(1), Ready(2), Processing(3), Completed(4), Cancelled(5), Failed(6)
          // Settlement is executed if status is Processing(3) or Completed(4) AND txHash is non-zero
          // Note: If settlement hasn't been executed, getSettlement() returns a default struct with status=0 and zero txHash
          const settlementStatus = settlementState ? Number(settlementState.status) : 0;
          const hasValidTxHash = settlementState?.txHash && 
            settlementState.txHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
          
          const isSettlementExecuted = (settlementStatus === 3 || settlementStatus === 4) && hasValidTxHash;

          if (isSettlementExecuted) {
            // Settlement already executed on-chain - we just need to confirm it after off-ramp processing
            this.logger.log(
              `Settlement already executed on-chain for orderId ${orderId}, txHash: ${settlementState.txHash}, status: ${settlementState.status}. Will confirm after off-ramp.`,
            );
            settlementTxHash = settlementState.txHash;
          } else {
            // Settlement not executed yet - execute it now to move funds from merchant balance to off-ramp
            this.logger.log(
              `Executing settlement on-chain for orderId ${orderId} (fiat destination: ${settlementDestination})`,
            );

            const executeResult = await this.escrow.executeSettlement(
              intent.contractAddress,
              orderId,
              merchantId, // Pass merchantId to get merchant's Ethereum address from contract
              "0x", // offrampData - empty for now
            );

            settlementTxHash = executeResult.hash;
            this.logger.log(
              `Settlement execution transaction submitted: ${settlementTxHash}`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to execute on-chain settlement for payment intent ${paymentIntentId}:`,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error.stack : undefined,
        );
        // Continue with off-ramp processing even if on-chain settlement fails
        // The error will be logged and can be retried
      }
    }

    // Execute the off-ramp settlement (mock fiat processing)
    offRampResult = await this.settlement.processOffRampMock(
      merchantId,
      settlementDestination,
      amount,
      currency,
      {
        paymentIntentId,
        settlementMethod,
      },
    );

    // If on-chain settlement was executed and off-ramp succeeded, confirm settlement on-chain
    if (
      intent.type === "DELIVERY_VS_PAYMENT" &&
      intent.contractAddress &&
      settlementTxHash &&
      offRampResult.success &&
      offRampResult.transactionId
    ) {
      try {
        const escrowOrder = await this.prisma.escrowOrder.findUnique({
          where: { paymentIntentId },
        });

        if (escrowOrder) {
          const orderId = BigInt(escrowOrder.orderId);
          this.logger.log(
            `Confirming settlement on-chain for orderId ${orderId} with fiat tx: ${offRampResult.transactionId}`,
          );

          const fiatTxHashBytes32 = ethers.zeroPadValue(ethers.toUtf8Bytes(offRampResult.transactionId), 32);

          await this.escrow.confirmSettlement(
            intent.contractAddress,
            orderId,
            fiatTxHashBytes32
          );

          this.logger.log(
            `Settlement confirmed on-chain for orderId ${orderId}`,
          );
        }
      } catch (error) {
        // Log error but don't fail the settlement - off-ramp already succeeded
        this.logger.error(
          `Failed to confirm settlement on-chain for payment intent ${paymentIntentId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const result = offRampResult;

    const phases = (intent.phases as PaymentIntentPhase[] | null) ?? [];
    const now = Math.floor(Date.now() / 1000);

    if (!result.success) {
      // Settlement failed - update to FAILED status
      const updatedPhases: PaymentIntentPhase[] = [
        ...phases.filter((p) => p.phase !== "SETTLEMENT"),
        { phase: "SETTLEMENT", status: "FAILED", timestamp: now },
      ];

      await this.prisma.paymentIntent.update({
        where: { id: paymentIntentId },
        data: {
          settlementStatus: SettlementStatus.FAILED,
          phases: updatedPhases,
        },
      });

      // Log settlement failure
      await this.audit.logSettlementCompleted({
        paymentIntentId,
        merchantId,
        amount,
        currency,
        settlementMethod,
        settlementDestination,
        settlementTxId: "failed",
      });

      return;
    }

    // Settlement successful - use state machine to transition
    const currentStatus = intent.status as PaymentIntentStatus;
    const targetStatus = PaymentIntentStatus.SETTLED;

    this.stateMachine.transition(currentStatus, targetStatus, {
      reason: "Settlement completed",
    });

    const updatedPhases: PaymentIntentPhase[] = [
      ...phases.filter((p) => p.phase !== "SETTLEMENT"),
      { phase: "SETTLEMENT", status: "COMPLETED", timestamp: now },
    ];

    const updated = await this.prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        status: targetStatus,
        settlementStatus: SettlementStatus.COMPLETED,
        phases: updatedPhases,
      },
    });

      // Log settlement completion
      await this.audit.logSettlementCompleted({
        paymentIntentId,
        merchantId,
        amount,
        currency,
        settlementMethod,
        settlementDestination,
        settlementTxId: result.transactionId || "mock_settlement",
      });

    // Emit settlement completed event
    await this.events.emitSettlementCompleted({
      paymentIntentId,
      merchantId,
      status: targetStatus,
      amount,
      currency,
      settlementMethod,
      settlementDestination,
      settlementTxId: result.transactionId || "mock_settlement",
      settlementStatus: SettlementStatus.COMPLETED,
    });

    // Emit status changed event
    await this.events.emitStatusChanged({
      paymentIntentId,
      merchantId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      amount,
      currency,
    });
  }
}
