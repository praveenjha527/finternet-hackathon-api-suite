import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEthereumAddress, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class ConfirmPaymentIntentDto {
  @ApiProperty({ example: "0x1234567890abcdef..." })
  @IsString()
  @IsNotEmpty()
  signature!: string;

  @ApiProperty({ example: "0x742d35Cc6634C0532925a3b844Bc9e7595f42318" })
  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  payerAddress!: string;

  @ApiPropertyOptional({ 
    example: "0xabcdef1234567890...",
    description: "Transaction hash from the blockchain transaction (createOrder or initiatePull). Optional if provided later via update endpoint."
  })
  @IsString()
  @IsOptional()
  transactionHash?: string;
}
