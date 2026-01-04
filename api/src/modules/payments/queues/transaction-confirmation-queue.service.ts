import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { TransactionConfirmationJobData } from "./transaction-confirmation.queue";

@Injectable()
export class TransactionConfirmationQueueService {
  private readonly logger = new Logger(TransactionConfirmationQueueService.name);

  constructor(
    @InjectQueue("transaction-confirmation")
    private readonly queue: Queue<TransactionConfirmationJobData>,
  ) {}

  /**
   * Enqueue a job to check transaction confirmations and update payment intent status
   */
  async enqueueConfirmationCheck(
    paymentIntentId: string,
    merchantId: string,
    transactionHash: string,
  ): Promise<void> {
    this.logger.log(
      `Enqueuing transaction confirmation check for payment intent ${paymentIntentId}`,
    );

    await this.queue.add(
      "check-confirmation",
      {
        paymentIntentId,
        merchantId,
        transactionHash,
        retryCount: 0,
      },
      {
        attempts: 60, // Retry up to 60 times (matches MAX_RETRIES in processor)
        backoff: {
          type: "exponential",
          delay: 10000, // Start with 10 seconds, exponential backoff
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    );

    this.logger.log(
      `Transaction confirmation check job enqueued for payment intent ${paymentIntentId}`,
    );
  }
}

