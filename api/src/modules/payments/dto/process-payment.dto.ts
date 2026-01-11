import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsString,
  Matches,
  Length,
  ValidateNested,
  IsObject,
  IsOptional,
} from "class-validator";
import { Type, Transform } from "class-transformer";

export class CardDetailsDto {
  @ApiProperty({
    example: "4242424242424242",
    description: "Card number (16 digits, spaces are allowed and will be removed)",
  })
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/\s/g, '') : value)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{13,19}$/, {
    message: "Card number must be between 13 and 19 digits",
  })
  cardNumber!: string;

  @ApiProperty({
    example: "12/25",
    description: "Card expiry (MM/YY format)",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}\/\d{2}$/, {
    message: "Expiry must be in MM/YY format",
  })
  expiry!: string;

  @ApiProperty({
    example: "123",
    description: "Card CVV (3-4 digits)",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3,4}$/, {
    message: "CVV must be 3 or 4 digits",
  })
  cvv!: string;

  @ApiProperty({
    example: "John Doe",
    description: "Cardholder name",
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    example: "123 Main St",
    description: "Billing address line 1",
  })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional({
    example: "Apt 4B",
    description: "Billing address line 2",
  })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional({
    example: "New York",
    description: "City",
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    example: "NY",
    description: "State",
  })
  @IsOptional()
  @IsString()
  @Length(2, 2, {
    message: "State must be 2 characters",
  })
  state?: string;

  @ApiPropertyOptional({
    example: "10001",
    description: "ZIP code",
  })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({
    example: "US",
    description: "Country code (ISO 3166-1 alpha-2)",
  })
  @IsOptional()
  @IsString()
  @Length(2, 2, {
    message: "Country code must be 2 characters",
  })
  country?: string;
}

export class ProcessPaymentDto {
  @ApiProperty({
    description: "Card payment details",
    type: CardDetailsDto,
  })
  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => CardDetailsDto)
  card!: CardDetailsDto;
}
