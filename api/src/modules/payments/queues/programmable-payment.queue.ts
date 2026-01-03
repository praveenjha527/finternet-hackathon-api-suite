import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { AuditService } from "../services/audit.service";
import { PaymentEventService } from "../services/payment-event.service";

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
  ) {
    super();
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

    // Update order status to indicate release
    // Note: Actual fund release happens on-chain via contract interaction
    // This job primarily tracks the state and can trigger notifications
    await this.prisma.escrowOrder.update({
      where: { id: escrowOrderId },
      data: {
        releasedAt: currentTimestamp.toString(),
        orderStatus: "COMPLETED",
      },
    });

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

    // Update milestone status to released
    // Note: Actual fund release happens on-chain via contract interaction
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    await this.prisma.paymentMilestone.update({
      where: { id: milestoneId },
      data: {
        status: "RELEASED",
        releasedAt: currentTimestamp.toString(),
      },
    });

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

    // Check if auto-release is enabled
    if (!escrowOrder.autoReleaseOnProof) {
      this.logger.log(`Auto-release disabled for order ${escrowOrderId}. Manual release required.`);
      return;
    }

    // Check if already released
    if (escrowOrder.orderStatus === "COMPLETED" && escrowOrder.releasedAt) {
      this.logger.log(`Funds already released for order ${escrowOrderId}`);
      return;
    }

    // Update order status
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    await this.prisma.escrowOrder.update({
      where: { id: escrowOrderId },
      data: {
        releasedAt: currentTimestamp.toString(),
        orderStatus: "COMPLETED",
        actualDeliveryHash: deliveryProof.proofHash,
      },
    });

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

