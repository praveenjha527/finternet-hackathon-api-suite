import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

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
  metadata?: Record<string, unknown>;

  // Escrow-specific fields (for DELIVERY_VS_PAYMENT type)
  @ApiPropertyOptional({
    example: 2592000,
    description: "Delivery period in seconds (default: 30 days)",
  })
  @IsOptional()
  deliveryPeriod?: number;

  @ApiPropertyOptional({
    example: "0x0000000000000000000000000000000000000000000000000000000000000000",
    description: "Expected delivery hash (bytes32) - optional",
  })
  @IsOptional()
  @IsString()
  expectedDeliveryHash?: string;

  @ApiPropertyOptional({
    example: true,
    description: "Auto-release funds when delivery proof is submitted",
  })
  @IsOptional()
  autoRelease?: boolean;

  @ApiPropertyOptional({
    example: "0x0000000000000000000000000000000000000000",
    description: "Delivery oracle address (optional, zero address if not used)",
  })
  @IsOptional()
  @IsString()
  deliveryOracle?: string;
}
