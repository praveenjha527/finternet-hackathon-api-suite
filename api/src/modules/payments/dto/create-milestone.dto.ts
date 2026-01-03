import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateMilestoneDto {
  @ApiProperty({
    example: 0,
    description: "Index of the milestone (0-based, must be unique per order)",
  })
  @IsInt()
  @Min(0)
  milestoneIndex!: number;

  @ApiPropertyOptional({
    example: "Initial payment",
    description: "Description of the milestone",
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: "500.00",
    description: "Amount to be released for this milestone",
  })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiPropertyOptional({
    example: 50,
    description: "Percentage of total amount (0-100)",
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  percentage?: number;
}

