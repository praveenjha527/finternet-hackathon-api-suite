import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class SubmitDeliveryProofDto {
  @ApiProperty({
    example: "proof_0xabcdef123456...",
    description: "Hash of the delivery proof (bytes32 hex string)",
  })
  @IsString()
  @IsNotEmpty()
  proofHash!: string;

  @ApiPropertyOptional({
    example: "https://example.com/delivery-proofs/12345",
    description: "URI where the delivery proof can be accessed",
  })
  @IsString()
  @IsOptional()
  proofURI?: string;

  @ApiProperty({
    example: "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    description: "Address of the entity submitting the proof (merchant or buyer)",
  })
  @IsString()
  @IsNotEmpty()
  submittedBy!: string;

  @ApiPropertyOptional({
    example: "0x1234...",
    description: "Transaction hash if proof was submitted on-chain",
  })
  @IsString()
  @IsOptional()
  submitTxHash?: string;
}

