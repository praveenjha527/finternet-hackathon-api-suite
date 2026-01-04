import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class UpdateTransactionHashDto {
  @ApiProperty({ example: "0xabcdef1234567890..." })
  @IsString()
  @IsNotEmpty()
  transactionHash!: string;
}

