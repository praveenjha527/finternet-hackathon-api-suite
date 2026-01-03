import { ApiProperty } from "@nestjs/swagger";
import { IsEthereumAddress, IsNotEmpty, IsString } from "class-validator";

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
}
