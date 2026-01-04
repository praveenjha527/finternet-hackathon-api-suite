import { Injectable } from "@nestjs/common";
import { CreatePaymentIntentDto } from "./dto/create-payment-intent.dto";
import { ConfirmPaymentIntentDto } from "./dto/confirm-payment-intent.dto";
import { SubmitDeliveryProofDto } from "./dto/submit-delivery-proof.dto";
import { RaiseDisputeDto } from "./dto/raise-dispute.dto";
import { CreateMilestoneDto } from "./dto/create-milestone.dto";
import { CompleteMilestoneDto } from "./dto/complete-milestone.dto";
import type { PaymentIntentEntity } from "./entities/payment-intent.entity";
import { IntentService } from "./services/intent.service";
import { EscrowOrderService } from "./services/escrow-order.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ApiException } from "../../common/exceptions";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly intentService: IntentService,
    private readonly escrowOrderService: EscrowOrderService,
    private readonly prisma: PrismaService,
  ) {}

  async createIntent(
    dto: CreatePaymentIntentDto,
    merchantId: string,
  ): Promise<PaymentIntentEntity> {
    return this.intentService.createIntent(dto, merchantId);
  }

  async confirmIntent(
    intentId: string,
    dto: ConfirmPaymentIntentDto,
    merchantId: string,
  ): Promise<PaymentIntentEntity> {
    return this.intentService.confirmIntent(
      intentId,
      dto.signature,
      dto.payerAddress,
      merchantId,
    );
  }

  async getIntent(
    intentId: string,
    merchantId: string,
  ): Promise<PaymentIntentEntity> {
    return this.intentService.getIntent(intentId, merchantId);
  }

  /**
   * Get payment intent without merchant authentication (public endpoint).
   * Used by the frontend payment page to fetch payment details.
   */
  async getPublicIntent(intentId: string): Promise<PaymentIntentEntity> {
    return this.intentService.getPublicIntent(intentId);
  }

  /**
   * Update payment intent with transaction hash (public endpoint).
   * Called by frontend after contract execution.
   */
  async updateTransactionHash(
    intentId: string,
    transactionHash: string,
  ): Promise<PaymentIntentEntity> {
    return this.intentService.updateTransactionHash(intentId, transactionHash);
  }

  /**
   * Get escrow order for a payment intent
   */
  async getEscrowOrder(intentId: string, merchantId: string) {
    // Verify payment intent exists and belongs to merchant
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) {
      throw new ApiException(
        "resource_missing",
        `Payment intent not found: ${intentId}`,
        404,
      );
    }

    if ((intent as any).merchantId !== merchantId) {
      throw new ApiException(
        "forbidden",
        "You do not have permission to access this payment intent",
        403,
      );
    }

    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { paymentIntentId: intentId },
      include: {
        deliveryProofs: true,
        milestones: true,
        settlementExecution: true,
      },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found for payment intent: ${intentId}`,
        404,
      );
    }

    return escrowOrder;
  }

  /**
   * Submit delivery proof for an escrow order
   */
  async submitDeliveryProof(
    intentId: string,
    dto: SubmitDeliveryProofDto,
    merchantId: string,
  ) {
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { paymentIntentId: intentId },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found for payment intent: ${intentId}`,
        404,
      );
    }

    if (escrowOrder.merchantId !== merchantId) {
      throw new ApiException(
        "forbidden",
        "You do not have permission to access this escrow order",
        403,
      );
    }

    return this.escrowOrderService.submitDeliveryProof({
      escrowOrderId: escrowOrder.id,
      paymentIntentId: intentId,
      proofHash: dto.proofHash,
      proofURI: dto.proofURI,
      submittedBy: dto.submittedBy,
      submitTxHash: dto.submitTxHash,
    });
  }

  /**
   * Raise a dispute for an escrow order
   */
  async raiseDispute(
    intentId: string,
    dto: RaiseDisputeDto,
    merchantId: string,
  ) {
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { paymentIntentId: intentId },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found for payment intent: ${intentId}`,
        404,
      );
    }

    if (escrowOrder.merchantId !== merchantId) {
      throw new ApiException(
        "forbidden",
        "You do not have permission to access this escrow order",
        403,
      );
    }

    return this.escrowOrderService.raiseDispute({
      escrowOrderId: escrowOrder.id,
      paymentIntentId: intentId,
      merchantId,
      reason: dto.reason,
      raisedBy: dto.raisedBy,
      disputeWindow: dto.disputeWindow,
    });
  }

  /**
   * Create a milestone for a milestone-based escrow order
   */
  async createMilestone(
    intentId: string,
    dto: CreateMilestoneDto,
    merchantId: string,
  ) {
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { paymentIntentId: intentId },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found for payment intent: ${intentId}`,
        404,
      );
    }

    if (escrowOrder.merchantId !== merchantId) {
      throw new ApiException(
        "forbidden",
        "You do not have permission to access this escrow order",
        403,
      );
    }

    return this.escrowOrderService.createMilestone({
      escrowOrderId: escrowOrder.id,
      paymentIntentId: intentId,
      milestoneIndex: dto.milestoneIndex,
      description: dto.description,
      amount: dto.amount,
      percentage: dto.percentage,
    });
  }

  /**
   * Complete a milestone for a milestone-based escrow order
   */
  async completeMilestone(
    intentId: string,
    milestoneId: string,
    dto: CompleteMilestoneDto,
    merchantId: string,
  ) {
    const escrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { paymentIntentId: intentId },
    });

    if (!escrowOrder) {
      throw new ApiException(
        "resource_missing",
        `Escrow order not found for payment intent: ${intentId}`,
        404,
      );
    }

    if (escrowOrder.merchantId !== merchantId) {
      throw new ApiException(
        "forbidden",
        "You do not have permission to access this escrow order",
        403,
      );
    }

    return this.escrowOrderService.completeMilestone({
      milestoneId,
      escrowOrderId: escrowOrder.id,
      paymentIntentId: intentId,
      merchantId,
      completionProof: dto.completionProof,
      completionProofURI: dto.completionProofURI,
      completedBy: dto.completedBy,
    });
  }
}
