import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { SettlementJobData } from "./settlement.queue";

@Injectable()
export class SettlementQueueService {
  constructor(
    @InjectQueue("settlement")
    private readonly settlementQueue: Queue<SettlementJobData>,
  ) {}

  /**
   * Add a settlement job to the queue.
   * The job will be processed with a delay based on OFF_RAMP_MOCK_DELAY env variable.
   */
  async enqueueSettlement(
    jobData: SettlementJobData,
    delayMs?: number,
  ): Promise<void> {
    const delay = delayMs ?? 0; // Default no delay, can be configured per job

    await this.settlementQueue.add("process-settlement", jobData, {
      delay,
      attempts: 3, // Retry up to 3 times on failure
      backoff: {
        type: "exponential",
        delay: 5000, // Start with 5 second delay, then exponential backoff
      },
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 1000, // Keep last 1000 completed jobs
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
      },
    });
  }

  /**
   * Get queue metrics for monitoring
   */
  async getQueueMetrics() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.settlementQueue.getWaitingCount(),
      this.settlementQueue.getActiveCount(),
      this.settlementQueue.getCompletedCount(),
      this.settlementQueue.getFailedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
    };
  }
}
