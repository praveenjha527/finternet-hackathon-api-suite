import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiParam, ApiTags, ApiSecurity } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import type { ApiResponse } from '../../common/responses';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { ConfirmPaymentIntentDto } from './dto/confirm-payment-intent.dto';
import type { PaymentIntentEntity } from './entities/payment-intent.entity';
import { CurrentMerchant } from '../auth/decorators/current-merchant.decorator';

type Merchant = {
  id: string;
  name: string;
  apiKey: string;
  isActive: boolean;
};

@ApiTags('payment-intents')
@ApiSecurity('ApiKeyAuth')
@Controller('payment-intents')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  async createPaymentIntent(
    @Body() dto: CreatePaymentIntentDto,
    @CurrentMerchant() merchant: Merchant,
  ): Promise<ApiResponse<PaymentIntentEntity>> {
    const intent = await this.paymentsService.createIntent(dto, merchant.id);
    return {
      id: intent.id,
      object: 'payment_intent',
      status: intent.status,
      data: intent,
      metadata: dto.metadata,
      created: intent.created,
      updated: intent.updated,
    };
  }

  @ApiParam({ name: 'intentId' })
  @Get(':intentId')
  async getPaymentIntent(
    @Param('intentId') intentId: string,
    @CurrentMerchant() merchant: Merchant,
  ): Promise<ApiResponse<PaymentIntentEntity>> {
    const intent = await this.paymentsService.getIntent(intentId, merchant.id);
    return {
      id: intent.id,
      object: 'payment_intent',
      status: intent.status,
      data: intent,
      created: intent.created,
      updated: intent.updated,
    };
  }

  @ApiParam({ name: 'intentId' })
  @Post(':intentId/confirm')
  @HttpCode(200)
  async confirmPaymentIntent(
    @Param('intentId') intentId: string,
    @Body() dto: ConfirmPaymentIntentDto,
    @CurrentMerchant() merchant: Merchant,
  ): Promise<ApiResponse<PaymentIntentEntity>> {
    const intent = await this.paymentsService.confirmIntent(intentId, dto, merchant.id);
    return {
      id: intent.id,
      object: 'payment_intent',
      status: intent.status,
      data: intent,
      created: intent.created,
      updated: intent.updated,
    };
  }
}


