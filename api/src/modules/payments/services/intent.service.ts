import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isAddress, verifyTypedData } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { PrismaService } from "../../../prisma/prisma.service";
import { ApiException } from "../../../common/exceptions";
import { buildPaymentIntentTypedData } from "../../../schema/eip712.schema";
import { CreatePaymentIntentDto } from "../dto/create-payment-intent.dto";
import {
  PaymentIntentEntity,
  PaymentIntentPhase,
  PaymentIntentStatus,
  SettlementStatus,
} from "../entities/payment-intent.entity";
import { RoutingService } from "./routing.service";
import { BlockchainService } from "./blockchain.service";
import { ComplianceService } from "./compliance.service";
import { SettlementService } from "./settlement.service";
import { AuditService } from "./audit.service";
import { PaymentStateMachineService } from "./payment-state-machine.service";
import { PaymentEventService } from "./payment-event.service";
import { SettlementQueueService } from "../queues/settlement-queue.service";
import { TransactionConfirmationQueueService } from "../queues/transaction-confirmation-queue.service";
import { LedgerService } from "./ledger.service";
import { EscrowService } from "./escrow.service";
import { EscrowOrderService } from "./escrow-order.service";

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_DECIMALS = 6; // USDC

function toUnixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function asObjectRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly blockchain: BlockchainService,
    private readonly compliance: ComplianceService,
    private readonly settlement: SettlementService,
    private readonly audit: AuditService,
    private readonly stateMachine: PaymentStateMachineService,
    private readonly events: PaymentEventService,
    private readonly settlementQueue: SettlementQueueService,
    private readonly transactionConfirmationQueue: TransactionConfirmationQueueService,
    private readonly ledger: LedgerService,
    private readonly escrow: EscrowService,
    private readonly escrowOrder: EscrowOrderService,
  ) {}

  async createIntent(
    dto: CreatePaymentIntentDto,
    merchantId: string,
  ): Promise<PaymentIntentEntity> {
    this.routing.validateSettlementMethod(dto.settlementMethod);
    await this.compliance.validateIntent();

    const id = `intent_${uuidv4()}`;
    const chainId = SEPOLIA_CHAIN_ID;

    // Get merchant to retrieve contract addresses and contractMerchantId
    const merchant = (await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    })) as {
      dvpContractAddress: string | null;
      consentedPullContractAddress: string | null;
      contractMerchantId: string | null;
    } | null;

    if (!merchant) {
      throw new ApiException(
        "resource_missing",
        `Merchant not found: ${merchantId}`,
        404,
      );
    }

    const contractAddress = this.getContractAddressForType(dto.type, {
      dvpContractAddress: merchant.dvpContractAddress,
      consentedPullContractAddress: merchant.consentedPullContractAddress,
    });
    const typedData = buildPaymentIntentTypedData({
      intentId: id,
      amount: dto.amount,
      decimals: DEFAULT_DECIMALS,
      chainId,
      verifyingContract: contractAddress,
      nonce: 0,
    });

    const phases: PaymentIntentPhase[] = [
      { phase: "SIGNATURE_VERIFICATION", status: "IN_PROGRESS" },
    ];

    const created = await this.prisma.paymentIntent.create({
      data: {
        id,
        merchantId,
        status: PaymentIntentStatus.INITIATED,
        amount: dto.amount,
        currency: dto.currency,
        type: dto.type,
        description: dto.description ?? null,
        settlementMethod: dto.settlementMethod,
        settlementDestination: dto.settlementDestination,
        settlementStatus: SettlementStatus.PENDING,
        contractAddress,
        chainId,
        typedData,
        phases,
        metadata: (() => {
          // Build metadata with escrow fields for DELIVERY_VS_PAYMENT type
          const metadata: Record<string, unknown> = dto.metadata || {};
          if (dto.type === "DELIVERY_VS_PAYMENT") {
            // Add escrow-specific fields to metadata
            if (dto.deliveryPeriod !== undefined) {
              metadata.deliveryPeriod = dto.deliveryPeriod;
            }
            if (dto.expectedDeliveryHash) {
              metadata.expectedDeliveryHash = dto.expectedDeliveryHash;
            }
            if (dto.autoRelease !== undefined) {
              metadata.autoRelease = dto.autoRelease;
            }
            if (dto.deliveryOracle) {
              metadata.deliveryOracle = dto.deliveryOracle;
            }
            // Add token address (USDC on Sepolia by default)
            metadata.tokenAddress =
              process.env.TOKEN_ADDRESS || "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";
            // Add contractMerchantId for frontend to use when calling createOrder
            if (merchant.contractMerchantId) {
              metadata.contractMerchantId = merchant.contractMerchantId;
            }
          }
          return Object.keys(metadata).length > 0
            ? (metadata as unknown as Prisma.InputJsonValue)
            : undefined;
        })(),
      } as any, // Type assertion - will be valid after Prisma Client regeneration with merchantId field
    });

    // Log payment intent creation
    await this.audit.logIntentCreated({
      paymentIntentId: created.id,
      merchantId,
      amount: created.amount,
      currency: created.currency,
      type: created.type,
      settlementMethod: created.settlementMethod,
      settlementDestination: created.settlementDestination,
    });

    // Emit payment intent created event
    await this.events.emitCreated({
      paymentIntentId: created.id,
      merchantId,
      status: PaymentIntentStatus.INITIATED,
      amount: created.amount,
      currency: created.currency,
      settlementMethod: created.settlementMethod,
      settlementDestination: created.settlementDestination,
      metadata: dto.metadata,
    });

    const estimates = this.routing.getRouteEstimates();

    // Generate wallet connection URL for user to execute payment
    const paymentUrl = this.generatePaymentUrl(created.id);

    return {
      id: created.id,
      object: "payment_intent",
      status: created.status as PaymentIntentStatus,
      amount: created.amount,
      currency: created.currency,
      type: created.type,
      description: created.description,
      settlementMethod: created.settlementMethod,
      settlementDestination: created.settlementDestination,
      settlementStatus: created.settlementStatus as SettlementStatus,
      contractAddress: created.contractAddress,
      chainId: created.chainId,
      typedData: created.typedData,
      phases: (created.phases as PaymentIntentPhase[] | null) ?? null,
      metadata: asObjectRecord(created.metadata),
      paymentUrl,
      created: toUnixSeconds(created.createdAt),
      updated: toUnixSeconds(created.updatedAt),
      ...(estimates ? estimates : {}),
    };
  }

  async confirmIntent(
    intentId: string,
    signature: string,
    payerAddress: string,
    merchantId: string,
  ) {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });
    if (!existing) {
      throw new ApiException(
        "resource_missing",
        `Payment intent not found: ${intentId}`,
        404,
      );
    }

    // Authorization: verify merchant owns this payment intent
    if ((existing as any).merchantId !== merchantId) {
      throw new ApiException(
        "forbidden",
        "You do not have permission to access this payment intent",
        403,
      );
    }

    // Use state machine to validate transition
    const currentStatus = existing.status as PaymentIntentStatus;
    const targetStatus = PaymentIntentStatus.PROCESSING;

    // Validate state transition
    this.stateMachine.transition(currentStatus, targetStatus, {
      reason: "Signature verified, moving to processing",
    });

    const typedData = existing.typedData as unknown as {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      message: Record<string, unknown>;
    };

    // ethers v6 expects `types` WITHOUT EIP712Domain
    // (domain is passed separately as the first argument).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { EIP712Domain, ...primaryTypes } = typedData.types;

    const recovered = verifyTypedData(
      typedData.domain as never,
      primaryTypes as never,
      typedData.message as never,
      signature,
    );

    if (recovered.toLowerCase() !== payerAddress.toLowerCase()) {
      throw new ApiException(
        "signature_verification_failed",
        "Signature does not match payer address",
        400,
        "signature",
      );
    }

    const phases = (existing.phases as PaymentIntentPhase[] | null) ?? [];
    const now = Math.floor(Date.now() / 1000);

    const updatedPhases: PaymentIntentPhase[] = [
      ...phases.filter((p) => p.phase !== "SIGNATURE_VERIFICATION"),
      { phase: "SIGNATURE_VERIFICATION", status: "COMPLETED", timestamp: now },
      { phase: "BLOCKCHAIN_CONFIRMATION", status: "IN_PROGRESS" },
    ];

    // Note: Contract execution happens on the frontend widget.
    // This endpoint only verifies the EIP-712 signature and stores it.
    // The frontend will execute createOrder() or initiatePull() directly on the contract.
    // The backend will detect the transaction via polling (in getIntent) or event listeners.

    // If transactionHash is provided (from frontend after contract execution), store it
    const updateData: any = {
      status: targetStatus, // PROCESSING - waiting for blockchain transaction
      signature,
      signerAddress: payerAddress,
      phases: updatedPhases,
    };

    // Note: transactionHash can be provided in the DTO if the frontend executes the contract
    // before calling confirmIntent, or it can be updated later via a separate endpoint
    // For now, we'll handle it in a separate updateTransactionHash method

    const saved = await this.prisma.paymentIntent.update({
      where: { id: existing.id },
      data: updateData,
    });

    // Log signature verification (not transaction submission - that happens on frontend)
    await this.audit.log({
      paymentIntentId: saved.id,
      merchantId,
      eventType: "SIGNATURE_VERIFIED",
      category: "AUTHORIZATION",
      amount: saved.amount,
      currency: saved.currency,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      phase: "SIGNATURE_VERIFICATION",
      phaseStatus: "COMPLETED",
      actorType: "PAYER",
      actorId: payerAddress,
      metadata: {
        signature,
        payerAddress,
      },
    });

    // Emit status changed event
    await this.events.emitStatusChanged({
      paymentIntentId: saved.id,
      merchantId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      amount: saved.amount,
      currency: saved.currency,
      reason: "Signature verified - waiting for contract execution",
    });

    return this.toEntity(saved);
  }

  /**
   * Update payment intent with transaction hash (public endpoint).
   * Called by frontend after contract execution to notify backend of the transaction.
   */
  async updateTransactionHash(
    intentId: string,
    transactionHash: string,
  ): Promise<PaymentIntentEntity> {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!existing) {
      throw new ApiException(
        "resource_missing",
        `Payment intent not found: ${intentId}`,
        404,
      );
    }

    // Update transaction hash and status if needed
    // If status is still INITIATED, update to PROCESSING since we have a transaction hash
    const updateData: any = {
      transactionHash,
    };

    // If status is INITIATED, update to PROCESSING since we have a transaction hash
    // This handles the case where the frontend posts transaction hash before calling confirmIntent
    if (existing.status === PaymentIntentStatus.INITIATED) {
      this.logger.log(
        `Payment intent ${intentId} is INITIATED but has transaction hash - updating to PROCESSING`,
      );
      updateData.status = PaymentIntentStatus.PROCESSING;
      
      // Update phases to reflect blockchain confirmation in progress
      const phases = (existing.phases as PaymentIntentPhase[] | null) ?? [];
      const now = Math.floor(Date.now() / 1000);
      const updatedPhases: PaymentIntentPhase[] = [
        ...phases.filter((p) => p.phase !== "BLOCKCHAIN_CONFIRMATION"),
        { phase: "BLOCKCHAIN_CONFIRMATION", status: "IN_PROGRESS", timestamp: now },
      ];
      updateData.phases = updatedPhases;
    }

    const saved = await this.prisma.paymentIntent.update({
      where: { id: existing.id },
      data: updateData,
    });

    // Log blockchain transaction submission
    await this.audit.logBlockchainTxSubmitted({
      paymentIntentId: saved.id,
      merchantId: (existing as any).merchantId,
      amount: saved.amount,
      currency: saved.currency,
      transactionHash,
      contractAddress: saved.contractAddress || "0x0000000000000000000000000000000000000000",
      chainId: saved.chainId || 11155111,
      payerAddress: saved.signerAddress || "0x0000000000000000000000000000000000000000",
    });

    // Emit blockchain transaction submitted event
    await this.events.emitBlockchainTxSubmitted({
      paymentIntentId: saved.id,
      merchantId: (existing as any).merchantId,
      status: saved.status as PaymentIntentStatus,
      amount: saved.amount,
      currency: saved.currency,
      transactionHash,
      contractAddress: saved.contractAddress || "0x0000000000000000000000000000000000000000",
      chainId: saved.chainId || 11155111,
      payerAddress: saved.signerAddress || "0x0000000000000000000000000000000000000000",
    });

    // Create escrow order if needed (for DELIVERY_VS_PAYMENT type)
    // This should be created when transaction hash is set, regardless of confirmation status
    if (saved.type === "DELIVERY_VS_PAYMENT") {
      try {
        await this.createEscrowOrderIfNeeded(saved);
        this.logger.log(
          `Escrow order created/verified for payment intent ${saved.id}`,
        );
      } catch (error) {
        // Log error but don't fail the transaction hash update
        // Escrow order creation failure shouldn't prevent confirmation checking
        this.logger.error(
          `Failed to create escrow order for payment intent ${saved.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // Enqueue job to check transaction confirmations and update status asynchronously
    // This moves the confirmation checking to a queue-based processor
    // IMPORTANT: Enqueue if status is PROCESSING or if we just updated it to PROCESSING
    // We should always enqueue when we have a transaction hash, regardless of initial status
    const finalStatus = saved.status as PaymentIntentStatus;
    if (
      finalStatus === PaymentIntentStatus.PROCESSING ||
      finalStatus === PaymentIntentStatus.INITIATED
    ) {
      try {
        this.logger.log(
          `Enqueuing transaction confirmation check for payment intent ${saved.id} with transaction hash ${transactionHash} (status: ${finalStatus})`,
        );
        await this.transactionConfirmationQueue.enqueueConfirmationCheck(
          saved.id,
          (existing as any).merchantId,
          transactionHash,
        );
        this.logger.log(
          `✅ Successfully enqueued transaction confirmation check job for payment intent ${saved.id}`,
        );
      } catch (error) {
        // Log error and re-throw to ensure the error is visible
        this.logger.error(
          `❌ Failed to enqueue transaction confirmation check for payment intent ${saved.id}:`,
          error instanceof Error ? error.message : String(error),
        );
        // Re-throw to ensure the error is visible
        throw new ApiException(
          "queue_error",
          `Failed to enqueue transaction confirmation check: ${error instanceof Error ? error.message : "Unknown error"}`,
          500,
        );
      }
    } else {
      this.logger.warn(
        `⚠️ Skipping confirmation check enqueue for payment intent ${saved.id} - status is ${finalStatus}, not PROCESSING or INITIATED`,
      );
    }

    return this.toEntity(saved);
  }

  async getIntent(
    intentId: string,
    merchantId: string,
  ): Promise<PaymentIntentEntity> {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });
    if (!existing) {
      throw new ApiException(
        "resource_missing",
        `Payment intent not found: ${intentId}`,
        404,
      );
    }

    // Authorization: verify merchant owns this payment intent
    if ((existing as any).merchantId !== merchantId) {
      throw new ApiException(
        "forbidden",
        "You do not have permission to access this payment intent",
        403,
      );
    }

    // If we have a tx hash and are still processing, opportunistically advance status after 5 confs.
    if (
      existing.status === PaymentIntentStatus.PROCESSING &&
      existing.transactionHash
    ) {
      // Check transaction receipt status instead of confirmations
      const receiptStatus = await this.blockchain.getTransactionReceiptStatus(
        existing.transactionHash,
      );
      if (receiptStatus === 'success') {
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

        const saved = await this.prisma.paymentIntent.update({
          where: { id: existing.id },
          data: {
            status: PaymentIntentStatus.SUCCEEDED,
            phases: updatedPhases,
            settlementStatus: SettlementStatus.IN_PROGRESS,
          },
        });

        // Log blockchain transaction confirmation
        await this.audit.logBlockchainTxConfirmed({
          paymentIntentId: saved.id,
          merchantId,
          transactionHash: saved.transactionHash!,
        });

        // Credit merchant account (payment succeeded - gateway now owes merchant)
        try {
          await this.ledger.credit((saved as any).merchantId, saved.amount, {
            paymentIntentId: saved.id,
            description: `Payment received: ${saved.id}`,
            metadata: {
              transactionHash: saved.transactionHash,
              currency: saved.currency,
              type: saved.type,
            },
          });
        } catch (error) {
          // Log error but don't fail the payment confirmation
          // In production, you might want to retry or alert
          console.error(`Failed to credit merchant account for payment ${saved.id}:`, error);
        }

        // Enqueue settlement job if settlement method is OFF_RAMP_MOCK
        if (saved.settlementMethod === "OFF_RAMP_MOCK") {
          await this.enqueueSettlementJob(
            saved.id,
            (saved as any).merchantId,
            saved.settlementMethod,
            saved.settlementDestination,
            saved.amount,
            saved.currency,
          );
        }

        return this.toEntity(saved);
      }
    }

    return this.toEntity(existing);
  }

  /**
   * Get payment intent without merchant authentication (public endpoint).
   * Used by the frontend payment page to fetch payment details.
   * Only returns payment intent if it exists (no merchant ownership check).
   */
  async getPublicIntent(intentId: string): Promise<PaymentIntentEntity> {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });
    if (!existing) {
      throw new ApiException(
        "resource_missing",
        `Payment intent not found: ${intentId}`,
        404,
      );
    }

    // For public endpoint, we don't check merchant ownership
    // This allows the frontend to fetch payment details for wallet connection
    // The payment intent ID is effectively the authentication token

    // If we have a tx hash and are still processing, opportunistically advance status after 5 confs.
    if (
      existing.status === PaymentIntentStatus.PROCESSING &&
      existing.transactionHash
    ) {
      const confirmations = await this.blockchain.getConfirmations(
        existing.transactionHash,
      );
      if (confirmations >= 5) {
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
          {
            phase: "AWAITING_DELIVERY_PROOF",
            status: "IN_PROGRESS",
          },
        ];

        const currentStatus = existing.status as PaymentIntentStatus;
        const targetStatus = this.stateMachine.transition(
          currentStatus,
          PaymentIntentStatus.SUCCEEDED,
          { reason: "Blockchain confirmed" },
        );

        const saved = await this.prisma.paymentIntent.update({
          where: { id: existing.id },
          data: {
            status: targetStatus,
            phases: updatedPhases,
            settlementStatus: SettlementStatus.IN_PROGRESS,
          },
        });

        // Log blockchain transaction confirmed
        await this.audit.logBlockchainTxConfirmed({
          paymentIntentId: saved.id,
          merchantId: (saved as any).merchantId,
          transactionHash: saved.transactionHash!,
          blockNumber: BigInt(confirmations), // Using confirmations as mock block number
        });

        // Credit merchant account (payment succeeded - gateway now owes merchant)
        try {
          await this.ledger.credit((saved as any).merchantId, saved.amount, {
            paymentIntentId: saved.id,
            description: `Payment received: ${saved.id}`,
            metadata: {
              transactionHash: saved.transactionHash,
              currency: saved.currency,
              type: saved.type,
            },
          });
        } catch (error) {
          // Log error but don't fail the payment confirmation
          // In production, you might want to retry or alert
          console.error(`Failed to credit merchant account for payment ${saved.id}:`, error);
        }

        // Emit blockchain transaction confirmed event
        await this.events.emitBlockchainTxConfirmed({
          paymentIntentId: saved.id,
          merchantId: (saved as any).merchantId,
          status: targetStatus,
          amount: saved.amount,
          currency: saved.currency,
          transactionHash: saved.transactionHash!,
          blockNumber: BigInt(confirmations),
        });

        // Emit status changed event
        await this.events.emitStatusChanged({
          paymentIntentId: saved.id,
          merchantId: (saved as any).merchantId,
          fromStatus: currentStatus,
          toStatus: targetStatus,
          amount: saved.amount,
          currency: saved.currency,
        });

        // Enqueue settlement job if settlement method is OFF_RAMP_MOCK
        if (saved.settlementMethod === "OFF_RAMP_MOCK") {
          await this.enqueueSettlementJob(
            saved.id,
            (saved as any).merchantId,
            saved.settlementMethod,
            saved.settlementDestination,
            saved.amount,
            saved.currency,
          );
        }

        return this.toEntity(saved);
      }
    }

    return this.toEntity(existing);
  }

  /**
   * Start settlement processing asynchronously.
   * This runs in the background and updates the database when complete.
   */
  private async startSettlementProcessing(
    intentId: string,
    settlementMethod: string,
    settlementDestination: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    if (settlementMethod !== "OFF_RAMP_MOCK") {
      // For other settlement methods, this would integrate with actual RTP/bank APIs
      return;
    }

    // Get payment intent details for audit logging (using type assertion until Prisma Client is regenerated)
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) return;

    // Add SETTLEMENT phase with IN_PROGRESS status
    const phases = await this.getPhasesForIntent(intentId);
    const now = Math.floor(Date.now() / 1000);
    const updatedPhases: PaymentIntentPhase[] = [
      ...phases.filter((p) => p.phase !== "SETTLEMENT"),
      { phase: "SETTLEMENT", status: "IN_PROGRESS", timestamp: now },
    ];

    await this.prisma.paymentIntent.update({
      where: { id: intentId },
      data: {
        phases: updatedPhases,
      },
    });

    // Log settlement initiation
    await this.audit.logSettlementInitiated({
      paymentIntentId: intentId,
      merchantId: (intent as any).merchantId,
      amount,
      currency,
      settlementMethod,
      settlementDestination,
    });

    // Emit settlement initiated event
    await this.events.emitSettlementInitiated({
      paymentIntentId: intentId,
      merchantId: (intent as any).merchantId,
      status: PaymentIntentStatus.SUCCEEDED,
      amount,
      currency,
      settlementMethod,
      settlementDestination,
      settlementStatus: SettlementStatus.IN_PROGRESS,
    });

      // Process settlement in background (don't await - runs asynchronously)
    this.processSettlement(
      intentId,
      settlementMethod,
      settlementDestination,
      amount,
      currency,
    ).catch((err) => {
      console.error(`Error processing settlement for intent ${intentId}:`, err);
    });
  }

  /**
   * Check if settlement is in progress and complete it if enough time has passed.
   * This is called on getIntent to opportunistically complete settlements.
   * @returns true if settlement was processed (database was updated), false otherwise
   */
  private async checkAndProcessSettlement(intent: {
    id: string;
    status: string;
    settlementStatus: string | null;
    settlementMethod: string;
    settlementDestination: string;
    amount: string;
    currency: string;
    phases: unknown | null;
  }): Promise<boolean> {
    if (
      intent.status !== PaymentIntentStatus.SUCCEEDED ||
      (intent.settlementStatus as string) !== SettlementStatus.IN_PROGRESS ||
      intent.settlementMethod !== "OFF_RAMP_MOCK"
    ) {
      return false;
    }

    const phases = (intent.phases as PaymentIntentPhase[] | null) ?? [];
    const settlementPhase = phases.find((p) => p.phase === "SETTLEMENT");

    // If SETTLEMENT phase doesn't exist, start it
    if (!settlementPhase) {
      await this.startSettlementProcessing(
        intent.id,
        intent.settlementMethod,
        intent.settlementDestination,
        intent.amount,
        intent.currency,
      );
      return true; // Database was updated (phase was added)
    }

    // If SETTLEMENT phase is already completed, nothing to do
    if (
      settlementPhase.status === "COMPLETED" ||
      settlementPhase.status === "FAILED"
    ) {
      return false;
    }

    // This method is deprecated - settlement is now handled via BullMQ queue
    // Keeping for backwards compatibility, but it should not be called
    return false;
  }

  /**
   * @deprecated Settlement is now handled via BullMQ queue. Use enqueueSettlementJob instead.
   */
  private async processSettlement(
    intentId: string,
    settlementMethod: string,
    settlementDestination: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    // Deprecated - settlement is now handled via BullMQ queue
    return;
  }

  /**
   * Complete settlement - execute settlement and update database.
   */
  private async completeSettlement(
    intentId: string,
    settlementDestination: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    // Get payment intent details for audit logging
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      select: { settlementMethod: true },
    });

    if (!intent) return;

    // Execute the mock settlement (in production, this would call actual offramp APIs)
    const result = await this.settlement.processOffRampMock(
      settlementDestination,
      amount,
      currency,
    );

    const phases = await this.getPhasesForIntent(intentId);
    const now = Math.floor(Date.now() / 1000);

    if (!result.success) {
      // Update settlement status to FAILED
      const updatedPhases: PaymentIntentPhase[] = [
        ...phases.filter((p) => p.phase !== "SETTLEMENT"),
        { phase: "SETTLEMENT", status: "FAILED", timestamp: now },
      ];

      await this.prisma.paymentIntent.update({
        where: { id: intentId },
        data: {
          settlementStatus: SettlementStatus.FAILED,
          phases: updatedPhases,
        },
      });
      return;
    }

    // Get current status for state transition
    const currentIntent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!currentIntent) return;

    // Use state machine to transition to SETTLED
    const currentStatus = currentIntent.status as PaymentIntentStatus;
    const targetStatus = PaymentIntentStatus.SETTLED;
    this.stateMachine.transition(currentStatus, targetStatus, {
      reason: "Settlement completed",
    });

    // Settlement successful - update status to COMPLETED
    const updatedPhases: PaymentIntentPhase[] = [
      ...phases.filter((p) => p.phase !== "SETTLEMENT"),
      { phase: "SETTLEMENT", status: "COMPLETED", timestamp: now },
    ];

    const updated = await this.prisma.paymentIntent.update({
      where: { id: intentId },
      data: {
        status: targetStatus,
        settlementStatus: SettlementStatus.COMPLETED,
        phases: updatedPhases,
      },
    });

    // Log settlement completion
    await this.audit.logSettlementCompleted({
      paymentIntentId: intentId,
      merchantId: (updated as any).merchantId,
      amount,
      currency,
      settlementMethod: intent.settlementMethod,
      settlementDestination,
      settlementTxId: result.transactionId || "mock_settlement",
    });

    // Emit status changed event
    await this.events.emitStatusChanged({
      paymentIntentId: intentId,
      merchantId: (updated as any).merchantId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      amount,
      currency,
      reason: "Settlement completed",
    });

    // Emit settlement completed event
    await this.events.emitSettlementCompleted({
      paymentIntentId: intentId,
      merchantId: (updated as any).merchantId,
      status: targetStatus,
      amount,
      currency,
      settlementMethod: intent.settlementMethod,
      settlementDestination,
      settlementTxId: result.transactionId || "mock_settlement",
      settlementStatus: SettlementStatus.COMPLETED,
    });
  }

  /**
   * Enqueue a settlement job to BullMQ.
   * Sets up the settlement phase, logs audit events, and enqueues the job with delay.
   */
  private async enqueueSettlementJob(
    intentId: string,
    merchantId: string,
    settlementMethod: string,
    settlementDestination: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    if (settlementMethod !== "OFF_RAMP_MOCK") {
      // For other settlement methods, this would integrate with actual RTP/bank APIs
      return;
    }

    // Get payment intent to verify it exists
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) return;

    // Add SETTLEMENT phase with IN_PROGRESS status
    const phases = await this.getPhasesForIntent(intentId);
    const now = Math.floor(Date.now() / 1000);
    const updatedPhases: PaymentIntentPhase[] = [
      ...phases.filter((p) => p.phase !== "SETTLEMENT"),
      { phase: "SETTLEMENT", status: "IN_PROGRESS", timestamp: now },
    ];

    await this.prisma.paymentIntent.update({
      where: { id: intentId },
      data: {
        phases: updatedPhases,
      },
    });

    // Log settlement initiation
    await this.audit.logSettlementInitiated({
      paymentIntentId: intentId,
      merchantId,
      amount,
      currency,
      settlementMethod,
      settlementDestination,
    });

    // Emit settlement initiated event
    await this.events.emitSettlementInitiated({
      paymentIntentId: intentId,
      merchantId,
      status: PaymentIntentStatus.SUCCEEDED,
      amount,
      currency,
      settlementMethod,
      settlementDestination,
      settlementStatus: SettlementStatus.IN_PROGRESS,
    });

    // Enqueue settlement job (delay is handled by settlement service internally)
    await this.settlementQueue.enqueueSettlement({
      paymentIntentId: intentId,
      merchantId,
      settlementMethod,
      settlementDestination,
      amount,
      currency,
    });
  }

  /**
   * Helper to get phases for an intent.
   */
  private async getPhasesForIntent(
    intentId: string,
  ): Promise<PaymentIntentPhase[]> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      select: { phases: true },
    });
    return (intent?.phases as PaymentIntentPhase[] | null) ?? [];
  }

  /**
   * Create EscrowOrder for DELIVERY_VS_PAYMENT payment intent if it doesn't exist
   */
  private async createEscrowOrderIfNeeded(paymentIntent: any): Promise<void> {
    // Check if escrow order already exists for this payment intent
    const existingEscrowOrder = await this.prisma.escrowOrder.findUnique({
      where: { paymentIntentId: paymentIntent.id },
    });

    if (existingEscrowOrder) {
      // Escrow order already exists, no need to create it again
      console.log(`Escrow order already exists for payment intent ${paymentIntent.id}`);
      return;
    }

    const metadata = (paymentIntent.metadata as Record<string, unknown>) || {};
    const merchantId = (paymentIntent as any).merchantId;

    // Extract escrow parameters from metadata
    const deliveryPeriod = (metadata.deliveryPeriod as number) || 2592000; // Default 30 days
    const expectedDeliveryHash = (metadata.expectedDeliveryHash as string) || "0x0000000000000000000000000000000000000000000000000000000000000000";
    const autoRelease = (metadata.autoRelease as boolean) ?? false;
    const deliveryOracle = (metadata.deliveryOracle as string) || "0x0000000000000000000000000000000000000000";
    const tokenAddress = (metadata.tokenAddress as string) || process.env.TOKEN_ADDRESS || "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";

    // Calculate delivery deadline (current time + delivery period)
    const now = Math.floor(Date.now() / 1000);
    const deliveryDeadline = BigInt(now + deliveryPeriod).toString();

    // Determine release type based on metadata (default to DELIVERY_PROOF)
    // For now, we default to DELIVERY_PROOF - can be enhanced to support TIME_LOCKED, MILESTONE_LOCKED
    const releaseType: "TIME_LOCKED" | "MILESTONE_LOCKED" | "DELIVERY_PROOF" | "AUTO_RELEASE" = 
      (metadata.releaseType as string) === "TIME_LOCKED" ? "TIME_LOCKED" :
      (metadata.releaseType as string) === "MILESTONE_LOCKED" ? "MILESTONE_LOCKED" :
      autoRelease ? "AUTO_RELEASE" : "DELIVERY_PROOF";

    // Get buyer address from signerAddress or metadata
    const buyerAddress = paymentIntent.signerAddress || (metadata.buyerAddress as string) || "0x0000000000000000000000000000000000000000";

    try {
      await this.escrowOrder.createEscrowOrder({
        paymentIntentId: paymentIntent.id,
        merchantId,
        contractAddress: paymentIntent.contractAddress || "0x0000000000000000000000000000000000000000",
        buyerAddress,
        tokenAddress,
        amount: paymentIntent.amount,
        deliveryPeriod,
        deliveryDeadline,
        expectedDeliveryHash,
        autoReleaseOnProof: autoRelease,
        deliveryOracle,
        releaseType,
        createTxHash: paymentIntent.transactionHash || undefined,
        timeLockUntil: releaseType === "TIME_LOCKED" && metadata.timeLockUntil 
          ? (metadata.timeLockUntil as string) 
          : undefined,
        disputeWindow: metadata.disputeWindow 
          ? (metadata.disputeWindow as string) 
          : "604800", // Default 7 days
      });
    } catch (error) {
      // Log error but don't fail the payment confirmation
      // In production, you might want to retry or alert
      console.error(`Failed to create escrow order for payment intent ${paymentIntent.id}:`, error);
    }
  }

  private toEntity(row: {
    id: string;
    object: string;
    status: string;
    merchantId?: string;
    amount: string;
    currency: string;
    type: string;
    description: string | null;
    settlementMethod: string;
    settlementDestination: string;
    settlementStatus: string | null;
    contractAddress: string | null;
    transactionHash: string | null;
    chainId: number | null;
    typedData: unknown | null;
    signature: string | null;
    signerAddress: string | null;
    phases: unknown | null;
    metadata: unknown | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentIntentEntity {
    // Generate payment URL for wallet connection
    const paymentUrl = this.generatePaymentUrl(row.id);

    return {
      id: row.id,
      object: "payment_intent",
      status: row.status as PaymentIntentStatus,
      amount: row.amount,
      currency: row.currency,
      type: row.type,
      description: row.description,
      settlementMethod: row.settlementMethod,
      settlementDestination: row.settlementDestination,
      settlementStatus: row.settlementStatus as SettlementStatus,
      contractAddress: row.contractAddress,
      transactionHash: row.transactionHash,
      chainId: row.chainId,
      typedData: row.typedData,
      signature: row.signature,
      signerAddress: row.signerAddress,
      phases: (row.phases as PaymentIntentPhase[] | null) ?? null,
      metadata: asObjectRecord(row.metadata),
      paymentUrl,
      created: toUnixSeconds(row.createdAt),
      updated: toUnixSeconds(row.updatedAt),
    };
  }

  /**
   * Generate payment URL for wallet connection interface.
   * This URL points to a frontend page where users can connect their wallet and execute the payment.
   */
  private generatePaymentUrl(intentId: string): string | null {
    const frontendUrl =
      process.env.FRONTEND_URL || process.env.PAYMENT_FRONTEND_URL;
    if (!frontendUrl) {
      // If no frontend URL is configured, return null
      // Merchant can still use the API directly or configure their own frontend
      return null;
    }
    // Generate URL like: http://localhost:5173/?intent=intent_xxx
    const baseUrl = frontendUrl.endsWith("/")
      ? frontendUrl.slice(0, -1)
      : frontendUrl;
    return `${baseUrl}/?intent=${intentId}`;
  }

  /**
   * Get contract address for payment type, using merchant's contract addresses with fallback to env vars.
   */
  private getContractAddressForType(
    type: string,
    merchant: {
      dvpContractAddress: string | null;
      consentedPullContractAddress: string | null;
    },
  ): string {
    const zero = "0x0000000000000000000000000000000000000000";

    if (type === "DELIVERY_VS_PAYMENT") {
      // Prefer merchant's contract address, fallback to env var, then zero address
      if (
        merchant.dvpContractAddress &&
        isAddress(merchant.dvpContractAddress)
      ) {
        return merchant.dvpContractAddress;
      }
      const envAddress = process.env.DvP_CONTRACT_ADDRESS;
      return envAddress && isAddress(envAddress) ? envAddress : zero;
    }

    // CONSENTED_PULL type
    if (
      merchant.consentedPullContractAddress &&
      isAddress(merchant.consentedPullContractAddress)
    ) {
      return merchant.consentedPullContractAddress;
    }
    const envAddress = process.env.CONSENTED_PULL_CONTRACT_ADDRESS;
    return envAddress && isAddress(envAddress) ? envAddress : zero;
  }
}
