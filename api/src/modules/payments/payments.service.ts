import { Injectable } from "@nestjs/common";
import { CreatePaymentIntentDto } from "./dto/create-payment-intent.dto";
import { ConfirmPaymentIntentDto } from "./dto/confirm-payment-intent.dto";
import { SubmitDeliveryProofDto } from "./dto/submit-delivery-proof.dto";
import { RaiseDisputeDto } from "./dto/raise-dispute.dto";
import { CreateMilestoneDto } from "./dto/create-milestone.dto";
import { CompleteMilestoneDto } from "./dto/complete-milestone.dto";
import { ProcessPaymentDto } from "./dto/process-payment.dto";
import type { PaymentIntentEntity } from "./entities/payment-intent.entity";
import { IntentService } from "./services/intent.service";
import { EscrowOrderService } from "./services/escrow-order.service";
import { EscrowService } from "./services/escrow.service";
import { PaymentProcessorService } from "./services/payment-processor.service";
import { OnRampService } from "./services/on-ramp.service";
import { FiatAccountService } from "./services/fiat-account.service";
import { LedgerService } from "./services/ledger.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ApiException } from "../../common/exceptions";
import type { FiatAccountBalance } from "./services/fiat-account.service";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly intentService: IntentService,
    private readonly escrowOrderService: EscrowOrderService,
    private readonly escrowService: EscrowService,
    private readonly paymentProcessor: PaymentProcessorService,
    private readonly onRamp: OnRampService,
    private readonly fiatAccountService: FiatAccountService,
    private readonly ledgerService: LedgerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get merchant fiat account balance (available, pending, reserved, total).
   */
  async getBalance(merchantId: string): Promise<FiatAccountBalance> {
    return this.fiatAccountService.getBalance(merchantId);
  }

  /**
   * Get ledger entries for the merchant's fiat account.
   */
  async getLedgerEntries(
    merchantId: string,
    options?: {
      limit?: number;
      offset?: number;
      transactionType?: string;
      paymentIntentId?: string;
    },
  ) {
    return this.ledgerService.getLedgerEntries(merchantId, options);
  }

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
   * Process payment with card details (Web2 payment flow).
   * Public endpoint - users can pay without API key authentication.
   * 
   * Flow:
   * 1. Process fiat payment (payment processor)
   * 2. On-ramp: Convert fiat → stablecoins (mocked)
   * 3. Create escrow order (after on-ramp)
   */
  async processPayment(
    intentId: string,
    dto: ProcessPaymentDto,
  ): Promise<PaymentIntentEntity> {
    // Get payment intent
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

    // Validate card details
    const validation = this.paymentProcessor.validateCardDetails(dto.card);
    if (!validation.valid) {
      throw new ApiException(
        "invalid_request_error",
        validation.error || "Invalid card details",
        400,
      );
    }

    // Step 1: Process payment via payment processor (mocked)
    const paymentResult = await this.paymentProcessor.processPayment(
      intentId,
      intent.amount,
      intent.currency,
      dto.card,
    );

    if (!paymentResult.success) {
      // Update payment intent with failed status
      await this.prisma.paymentIntent.update({
        where: { id: intentId },
        data: {
          fiatPaymentStatus: "failed",
          paymentProcessorType: "mocked_stripe",
          paymentProcessorTxId: paymentResult.transactionId,
        },
      });

      throw new ApiException(
        "payment_failed",
        paymentResult.error || "Payment processing failed",
        400,
      );
    }

    // Step 2: On-ramp - Convert fiat → stablecoins (mocked)
    // Determine stablecoin currency (default to USDC if currency is USD)
    const stablecoinCurrency =
      intent.currency === "USD" ? "USDC" : intent.currency;

    const onRampResult = await this.onRamp.convertFiatToStablecoins(
      intent.amount,
      intent.currency,
      stablecoinCurrency,
    );

    if (!onRampResult.success) {
      // Update payment intent with on-ramp failed status
      await this.prisma.paymentIntent.update({
        where: { id: intentId },
        data: {
          fiatPaymentStatus: "succeeded",
          paymentProcessorType: "mocked_stripe",
          paymentProcessorTxId: paymentResult.transactionId,
          fiatPaymentConfirmedAt: new Date(),
          onRampStatus: "failed",
          onRampTxId: onRampResult.transactionId,
        },
      });

      throw new ApiException(
        "on_ramp_failed",
        onRampResult.error || "On-ramp processing failed",
        500,
      );
    }

    // Update payment intent with successful payment and on-ramp
    const updatedIntent = await this.prisma.paymentIntent.update({
      where: { id: intentId },
      data: {
        fiatPaymentStatus: "succeeded",
        paymentProcessorType: "mocked_stripe",
        paymentProcessorTxId: paymentResult.transactionId,
        fiatPaymentConfirmedAt: new Date(),
        onRampStatus: "completed",
        onRampTxId: onRampResult.transactionId,
        onRampCompletedAt: new Date(),
        stablecoinAmount: onRampResult.stablecoinAmount,
        stablecoinCurrency: onRampResult.stablecoinCurrency,
        status: "PROCESSING", // Transition to PROCESSING as on-ramp is complete
      },
      include: {
        merchant: true,
      },
    });

    // Step 3: Create escrow order (if payment type is DELIVERY_VS_PAYMENT)
    // This will transition from PAYMENT_CONFIRMED to PROCESSING when escrow is created
    if (updatedIntent.type === "DELIVERY_VS_PAYMENT") {
      try {
        await this.createEscrowOrderForWeb2Payment(intentId, updatedIntent);
      } catch (error) {
        // Log error but don't fail the payment - escrow creation can be retried
        console.error(`Failed to create escrow order for payment intent ${intentId}:`, error);
        // In production, you might want to queue this for retry
      }
    }

    return this.intentService.getPublicIntent(intentId);
  }

  /**
   * Create escrow order for Web2 payment flow.
   * This method deposits stablecoins into escrow and creates the order.
   * When SKIP_CHAIN_ESCROW=true (e.g. local dev), creates DB escrow only with mock tx hash so milestones work.
   */
  private async createEscrowOrderForWeb2Payment(
    intentId: string,
    paymentIntent: any,
  ): Promise<void> {
    const metadata = (paymentIntent.metadata as Record<string, unknown>) || {};
    const merchantId = (paymentIntent as any).merchantId;
    const skipChain = process.env.SKIP_CHAIN_ESCROW === "true";

    // Get merchant details
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new ApiException(
        "resource_missing",
        `Merchant not found: ${merchantId}`,
        404,
      );
    }

    // Extract escrow parameters from metadata
    const deliveryPeriod = (metadata.deliveryPeriod as number) || 2592000; // Default 30 days
    const expectedDeliveryHash =
      (metadata.expectedDeliveryHash as string) ||
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    const autoRelease = (metadata.autoRelease as boolean) ?? false;
    const deliveryOracle =
      (metadata.deliveryOracle as string) ||
      "0x0000000000000000000000000000000000000000";
    const tokenAddress =
      (metadata.tokenAddress as string) ||
      process.env.TOKEN_ADDRESS ||
      "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";

    const contractAddress =
      paymentIntent.contractAddress ||
      (merchant as any).dvpContractAddress ||
      process.env.DvP_CONTRACT_ADDRESS ||
      (skipChain ? "0x0000000000000000000000000000000000000000" : null);

    if (!contractAddress && !skipChain) {
      throw new ApiException(
        "configuration_error",
        "Escrow contract address not found",
        500,
      );
    }

    let buyerAddress: string;
    if (skipChain && !process.env.PRIVATE_KEY) {
      buyerAddress = "0x5D478B369769183F05b70bb7a609751c419b4c04";
    } else if (process.env.PRIVATE_KEY) {
      const { Wallet } = await import("ethers");
      buyerAddress = new Wallet(process.env.PRIVATE_KEY).address;
    } else {
      throw new ApiException(
        "configuration_error",
        "System wallet not configured (PRIVATE_KEY not set). Set SKIP_CHAIN_ESCROW=true for dev without chain.",
        500,
      );
    }

    // Get order ID (needed for DB escrow)
    const orderId = await this.escrowService.getOrderIdForIntent(intentId);

    // Determine release type
    const releaseType:
      | "TIME_LOCKED"
      | "MILESTONE_LOCKED"
      | "DELIVERY_PROOF"
      | "AUTO_RELEASE" =
      (metadata.releaseType as string) === "TIME_LOCKED"
        ? "TIME_LOCKED"
        : (metadata.releaseType as string) === "MILESTONE_LOCKED"
          ? "MILESTONE_LOCKED"
          : autoRelease
            ? "AUTO_RELEASE"
            : "DELIVERY_PROOF";

    const now = Math.floor(Date.now() / 1000);
    const deliveryDeadline = BigInt(now + deliveryPeriod).toString();
    const stablecoinAmount = paymentIntent.stablecoinAmount || paymentIntent.amount;

    const createEscrowDb = (createTxHash: string) =>
      this.escrowOrderService.createEscrowOrder({
        paymentIntentId: intentId,
        merchantId,
        contractAddress: contractAddress!,
        buyerAddress,
        tokenAddress,
        amount: stablecoinAmount,
        deliveryPeriod,
        deliveryDeadline,
        expectedDeliveryHash,
        autoReleaseOnProof: autoRelease,
        deliveryOracle,
        releaseType,
        createTxHash,
        timeLockUntil:
          releaseType === "TIME_LOCKED" && metadata.timeLockUntil
            ? (metadata.timeLockUntil as string)
            : undefined,
        disputeWindow: metadata.disputeWindow
          ? (metadata.disputeWindow as string)
          : "604800",
      });

    if (skipChain) {
      await createEscrowDb("0xdev-skip-chain");
      return;
    }

    const contractMerchantId = await this.escrowService.getContractMerchantId(
      merchantId,
    );
    const stablecoinDecimals = 6;

    try {
      const depositResult = await this.escrowService.depositAndCreateOrder({
        merchantId: contractMerchantId,
        orderId,
        buyer: buyerAddress,
        tokenAddress,
        amount: stablecoinAmount,
        decimals: stablecoinDecimals,
        deliveryPeriod,
        expectedDeliveryHash,
        autoRelease,
        deliveryOracle,
        contractAddress: contractAddress!,
      });
      await createEscrowDb(depositResult.hash);
    } catch (error) {
      // Always create escrow order in DB when blockchain fails so milestones/delivery proof can proceed
      await createEscrowDb("0xescrow-created-offchain");
    }
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
