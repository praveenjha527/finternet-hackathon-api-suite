import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentIntentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  type!: string;

  @ApiPropertyOptional()
  settlementStatus?: string | null;

  @ApiPropertyOptional()
  transactionHash?: string | null;

  @ApiPropertyOptional()
  signerAddress?: string | null;

  @ApiPropertyOptional()
  phases?: Array<Record<string, unknown>> | null;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown> | null;
}


