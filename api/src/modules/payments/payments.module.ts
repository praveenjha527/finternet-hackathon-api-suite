import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { IntentService } from "./services/intent.service";
import { BlockchainService } from "./services/blockchain.service";
import { RoutingService } from "./services/routing.service";
import { SettlementService } from "./services/settlement.service";
import { ComplianceService } from "./services/compliance.service";
import { AuditService } from "./services/audit.service";
import { FiatAccountService } from "./services/fiat-account.service";
import { LedgerService } from "./services/ledger.service";
import { RefundService } from "./services/refund.service";
import { ChargebackService } from "./services/chargeback.service";
import { EscrowService } from "./services/escrow.service";
import { EscrowOrderService } from "./services/escrow-order.service";
import { PaymentStateMachineService } from "./services/payment-state-machine.service";
import { PaymentEventService } from "./services/payment-event.service";
import { PaymentIntentEventListener } from "./listeners/payment-intent-event.listener";
import { QueuesModule } from "./queues/queues.module";

@Module({
  imports: [EventEmitterModule.forRoot(), QueuesModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    IntentService,
    BlockchainService,
    RoutingService,
    SettlementService,
    ComplianceService,
    AuditService,
    PaymentStateMachineService,
    PaymentEventService,
    PaymentIntentEventListener,
    FiatAccountService,
    LedgerService,
    RefundService,
    ChargebackService,
    EscrowService,
    EscrowOrderService,
  ],
})
export class PaymentsModule {}
