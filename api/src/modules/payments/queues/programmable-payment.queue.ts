import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { AuditService } from "../services/audit.service";
import { PaymentEventService } from "../services/payment-event.service";
import { EscrowService } from "../services/escrow.service";
import { LedgerService } from "../services/ledger.service";
import { SettlementQueueService } from "./settlement-queue.service";

export interface TimeLockReleaseJobData {
  type: "TIME_LOCK_RELEASE";
  escrowOrderId: string;
  paymentIntentId: string;
  merchantId: string;
  timeLockUntil: string; // Unix timestamp
}

export interface MilestoneCheckJobData {
  type: "MILESTONE_CHECK";
  escrowOrderId: string;
  paymentIntentId: string;
  merchantId: string;
  milestoneId: string;
}

export interface DeliveryProofProcessJobData {
  type: "DELIVERY_PROOF_PROCESS";
  escrowOrderId: string;
  paymentIntentId: string;
  merchantId: string;
  deliveryProofId: string;
}

export interface DisputeTimeoutJobData {
  type: "DISPUTE_TIMEOUT";
  escrowOrderId: string;
  paymentIntentId: string;
  merchantId: string;
  disputeRaisedAt: string; // Unix timestamp
  disputeWindow: string; // Seconds
}

export type ProgrammablePaymentJobData =
  | TimeLockReleaseJobData
  | MilestoneCheckJobData
  | DeliveryProofProcessJobData
  | DisputeTimeoutJobData;

@Processor("programmable-payment")
@Injectable()
export class ProgrammablePaymentQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ProgrammablePaymentQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: PaymentEventService,
    private readonly escrow: EscrowService,
    private readonly ledger: LedgerService,
    private readonly settlementQueue: SettlementQueueService,
  ) {
    super();
    this.logger.log("ProgrammablePaymentQueueProcessor initialized and ready to process jobs");
  }

  async process(job: Job<ProgrammablePaymentJobData>): Promise<void> {
    this.logger.log(`Processing programmable payment job: ${job.data.type} for order ${job.data.escrowOrderId}`);

    switch (job.data.type) {
      case "TIME_LOCK_RELEASE":
        await this.processTimeLockRelease(job.data);
        break;
      case "MILESTONE_CHECK":
        await this.processMilestoneCheck(job.data);
        break;
      case "DELIVERY_PROOF_PROCESS":
        await this.processDeliveryProof(job.data);
        break;
      case "DISPUTE_TIMEOUT":
        await this.processDisputeTimeout(job.data);
        break;
      default:
        this.logger.error(`Unknown job type: ${(job.data as any).type}`);
        throw new Error(`Unknown programmable payment job type: ${(job.data as any).type}`);
    }
  }

  /**
   * Process time-locked release: Check if time lock has expired and release funds
   */
  private async processTimeLockRelease(data: TimeLockReleaseJobData): Promise<void> {
    const { escrowOrderId, paymentIntentId, merchantId, timeLockUntil } = data;

    // Check if time lock has expired
    const lockUntilTimestamp = BigInt(timeLockUntil);
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    if (currentTimestamp < lockUntilTimestamp) {
      this.logger.log(
        `Time lock not expired yet for order ${escrowOrderId}. Lock expires at ${timeLockUntil}, current: ${currentTimestamp}`,
      );
      // Job will be retried or rescheduled
      throw new Error(`Time lock not expired yet. Expires at ${timeLockUntil}`);
    }

    // Get escrow order
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { id: escrowOrderId },
      include: { paymentIntent: true },
    });

    if (!escrowOrder) {
      throw new Error(`Escrow order not found: ${escrowOrderId}`);
    }

    // Check if already released
    if (escrowOrder.orderStatus === "COMPLETED" && escrowOrder.releasedAt) {
      this.logger.log(`Funds already released for order ${escrowOrderId}`);
      return;
    }

    // Verify order status allows release
    if (escrowOrder.orderStatus !== "DELIVERED" && escrowOrder.orderStatus !== "SHIPPED") {
      this.logger.warn(
        `Cannot release time-locked funds for order ${escrowOrderId}. Status: ${escrowOrder.orderStatus}`,
      );
      throw new Error(`Order status ${escrowOrder.orderStatus} does not allow release`);
    }

    // Check order state from contract and execute settlement if needed
    const orderId = BigInt(escrowOrder.orderId);
    let settlementExecuted = false;

    if (escrowOrder.contractAddress) {
      try {
        const orderState = await this.escrow.getOrderState(
          escrowOrder.contractAddress,
          orderId,
        );

        if (!orderState) {
          throw new Error(`Order state not found for orderId ${orderId}`);
        }

        // Check if settlement is already executed
        const settlementState = await this.escrow.getSettlementState(
          escrowOrder.contractAddress,
          orderId,
        );

        if (settlementState && settlementState.status === 1) {
          // Settlement already executed
          this.logger.log(
            `Settlement already executed on-chain for orderId ${orderId}`,
          );
          settlementExecuted = true;
        } else {
          // Execute settlement on-chain if payment intent has settlement destination
          const paymentIntent = escrowOrder.paymentIntent;
          if (
            paymentIntent.settlementMethod === "OFF_RAMP_MOCK" &&
            paymentIntent.settlementDestination
          ) {
            this.logger.log(
              `Executing settlement on-chain for orderId ${orderId} (time-locked release)`,
            );

            await this.escrow.executeSettlement(
              escrowOrder.contractAddress,
              orderId,
              merchantId, // Pass merchantId to get merchant's Ethereum address from contract
              "0x",
            );

            settlementExecuted = true;
            this.logger.log(
              `Settlement executed on-chain for orderId ${orderId}`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to execute on-chain settlement for time-locked release (orderId ${orderId}):`,
          error instanceof Error ? error.message : String(error),
        );
        // Continue with database update even if on-chain execution fails
      }
    }

    // Update order status to indicate release
    await this.prisma.escrowOrder.update({
      where: { id: escrowOrderId },
      data: {
        releasedAt: currentTimestamp.toString(),
        orderStatus: "COMPLETED",
        settlementStatus: settlementExecuted ? "EXECUTED" : "NONE",
      },
    });

    // If settlement was executed, enqueue off-ramp processing
    if (settlementExecuted && escrowOrder.paymentIntent.settlementMethod === "OFF_RAMP_MOCK") {
      await this.settlementQueue.enqueueSettlement({
        paymentIntentId,
        merchantId,
        settlementMethod: escrowOrder.paymentIntent.settlementMethod,
        settlementDestination: escrowOrder.paymentIntent.settlementDestination,
        amount: escrowOrder.amount,
        currency: escrowOrder.paymentIntent.currency,
      });
    }

    // Log the time lock release event
    await this.audit.log({
      paymentIntentId,
      merchantId,
      eventType: "TIME_LOCK_RELEASED",
      category: "PROGRAMMABLE_PAYMENT",
      amount: escrowOrder.amount,
      currency: escrowOrder.paymentIntent.currency,
      metadata: {
        escrowOrderId,
        timeLockUntil,
        releasedAt: currentTimestamp.toString(),
        releaseType: "TIME_LOCK",
      },
      actorType: "SYSTEM",
    });

    this.logger.log(`Time lock released for order ${escrowOrderId}`);
  }

  /**
   * Process milestone check: Verify milestone completion and release funds if eligible
   */
  private async processMilestoneCheck(data: MilestoneCheckJobData): Promise<void> {
    const { escrowOrderId, paymentIntentId, merchantId, milestoneId } = data;

    const milestone = await this.prisma.paymentMilestone.findUnique({
      where: { id: milestoneId },
      include: { escrowOrder: { include: { paymentIntent: true } } },
    });

    if (!milestone) {
      throw new Error(`Milestone not found: ${milestoneId}`);
    }

    // Check if milestone is already released
    if (milestone.status === "RELEASED") {
      this.logger.log(`Milestone ${milestoneId} already released`);
      return;
    }

    // Check if milestone is completed
    if (milestone.status !== "COMPLETED") {
      this.logger.log(`Milestone ${milestoneId} not completed yet. Status: ${milestone.status}`);
      // Job will be retried or rescheduled
      throw new Error(`Milestone ${milestoneId} not completed yet`);
    }

    // Check order state from contract and execute settlement if needed
    const escrowOrder = milestone.escrowOrder;
    const orderId = BigInt(escrowOrder.orderId);
    let settlementExecuted = false;

    if (escrowOrder.contractAddress) {
      try {
        const orderState = await this.escrow.getOrderState(
          escrowOrder.contractAddress,
          orderId,
        );

        if (!orderState) {
          throw new Error(`Order state not found for orderId ${orderId}`);
        }

        // Check if settlement is already executed
        const settlementState = await this.escrow.getSettlementState(
          escrowOrder.contractAddress,
          orderId,
        );

        if (settlementState && settlementState.status === 1) {
          // Settlement already executed
          this.logger.log(
            `Settlement already executed on-chain for orderId ${orderId}`,
          );
          settlementExecuted = true;
        } else {
          // For milestone releases, execute settlement when milestone is complete
          const paymentIntent = escrowOrder.paymentIntent;
          if (
            paymentIntent.settlementMethod === "OFF_RAMP_MOCK" &&
            paymentIntent.settlementDestination
          ) {
            this.logger.log(
              `Executing settlement on-chain for orderId ${orderId} (milestone release)`,
            );

            await this.escrow.executeSettlement(
              escrowOrder.contractAddress,
              orderId,
              merchantId, // Pass merchantId to get merchant's Ethereum address from contract
              "0x",
            );

            settlementExecuted = true;
            this.logger.log(
              `Settlement executed on-chain for orderId ${orderId}`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to execute on-chain settlement for milestone (orderId ${orderId}):`,
          error instanceof Error ? error.message : String(error),
        );
        // Continue with database update even if on-chain execution fails
      }
    }

    // Update milestone status to released
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    await this.prisma.paymentMilestone.update({
      where: { id: milestoneId },
      data: {
        status: "RELEASED",
        releasedAt: currentTimestamp.toString(),
      },
    });

    // If settlement was executed, enqueue off-ramp processing
    if (settlementExecuted && escrowOrder.paymentIntent.settlementMethod === "OFF_RAMP_MOCK") {
      await this.settlementQueue.enqueueSettlement({
        paymentIntentId,
        merchantId,
        settlementMethod: escrowOrder.paymentIntent.settlementMethod,
        settlementDestination: escrowOrder.paymentIntent.settlementDestination,
        amount: escrowOrder.amount,
        currency: escrowOrder.paymentIntent.currency,
      });
    }

    // Log milestone release
    await this.audit.log({
      paymentIntentId,
      merchantId,
      eventType: "MILESTONE_RELEASED",
      category: "PROGRAMMABLE_PAYMENT",
      amount: milestone.amount,
      currency: milestone.escrowOrder.paymentIntent.currency,
      metadata: {
        escrowOrderId,
        milestoneId,
        milestoneIndex: milestone.milestoneIndex,
        releasedAt: currentTimestamp.toString(),
        releaseType: "MILESTONE",
      },
      actorType: "SYSTEM",
    });

    this.logger.log(`Milestone ${milestoneId} released for order ${escrowOrderId}`);
  }

  /**
   * Process delivery proof: Check if auto-release is enabled and release funds
   */
  private async processDeliveryProof(data: DeliveryProofProcessJobData): Promise<void> {
    const { escrowOrderId, paymentIntentId, merchantId, deliveryProofId } = data;

    const deliveryProof = await this.prisma.deliveryProof.findUnique({
      where: { id: deliveryProofId },
      include: { escrowOrder: { include: { paymentIntent: true } } },
    });

    if (!deliveryProof) {
      throw new Error(`Delivery proof not found: ${deliveryProofId}`);
    }

    const escrowOrder = deliveryProof.escrowOrder;

    // Delivery proof was submitted via API – always complete order and credit merchant.
    // (autoReleaseOnProof only affects on-chain auto-release; we still release in our ledger when proof is submitted.)

    // Check if already released
    if (escrowOrder.orderStatus === "COMPLETED" && escrowOrder.releasedAt) {
      this.logger.log(`Funds already released for order ${escrowOrderId}`);
      return;
    }

    // Check order state from contract and execute settlement if needed
    const orderId = BigInt(escrowOrder.orderId);
    // When no contract (off-chain escrow), treat as ready for settlement
    let settlementExecuted = !escrowOrder.contractAddress;

    if (escrowOrder.contractAddress) {
      try {
        const orderState = await this.escrow.getOrderState(
          escrowOrder.contractAddress,
          orderId,
        );

        if (!orderState) {
          throw new Error(`Order state not found for orderId ${orderId}`);
        }

        if (escrowOrder.autoReleaseOnProof) {
          // Check if order status is AwaitingSettlement (OrderStatus enum: 0=Created, 1=InTransit, 2=Delivered, 3=AwaitingSettlement, 4=Completed, etc.)
          // The contract automatically releases funds and sets status to AwaitingSettlement (3) when delivery proof is submitted with auto-release enabled
          // Use Number() to handle potential bigint/string conversions
          const orderStatusNum = Number(orderState.status);
          if (orderStatusNum === 3) {
            // Order status is AwaitingSettlement - funds have been released to merchant's contract balance
            // Enqueue settlement job which will check if settlement is already executed and handle off-ramp + confirmation
            settlementExecuted = true; // Mark as ready for settlement (job will handle execution)
            this.logger.log(
              `Order ${orderId} status is AwaitingSettlement (3) - funds released, enqueueing settlement job`,
            );
          } else {
            // Order status is not yet AwaitingSettlement - delivery proof transaction might not be confirmed yet, or auto-release hasn't executed
            // Re-queue the job with a delay to wait for status update
            this.logger.log(
              `Order ${orderId} status is ${orderStatusNum} (raw: ${orderState.status}), not yet AwaitingSettlement (3). Re-queuing job to wait for auto-release.`,
            );
            throw new Error(
              "Order status not yet AwaitingSettlement, will retry",
            );
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        
        // If it's a retry error, throw it so BullMQ can retry
        if (errorMessage.includes("will retry")) {
          throw error;
        }

        this.logger.error(
          `Failed to check order state for delivery proof (orderId ${orderId}): ${errorMessage}. Proceeding to mark success and credit merchant.`,
        );
        // Even if blockchain failed: treat as success so we update DB, credit merchant, and move to SETTLED
        settlementExecuted = true;
      }
    } else {
      // No contract available (skip-chain or misconfig). Treat as success for delivery proof.
      this.logger.warn(
        `No contract address for escrow order ${escrowOrderId}. Proceeding to mark success and credit merchant.`,
      );
      settlementExecuted = true;
    }

    // Delivery proof was submitted – always treat as ready for settlement so payment intent moves to SETTLED
    settlementExecuted = true;

    // Update order status
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    await this.prisma.escrowOrder.update({
      where: { id: escrowOrderId },
      data: {
        releasedAt: currentTimestamp.toString(),
        orderStatus: "COMPLETED",
        actualDeliveryHash: deliveryProof.proofHash,
        settlementStatus: settlementExecuted ? "SCHEDULED" : "NONE", // Mark as scheduled, settlement queue will update to EXECUTED/CONFIRMED
      },
    });

    // Always credit merchant balance when delivery proof is accepted (even if blockchain failed)
    try {
      await this.ledger.credit(merchantId, escrowOrder.amount, {
        paymentIntentId,
        description: `Delivery proof released: ${paymentIntentId}`,
        metadata: {
          escrowOrderId,
          deliveryProofId,
          releaseType: "DELIVERY_PROOF",
        },
      });
      this.logger.log(`Merchant ${merchantId} credited for delivery proof (order ${escrowOrderId})`);
    } catch (creditError) {
      this.logger.error(
        `Failed to credit merchant for delivery proof ${deliveryProofId}:`,
        creditError instanceof Error ? creditError.message : String(creditError),
      );
    }

    // Enqueue settlement job - it will update payment intent to SETTLED and handle off-ramp (even if on-chain failed)
    if (settlementExecuted && escrowOrder.paymentIntent.settlementMethod === "OFF_RAMP_MOCK") {
      await this.settlementQueue.enqueueSettlement({
        paymentIntentId,
        merchantId,
        settlementMethod: escrowOrder.paymentIntent.settlementMethod,
        settlementDestination: escrowOrder.paymentIntent.settlementDestination!,
        amount: escrowOrder.paymentIntent.amount,
        currency: escrowOrder.paymentIntent.currency,
      });
      this.logger.log(
        `Settlement job enqueued for payment intent ${paymentIntentId} (orderId ${orderId})`,
      );
    }

    // Log delivery proof release
    await this.audit.log({
      paymentIntentId,
      merchantId,
      eventType: "DELIVERY_PROOF_RELEASED",
      category: "PROGRAMMABLE_PAYMENT",
      amount: escrowOrder.amount,
      currency: escrowOrder.paymentIntent.currency,
      metadata: {
        escrowOrderId,
        deliveryProofId,
        proofHash: deliveryProof.proofHash,
        proofURI: deliveryProof.proofURI,
        releasedAt: currentTimestamp.toString(),
        releaseType: "DELIVERY_PROOF",
      },
      actorType: "SYSTEM",
    });

    this.logger.log(`Delivery proof processed and funds released for order ${escrowOrderId}`);
  }

  /**
   * Process dispute timeout: Check if dispute window has expired and handle accordingly
   */
  private async processDisputeTimeout(data: DisputeTimeoutJobData): Promise<void> {
    const { escrowOrderId, paymentIntentId, merchantId, disputeRaisedAt, disputeWindow } = data;

    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { id: escrowOrderId },
      include: { paymentIntent: true },
    });

    if (!escrowOrder) {
      throw new Error(`Escrow order not found: ${escrowOrderId}`);
    }

    // Check if dispute is still active
    if (escrowOrder.orderStatus !== "DISPUTED") {
      this.logger.log(`Dispute no longer active for order ${escrowOrderId}. Status: ${escrowOrder.orderStatus}`);
      return;
    }

    // Check if dispute window has expired
    const disputeRaisedTimestamp = BigInt(disputeRaisedAt);
    const windowSeconds = BigInt(disputeWindow);
    const disputeExpiryTimestamp = disputeRaisedTimestamp + windowSeconds;
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    if (currentTimestamp < disputeExpiryTimestamp) {
      this.logger.log(
        `Dispute window not expired yet for order ${escrowOrderId}. Expires at ${disputeExpiryTimestamp}, current: ${currentTimestamp}`,
      );
      // Job will be retried or rescheduled
      throw new Error(`Dispute window not expired yet. Expires at ${disputeExpiryTimestamp}`);
    }

    // Dispute window has expired - update status
    // Note: Actual resolution logic depends on business rules
    // This could trigger auto-resolution, notifications, or escalation
    await this.prisma.escrowOrder.update({
      where: { id: escrowOrderId },
      data: {
        // Keep as DISPUTED but mark that window expired
        // Actual resolution requires manual intervention or contract call
        updatedAt: new Date(),
      },
    });

    // Log dispute timeout
    await this.audit.log({
      paymentIntentId,
      merchantId,
      eventType: "DISPUTE_WINDOW_EXPIRED",
      category: "DISPUTE",
      amount: escrowOrder.amount,
      currency: escrowOrder.paymentIntent.currency,
      metadata: {
        escrowOrderId,
        disputeRaisedAt,
        disputeWindow,
        disputeExpiryTimestamp: disputeExpiryTimestamp.toString(),
        expiredAt: currentTimestamp.toString(),
      },
      actorType: "SYSTEM",
    });

    this.logger.log(`Dispute window expired for order ${escrowOrderId}. Manual resolution may be required.`);
  }
}
