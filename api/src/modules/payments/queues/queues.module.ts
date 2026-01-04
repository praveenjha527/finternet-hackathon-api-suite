import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PrismaModule } from "../../../prisma/prisma.module";
import { SettlementQueueProcessor } from "./settlement.queue";
import { SettlementQueueService } from "./settlement-queue.service";
import { ProgrammablePaymentQueueProcessor } from "./programmable-payment.queue";
import { ProgrammablePaymentQueueService } from "./programmable-payment-queue.service";
import { TransactionConfirmationQueueProcessor } from "./transaction-confirmation.queue";
import { TransactionConfirmationQueueService } from "./transaction-confirmation-queue.service";
import { SettlementService } from "../services/settlement.service";
import { AuditService } from "../services/audit.service";
import { PaymentEventService } from "../services/payment-event.service";
import { PaymentStateMachineService } from "../services/payment-state-machine.service";
import { FiatAccountService } from "../services/fiat-account.service";
import { LedgerService } from "../services/ledger.service";
import { BlockchainService } from "../services/blockchain.service";
import { EscrowService } from "../services/escrow.service";

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    PrismaModule,
    BullModule.registerQueueAsync({
      name: "settlement",
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>("REDIS_URL");
        const redisHost = configService.get<string>("REDIS_HOST", "localhost");
        const redisPort = configService.get<number>("REDIS_PORT", 6379);

        // BullMQ/IORedis connection options: use URL if provided, otherwise use host/port
        const connection = redisUrl
          ? { url: redisUrl }
          : {
              host: redisHost,
              port: redisPort,
            };

        return {
          connection,
          defaultJobOptions: {
            removeOnComplete: {
              age: 3600, // Keep completed jobs for 1 hour
              count: 1000, // Keep last 1000 completed jobs
            },
            removeOnFail: {
              age: 86400, // Keep failed jobs for 24 hours
            },
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: "programmable-payment",
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>("REDIS_URL");
        const redisHost = configService.get<string>("REDIS_HOST", "localhost");
        const redisPort = configService.get<number>("REDIS_PORT", 6379);

        const connection = redisUrl
          ? { url: redisUrl }
          : {
              host: redisHost,
              port: redisPort,
            };

        return {
          connection,
          defaultJobOptions: {
            removeOnComplete: {
              age: 86400, // Keep completed jobs for 24 hours
              count: 1000,
            },
            removeOnFail: {
              age: 604800, // Keep failed jobs for 7 days
            },
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: "transaction-confirmation",
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>("REDIS_URL");
        const redisHost = configService.get<string>("REDIS_HOST", "localhost");
        const redisPort = configService.get<number>("REDIS_PORT", 6379);

        const connection = redisUrl
          ? { url: redisUrl }
          : {
              host: redisHost,
              port: redisPort,
            };

        return {
          connection,
          defaultJobOptions: {
            removeOnComplete: {
              age: 3600, // Keep completed jobs for 1 hour
              count: 1000,
            },
            removeOnFail: {
              age: 86400, // Keep failed jobs for 24 hours
            },
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    SettlementQueueProcessor,
    SettlementQueueService,
    ProgrammablePaymentQueueProcessor,
    ProgrammablePaymentQueueService,
    TransactionConfirmationQueueProcessor,
    TransactionConfirmationQueueService,
    SettlementService,
    AuditService,
    PaymentEventService,
    PaymentStateMachineService,
    FiatAccountService,
    LedgerService,
    BlockchainService,
    EscrowService,
  ],
  exports: [
    SettlementQueueService,
    ProgrammablePaymentQueueService,
    TransactionConfirmationQueueService,
  ],
})
export class QueuesModule {}
