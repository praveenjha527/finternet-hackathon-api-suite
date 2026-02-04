import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { ProgrammablePaymentQueueService } from "../queues/programmable-payment-queue.service";
import { EscrowService } from "./escrow.service";
import { ApiException } from "../../../common/exceptions";

export interface CreateEscrowOrderDto {
  paymentIntentId: string;
  merchantId: string;
  contractAddress: string;
  buyerAddress: string;
  tokenAddress: string;
  amount: string;
  deliveryPeriod: number;
  deliveryDeadline: string; // Unix timestamp (BigInt as string)
  expectedDeliveryHash?: string;
  autoReleaseOnProof: boolean | string;
  deliveryOracle?: string;
  releaseType: "TIME_LOCKED" | "MILESTONE_LOCKED" | "DELIVERY_PROOF" | "AUTO_RELEASE";
  timeLockUntil?: string; // Unix timestamp for time locks
  createTxHash?: string;
  disputeWindow?: string; // Dispute window in seconds
}

export interface SubmitDeliveryProofDto {
  escrowOrderId: string;
  paymentIntentId: string;
  proofHash: string;
  proofURI?: string;
  submittedBy: string;
  submitTxHash?: string;
}

export interface RaiseDisputeDto {
  escrowOrderId: string;
  paymentIntentId: string;
  merchantId: string;
  reason: string;
  raisedBy: string;
  disputeWindow?: string;
}

export interface CreateMilestoneDto {
  escrowOrderId: string;
  paymentIntentId: string;
  milestoneIndex: number;
  description?: string;
  amount: string;
  percentage?: number;
}

export interface CompleteMilestoneDto {
  milestoneId: string;
  escrowOrderId: string;
  paymentIntentId: string;
  merchantId: string;
  completionProof?: string;
  completionProofURI?: string;
  completedBy: string;
}

/**
 * EscrowOrderService
 * 
 * Manages escrow order creation and lifecycle, automatically scheduling
 * programmable payment jobs based on release types and configurations.
 */
@Injectable()
export class EscrowOrderService {
  private readonly logger = new Logger(EscrowOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
    private readonly programmablePaymentQueue: ProgrammablePaymentQueueService,
  ) {}

  /**
   * Create an escrow order in the database and schedule appropriate jobs
   */
  async createEscrowOrder(dto: CreateEscrowOrderDto): Promise<{
    id: string;
    orderId: string;
  }> {
    // Get orderId from PaymentIntent ID
    const orderId = (await this.escrow.getOrderIdForIntent(dto.paymentIntentId)).toString();

    // Coerce autoReleaseOnProof to boolean (may come as string "true"/"false" from metadata)
    const autoReleaseOnProof =
      dto.autoReleaseOnProof === true ||
      String(dto.autoReleaseOnProof).toLowerCase() === "true";

    // Create escrow order in database
    const escrowOrder = await this.prisma.escrowOrder.create({
      data: {
        paymentIntentId: dto.paymentIntentId,
        orderId,
        merchantId: dto.merchantId,
        contractAddress: dto.contractAddress,
        buyerAddress: dto.buyerAddress,
        tokenAddress: dto.tokenAddress,
        amount: dto.amount,
        deliveryPeriod: dto.deliveryPeriod,
        deliveryDeadline: dto.deliveryDeadline,
        expectedDeliveryHash: dto.expectedDeliveryHash,
        autoReleaseOnProof,
        deliveryOracle: dto.deliveryOracle,
        releaseType: dto.releaseType,
        timeLockUntil: dto.timeLockUntil,
        disputeWindow: dto.disputeWindow,
        createTxHash: dto.createTxHash,
        orderStatus: "PENDING",
        settlementStatus: "NONE",
      },
    });

    this.logger.log(`Created escrow order ${escrowOrder.id} for payment intent ${dto.paymentIntentId}`);

    // Schedule jobs based on release type
    await this.scheduleReleaseJobs(escrowOrder.id, dto);

    return {
      id: escrowOrder.id,
      orderId: escrowOrder.orderId,
    };
  }

  /**
   * Schedule appropriate release jobs based on release type
   */
  private async scheduleReleaseJobs(
    escrowOrderId: string,
    dto: CreateEscrowOrderDto,
  ): Promise<void> {
    const paymentIntent = await this.prisma.paymentIntent.findUnique({
      where: { id: dto.paymentIntentId },
    });

    if (!paymentIntent) {
      throw new ApiException(
        "resource_missing",
        `PaymentIntent not found: ${dto.paymentIntentId}`,
        404,
      );
    }

    switch (dto.releaseType) {
      case "TIME_LOCKED":
        if (dto.timeLockUntil) {
          await this.programmablePaymentQueue.scheduleTimeLockRelease(
            escrowOrderId,
            dto.paymentIntentId,
            dto.merchantId,
            dto.timeLockUntil,
          );
          this.logger.log(
            `Scheduled time-lock release for order ${escrowOrderId} at ${dto.timeLockUntil}`,
          );
        }
        break;

      case "MILESTONE_LOCKED":
        // Milestones will be scheduled when they are created
        this.logger.log(`Milestone-based order ${escrowOrderId} - milestones will be scheduled when created`);
        break;

      case "DELIVERY_PROOF":
        // Delivery proof jobs will be scheduled when proofs are submitted
        this.logger.log(`Delivery proof-based order ${escrowOrderId} - jobs will be scheduled when proofs are submitted`);
        break;

      case "AUTO_RELEASE":
        // Auto-release happens on delivery proof if enabled
        if (dto.autoReleaseOnProof) {
          this.logger.log(`Auto-release enabled for order ${escrowOrderId} - will process on delivery proof`);
        }
        break;
    }
  }

  /**
   * Submit a delivery proof and schedule processing job if auto-release is enabled
   * 
   * Sequence:
   * 1. Submit delivery proof on-chain (via contract)
   * 2. Store delivery proof in database
   * 3. Schedule processing job (which will execute settlement after status updates)
   */
  async submitDeliveryProof(dto: SubmitDeliveryProofDto): Promise<{
    id: string;
  }> {
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { id: dto.escrowOrderId },
      include: { paymentIntent: true },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found: ${dto.escrowOrderId}`,
        404,
      );
    }

    const submittedAt = BigInt(Math.floor(Date.now() / 1000)).toString();

    // Step 1: Submit delivery proof on-chain first
    let submitTxHash = dto.submitTxHash;
    if (escrowOrder.contractAddress && !submitTxHash) {
      try {
        const orderId = BigInt(escrowOrder.orderId);
        
        // Check order status before submitting - contract requires Created (0) to submit delivery proof
        // Lifecycle: Created (0) → Delivered (2) → AwaitingSettlement (3) → Completed (4)
        const orderState = await this.escrow.getOrderState(
          escrowOrder.contractAddress,
          orderId,
        );
        
        if (!orderState) {
          throw new Error(`Order state not found for orderId ${orderId}`);
        }
        
        // Contract requires status to be Created (0) to submit delivery proof
        // Delivery proof submission transitions order from Created (0) to Delivered (2)
        const orderStatusNum = Number(orderState.status);
        if (orderStatusNum !== 0) {
          throw new ApiException(
            "invalid_status",
            `Cannot submit delivery proof: order status is ${orderStatusNum}, must be Created (0). Order lifecycle: Created (0) → Delivered (2) → AwaitingSettlement (3) → Completed (4)`,
            400,
          );
        }
        
        this.logger.log(
          `Order status is ${orderStatusNum} (Created), proceeding with delivery proof submission`,
        );
        
        const result = await this.escrow.submitDeliveryProof(
          escrowOrder.contractAddress,
          orderId,
          dto.proofHash,
          dto.proofURI || "",
          dto.submittedBy,
        );
        submitTxHash = result.hash;
        this.logger.log(
          `Delivery proof submitted on-chain for order ${dto.escrowOrderId}, txHash: ${submitTxHash}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to submit delivery proof on-chain for order ${dto.escrowOrderId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Continue with database storage even if on-chain submission fails
        // This allows retry mechanisms to work
      }
    }

    // Step 2: Create delivery proof in database
    const deliveryProof = await this.prisma.deliveryProof.create({
      data: {
        escrowOrderId: dto.escrowOrderId,
        paymentIntentId: dto.paymentIntentId,
        proofHash: dto.proofHash,
        proofURI: dto.proofURI,
        submittedBy: dto.submittedBy,
        submittedAt,
        submitTxHash,
      },
    });

    // Update escrow order with actual delivery hash
    await this.prisma.escrowOrder.update({
      where: { id: dto.escrowOrderId },
      data: {
        actualDeliveryHash: dto.proofHash,
        orderStatus: "DELIVERED", // Update status to DELIVERED when proof is submitted
      },
    });

    this.logger.log(`Created delivery proof ${deliveryProof.id} for order ${dto.escrowOrderId}`);

    // Step 3: Schedule delivery proof processing job (will auto-release if enabled)
    // The job will wait for order status to update to AwaitingSettlement, then execute settlement
    await this.programmablePaymentQueue.scheduleDeliveryProofProcess(
      dto.escrowOrderId,
      dto.paymentIntentId,
      escrowOrder.merchantId,
      deliveryProof.id,
    );

    return {
      id: deliveryProof.id,
    };
  }

  /**
   * Raise a dispute and schedule timeout job
   */
  async raiseDispute(dto: RaiseDisputeDto): Promise<void> {
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { id: dto.escrowOrderId },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found: ${dto.escrowOrderId}`,
        404,
      );
    }

    const disputeRaisedAt = BigInt(Math.floor(Date.now() / 1000)).toString();
    const disputeWindow = dto.disputeWindow || escrowOrder.disputeWindow || "604800"; // Default 7 days

    // Update escrow order with dispute information
    await this.prisma.escrowOrder.update({
      where: { id: dto.escrowOrderId },
      data: {
        orderStatus: "DISPUTED",
        disputeRaisedAt,
        disputeReason: dto.reason,
        disputeRaisedBy: dto.raisedBy,
        disputeWindow,
      },
    });

    this.logger.log(`Dispute raised for order ${dto.escrowOrderId}: ${dto.reason}`);

    // Schedule dispute timeout job
    await this.programmablePaymentQueue.scheduleDisputeTimeout(
      dto.escrowOrderId,
      dto.paymentIntentId,
      dto.merchantId,
      disputeRaisedAt,
      disputeWindow,
    );
  }

  /**
   * Create a payment milestone
   */
  async createMilestone(dto: CreateMilestoneDto): Promise<{
    id: string;
  }> {
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { id: dto.escrowOrderId },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found: ${dto.escrowOrderId}`,
        404,
      );
    }

    if (escrowOrder.releaseType !== "MILESTONE_LOCKED") {
      throw new ApiException(
        "invalid_request",
        `Cannot create milestone for order with release type: ${escrowOrder.releaseType}`,
        400,
      );
    }

    // Create milestone
    const milestone = await this.prisma.paymentMilestone.create({
      data: {
        escrowOrderId: dto.escrowOrderId,
        paymentIntentId: dto.paymentIntentId,
        milestoneIndex: dto.milestoneIndex,
        description: dto.description,
        amount: dto.amount,
        percentage: dto.percentage,
        status: "PENDING",
      },
    });

    this.logger.log(`Created milestone ${milestone.id} (index ${dto.milestoneIndex}) for order ${dto.escrowOrderId}`);

    return {
      id: milestone.id,
    };
  }

  /**
   * Mark a milestone as completed and schedule release check
   */
  async completeMilestone(dto: CompleteMilestoneDto): Promise<void> {
    const milestone = await this.prisma.paymentMilestone.findUnique({
      where: { id: dto.milestoneId },
      include: { escrowOrder: true },
    });

    if (!milestone) {
      throw new ApiException(
        "resource_missing",
        `Milestone not found: ${dto.milestoneId}`,
        404,
      );
    }

    if (milestone.status === "RELEASED") {
      this.logger.warn(`Milestone ${dto.milestoneId} already released`);
      return;
    }

    const completedAt = BigInt(Math.floor(Date.now() / 1000)).toString();

    // Update milestone to completed
    await this.prisma.paymentMilestone.update({
      where: { id: dto.milestoneId },
      data: {
        status: "COMPLETED",
        completedAt,
        completedBy: dto.completedBy,
        completionProof: dto.completionProof,
        completionProofURI: dto.completionProofURI,
      },
    });

    this.logger.log(`Marked milestone ${dto.milestoneId} as completed`);

    // Schedule milestone check job to release funds
    await this.programmablePaymentQueue.scheduleMilestoneCheck(
      dto.escrowOrderId,
      dto.paymentIntentId,
      dto.merchantId,
      dto.milestoneId,
    );
  }
}

