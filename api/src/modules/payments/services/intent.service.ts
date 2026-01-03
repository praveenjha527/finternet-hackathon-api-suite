import { Injectable } from "@nestjs/common";
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
import { LedgerService } from "./ledger.service";

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
    private readonly ledger: LedgerService,
  ) {}

  async createIntent(
    dto: CreatePaymentIntentDto,
    merchantId: string,
  ): Promise<PaymentIntentEntity> {
    this.routing.validateSettlementMethod(dto.settlementMethod);
    await this.compliance.validateIntent();

    const id = `intent_${uuidv4()}`;
    const chainId = SEPOLIA_CHAIN_ID;

    // Get merchant to retrieve contract addresses
    const merchant = (await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    })) as {
      dvpContractAddress: string | null;
      consentedPullContractAddress: string | null;
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
        metadata: dto.metadata
          ? (dto.metadata as unknown as Prisma.InputJsonValue)
          : undefined,
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

    const decimals = DEFAULT_DECIMALS;

    // Get merchant to retrieve contract addresses
    const merchantRecord = (await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    })) as {
      dvpContractAddress: string | null;
      consentedPullContractAddress: string | null;
    } | null;

    if (!merchantRecord) {
      throw new ApiException(
        "resource_missing",
        `Merchant not found: ${merchantId}`,
        404,
      );
    }

    const contractAddress = this.getContractAddressForType(existing.type, {
      dvpContractAddress: merchantRecord.dvpContractAddress,
      consentedPullContractAddress: merchantRecord.consentedPullContractAddress,
    });

    const submit =
      existing.type === "DELIVERY_VS_PAYMENT"
        ? await this.blockchain.submitDvP({
            intentId: existing.id,
            payerAddress,
            amount: existing.amount,
            decimals,
            contractAddress,
          })
        : await this.blockchain.submitConsentedPull({
            intentId: existing.id,
            payerAddress,
            amount: existing.amount,
            decimals,
            contractAddress,
          });

    const saved = await this.prisma.paymentIntent.update({
      where: { id: existing.id },
      data: {
        status: targetStatus,
        signature,
        signerAddress: payerAddress,
        transactionHash: submit.transactionHash,
        chainId: submit.chainId,
        contractAddress: submit.contractAddress,
        phases: updatedPhases,
      },
    });

    // Log blockchain transaction submission
    await this.audit.logBlockchainTxSubmitted({
      paymentIntentId: saved.id,
      merchantId,
      amount: saved.amount,
      currency: saved.currency,
      transactionHash: submit.transactionHash,
      contractAddress: submit.contractAddress,
      chainId: submit.chainId,
      payerAddress,
    });

    // Emit status changed event
    await this.events.emitStatusChanged({
      paymentIntentId: saved.id,
      merchantId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      amount: saved.amount,
      currency: saved.currency,
      reason: "Signature verified",
    });

    // Emit blockchain transaction submitted event
    await this.events.emitBlockchainTxSubmitted({
      paymentIntentId: saved.id,
      merchantId,
      status: targetStatus,
      amount: saved.amount,
      currency: saved.currency,
      transactionHash: submit.transactionHash,
      contractAddress: submit.contractAddress,
      chainId: submit.chainId,
      payerAddress,
    });

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
