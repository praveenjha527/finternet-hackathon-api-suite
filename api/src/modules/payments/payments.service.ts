import { Injectable } from '@nestjs/common';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { ConfirmPaymentIntentDto } from './dto/confirm-payment-intent.dto';
import type { PaymentIntentEntity } from './entities/payment-intent.entity';
import { IntentService } from './services/intent.service';

@Injectable()
export class PaymentsService {
  constructor(private readonly intentService: IntentService) {}

  async createIntent(dto: CreatePaymentIntentDto, merchantId: string): Promise<PaymentIntentEntity> {
    return this.intentService.createIntent(dto, merchantId);
  }

  async confirmIntent(
    intentId: string,
    dto: ConfirmPaymentIntentDto,
    merchantId: string,
  ): Promise<PaymentIntentEntity> {
    return this.intentService.confirmIntent(intentId, dto.signature, dto.payerAddress, merchantId);
  }

  async getIntent(intentId: string, merchantId: string): Promise<PaymentIntentEntity> {
    return this.intentService.getIntent(intentId, merchantId);
  }
}


