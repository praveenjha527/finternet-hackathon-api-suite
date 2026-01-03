import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiParam, ApiTags, ApiSecurity } from "@nestjs/swagger";
import { PaymentsService } from "./payments.service";
import type { ApiResponse } from "../../common/responses";
import { CreatePaymentIntentDto } from "./dto/create-payment-intent.dto";
import { ConfirmPaymentIntentDto } from "./dto/confirm-payment-intent.dto";
import { SubmitDeliveryProofDto } from "./dto/submit-delivery-proof.dto";
import { RaiseDisputeDto } from "./dto/raise-dispute.dto";
import { CreateMilestoneDto } from "./dto/create-milestone.dto";
import { CompleteMilestoneDto } from "./dto/complete-milestone.dto";
import type { PaymentIntentEntity } from "./entities/payment-intent.entity";
import { CurrentMerchant } from "../auth/decorators/current-merchant.decorator";
import { Public } from "../auth/guards/api-key.guard";

type Merchant = {
  id: string;
  name: string;
  apiKey: string;
  isActive: boolean;
};

@ApiTags("payment-intents")
@ApiSecurity("ApiKeyAuth")
@Controller("payment-intents")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  async createPaymentIntent(
    @Body() dto: CreatePaymentIntentDto,
    @CurrentMerchant() merchant: Merchant,
  ): Promise<ApiResponse<PaymentIntentEntity>> {
    const intent = await this.paymentsService.createIntent(dto, merchant.id);
    return {
      id: intent.id,
      object: "payment_intent",
      status: intent.status,
      data: intent,
      metadata: dto.metadata,
      created: intent.created,
      updated: intent.updated,
    };
  }

  /**
   * Public endpoint for fetching payment intent (for frontend wallet interface).
   * This endpoint does not require API key authentication.
   * Returns payment intent data needed for wallet connection and transaction execution.
   * 
   * IMPORTANT: This route must be defined BEFORE the :intentId route to avoid routing conflicts.
   */
  @Public()
  @ApiParam({ name: "intentId" })
  @Get("public/:intentId")
  async getPublicPaymentIntent(
    @Param("intentId") intentId: string,
  ): Promise<ApiResponse<PaymentIntentEntity>> {
    const intent = await this.paymentsService.getPublicIntent(intentId);
    return {
      id: intent.id,
      object: "payment_intent",
      status: intent.status,
      data: intent,
      created: intent.created,
      updated: intent.updated,
    };
  }

  @ApiParam({ name: "intentId" })
  @Get(":intentId")
  async getPaymentIntent(
    @Param("intentId") intentId: string,
    @CurrentMerchant() merchant: Merchant,
  ): Promise<ApiResponse<PaymentIntentEntity>> {
    const intent = await this.paymentsService.getIntent(intentId, merchant.id);
    return {
      id: intent.id,
      object: "payment_intent",
      status: intent.status,
      data: intent,
      created: intent.created,
      updated: intent.updated,
    };
  }

  @ApiParam({ name: "intentId" })
  @Post(":intentId/confirm")
  @HttpCode(200)
  async confirmPaymentIntent(
    @Param("intentId") intentId: string,
    @Body() dto: ConfirmPaymentIntentDto,
    @CurrentMerchant() merchant: Merchant,
  ): Promise<ApiResponse<PaymentIntentEntity>> {
    const intent = await this.paymentsService.confirmIntent(
      intentId,
      dto,
      merchant.id,
    );
    return {
      id: intent.id,
      object: "payment_intent",
      status: intent.status,
      data: intent,
      created: intent.created,
      updated: intent.updated,
    };
  }

  /**
   * Get escrow order for a payment intent
   */
  @ApiParam({ name: "intentId" })
  @Get(":intentId/escrow")
  async getEscrowOrder(
    @Param("intentId") intentId: string,
    @CurrentMerchant() merchant: Merchant,
  ) {
    const escrowOrder = await this.paymentsService.getEscrowOrder(intentId, merchant.id);
    return {
      id: escrowOrder.id,
      object: "escrow_order",
      data: escrowOrder,
    };
  }

  /**
   * Submit delivery proof for an escrow order
   */
  @ApiParam({ name: "intentId" })
  @Post(":intentId/escrow/delivery-proof")
  @HttpCode(200)
  async submitDeliveryProof(
    @Param("intentId") intentId: string,
    @Body() dto: SubmitDeliveryProofDto,
    @CurrentMerchant() merchant: Merchant,
  ) {
    const result = await this.paymentsService.submitDeliveryProof(
      intentId,
      dto,
      merchant.id,
    );
    return {
      id: result.id,
      object: "delivery_proof",
      data: result,
    };
  }

  /**
   * Raise a dispute for an escrow order
   */
  @ApiParam({ name: "intentId" })
  @Post(":intentId/escrow/dispute")
  @HttpCode(200)
  async raiseDispute(
    @Param("intentId") intentId: string,
    @Body() dto: RaiseDisputeDto,
    @CurrentMerchant() merchant: Merchant,
  ) {
    await this.paymentsService.raiseDispute(intentId, dto, merchant.id);
    return {
      object: "dispute",
      status: "raised",
    };
  }

  /**
   * Create a milestone for a milestone-based escrow order
   */
  @ApiParam({ name: "intentId" })
  @Post(":intentId/escrow/milestones")
  @HttpCode(201)
  async createMilestone(
    @Param("intentId") intentId: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentMerchant() merchant: Merchant,
  ) {
    const result = await this.paymentsService.createMilestone(
      intentId,
      dto,
      merchant.id,
    );
    return {
      id: result.id,
      object: "milestone",
      data: result,
    };
  }

  /**
   * Complete a milestone for a milestone-based escrow order
   */
  @ApiParam({ name: "intentId" })
  @ApiParam({ name: "milestoneId" })
  @Post(":intentId/escrow/milestones/:milestoneId/complete")
  @HttpCode(200)
  async completeMilestone(
    @Param("intentId") intentId: string,
    @Param("milestoneId") milestoneId: string,
    @Body() dto: CompleteMilestoneDto,
    @CurrentMerchant() merchant: Merchant,
  ) {
    await this.paymentsService.completeMilestone(
      intentId,
      milestoneId,
      dto,
      merchant.id,
    );
    return {
      object: "milestone",
      status: "completed",
    };
  }
}
