import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CompleteMilestoneDto {
  @ApiPropertyOptional({
    example: "proof_0xabcdef123456...",
    description: "Proof of milestone completion (hash)",
  })
  @IsString()
  @IsOptional()
  completionProof?: string;

  @ApiPropertyOptional({
    example: "https://example.com/milestone-proofs/12345",
    description: "URI where the completion proof can be accessed",
  })
  @IsString()
  @IsOptional()
  completionProofURI?: string;

  @ApiProperty({
    example: "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    description: "Address of the entity completing the milestone",
  })
  @IsString()
  @IsNotEmpty()
  completedBy!: string;
}

