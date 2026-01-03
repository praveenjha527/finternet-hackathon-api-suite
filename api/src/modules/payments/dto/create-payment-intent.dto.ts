import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class MetadataDto {
  [key: string]: unknown;
}

export class CreatePaymentIntentDto {
  @ApiProperty({ example: "1000.00" })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: "USDC" })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({ example: "DELIVERY_VS_PAYMENT" })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ example: "OFF_RAMP_TO_RTP" })
  @IsString()
  @IsNotEmpty()
  settlementMethod!: string;

  @ApiProperty({ example: "9876543210" })
  @IsString()
  @IsNotEmpty()
  settlementDestination!: string;

  @ApiPropertyOptional({ example: "Order #ORD-123" })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: { orderId: "ORD-123", merchantId: "MERCHANT-456" },
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MetadataDto)
  metadata?: Record<string, unknown>;
}
