import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RaiseDisputeDto {
  @ApiProperty({
    example: "Item not delivered as described",
    description: "Reason for the dispute",
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiProperty({
    example: "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    description: "Address of the entity raising the dispute (buyer or merchant)",
  })
  @IsString()
  @IsNotEmpty()
  raisedBy!: string;

  @ApiPropertyOptional({
    example: "604800",
    description: "Dispute window in seconds (default: 7 days)",
  })
  @IsString()
  @IsOptional()
  disputeWindow?: string;
}

