import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { SettlementService } from "../services/settlement.service";
import { AuditService } from "../services/audit.service";
import { PaymentEventService } from "../services/payment-event.service";
import { PaymentStateMachineService } from "../services/payment-state-machine.service";
import {
  PaymentIntentStatus,
  PaymentIntentPhase,
  SettlementStatus,
} from "../entities/payment-intent.entity";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
    private readonly audit: AuditService,
    private readonly events: PaymentEventService,
    private readonly stateMachine: PaymentStateMachineService,
  ) {
    super();
  }

  async process(job: Job<SettlementJobData>): Promise<void> {
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

          // Execute the settlement (with merchant ID for ledger)
          const result = await this.settlement.processOffRampMock(
            merchantId,
            settlementDestination,
            amount,
            currency,
            {
              paymentIntentId,
              settlementMethod,
            },
          );

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
