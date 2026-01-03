import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PrismaModule } from "../../../prisma/prisma.module";
import { SettlementQueueProcessor } from "./settlement.queue";
import { SettlementQueueService } from "./settlement-queue.service";
import { SettlementService } from "../services/settlement.service";
import { AuditService } from "../services/audit.service";
import { PaymentEventService } from "../services/payment-event.service";
import { PaymentStateMachineService } from "../services/payment-state-machine.service";

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
  ],
  providers: [
    SettlementQueueProcessor,
    SettlementQueueService,
    SettlementService,
    AuditService,
    PaymentEventService,
    PaymentStateMachineService,
  ],
  exports: [SettlementQueueService],
})
export class QueuesModule {}
