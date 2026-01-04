import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  ProgrammablePaymentJobData,
  TimeLockReleaseJobData,
  MilestoneCheckJobData,
  DeliveryProofProcessJobData,
  DisputeTimeoutJobData,
} from "./programmable-payment.queue";

@Injectable()
export class ProgrammablePaymentQueueService {
  private readonly logger = new Logger(ProgrammablePaymentQueueService.name);

  constructor(
    @InjectQueue("programmable-payment")
    private readonly programmablePaymentQueue: Queue<ProgrammablePaymentJobData>,
  ) {}

  /**
   * Schedule a time-locked release job.
   * The job will execute when the time lock expires.
   */
  async scheduleTimeLockRelease(
    escrowOrderId: string,
    paymentIntentId: string,
    merchantId: string,
    timeLockUntil: string, // Unix timestamp (BigInt as string)
  ): Promise<void> {
    const lockUntilTimestamp = BigInt(timeLockUntil);
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    if (lockUntilTimestamp <= currentTimestamp) {
      // Time lock already expired, process immediately
      await this.programmablePaymentQueue.add(
        "time-lock-release",
        {
          type: "TIME_LOCK_RELEASE",
          escrowOrderId,
          paymentIntentId,
          merchantId,
          timeLockUntil,
        } as TimeLockReleaseJobData,
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        },
      );
      return;
    }

    // Calculate delay in milliseconds
    const delayMs = Number(lockUntilTimestamp - currentTimestamp) * 1000;

    await this.programmablePaymentQueue.add(
      "time-lock-release",
      {
        type: "TIME_LOCK_RELEASE",
        escrowOrderId,
        paymentIntentId,
        merchantId,
        timeLockUntil,
      } as TimeLockReleaseJobData,
      {
        delay: delayMs,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 500,
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
      },
    );

    this.logger.log(
      `Scheduled time-lock release for order ${escrowOrderId} at ${timeLockUntil} (${delayMs}ms delay)`,
    );
  }

  /**
   * Schedule a milestone check job.
   * This can be called immediately or with a delay for periodic checks.
   */
  async scheduleMilestoneCheck(
    escrowOrderId: string,
    paymentIntentId: string,
    merchantId: string,
    milestoneId: string,
    delayMs?: number,
  ): Promise<void> {
    await this.programmablePaymentQueue.add(
      "milestone-check",
      {
        type: "MILESTONE_CHECK",
        escrowOrderId,
        paymentIntentId,
        merchantId,
        milestoneId,
      } as MilestoneCheckJobData,
      {
        delay: delayMs ?? 0,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400,
          count: 500,
        },
        removeOnFail: {
          age: 604800,
        },
      },
    );

    this.logger.log(`Scheduled milestone check for milestone ${milestoneId} (order ${escrowOrderId})`);
  }

  /**
   * Schedule delivery proof processing job.
   * This processes the delivery proof and releases funds if auto-release is enabled.
   */
  async scheduleDeliveryProofProcess(
    escrowOrderId: string,
    paymentIntentId: string,
    merchantId: string,
    deliveryProofId: string,
    delayMs?: number,
  ): Promise<void> {
    await this.programmablePaymentQueue.add(
      "delivery-proof-process",
      {
        type: "DELIVERY_PROOF_PROCESS",
        escrowOrderId,
        paymentIntentId,
        merchantId,
        deliveryProofId,
      } as DeliveryProofProcessJobData,
      {
        delay: delayMs ?? 0,
        attempts: 10, // More attempts to allow waiting for contract status updates after delivery proof submission
        backoff: {
          type: "exponential",
          delay: 10000, // Start with 10 second delay, exponential backoff
        },
        removeOnComplete: {
          age: 86400,
          count: 500,
        },
        removeOnFail: {
          age: 604800,
        },
      },
    );

    this.logger.log(`Scheduled delivery proof processing for proof ${deliveryProofId} (order ${escrowOrderId})`);
  }

  /**
   * Schedule dispute timeout check job.
   * The job will execute when the dispute window expires.
   */
  async scheduleDisputeTimeout(
    escrowOrderId: string,
    paymentIntentId: string,
    merchantId: string,
    disputeRaisedAt: string, // Unix timestamp
    disputeWindow: string, // Seconds (BigInt as string)
  ): Promise<void> {
    const disputeRaisedTimestamp = BigInt(disputeRaisedAt);
    const windowSeconds = BigInt(disputeWindow);
    const disputeExpiryTimestamp = disputeRaisedTimestamp + windowSeconds;
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    if (disputeExpiryTimestamp <= currentTimestamp) {
      // Dispute window already expired, process immediately
      await this.programmablePaymentQueue.add(
        "dispute-timeout",
        {
          type: "DISPUTE_TIMEOUT",
          escrowOrderId,
          paymentIntentId,
          merchantId,
          disputeRaisedAt,
          disputeWindow,
        } as DisputeTimeoutJobData,
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        },
      );
      return;
    }

    // Calculate delay in milliseconds
    const delayMs = Number(disputeExpiryTimestamp - currentTimestamp) * 1000;

    await this.programmablePaymentQueue.add(
      "dispute-timeout",
      {
        type: "DISPUTE_TIMEOUT",
        escrowOrderId,
        paymentIntentId,
        merchantId,
        disputeRaisedAt,
        disputeWindow,
      } as DisputeTimeoutJobData,
      {
        delay: delayMs,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400,
          count: 500,
        },
        removeOnFail: {
          age: 604800,
        },
      },
    );

    this.logger.log(
      `Scheduled dispute timeout check for order ${escrowOrderId} at ${disputeExpiryTimestamp} (${delayMs}ms delay)`,
    );
  }

  /**
   * Get queue metrics for monitoring
   */
  async getQueueMetrics() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.programmablePaymentQueue.getWaitingCount(),
      this.programmablePaymentQueue.getActiveCount(),
      this.programmablePaymentQueue.getCompletedCount(),
      this.programmablePaymentQueue.getFailedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
    };
  }
}

