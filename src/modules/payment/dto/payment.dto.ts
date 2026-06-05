import { IsString, IsNotEmpty, IsNumber, IsPositive, Min, IsOptional, Length } from 'class-validator';

export class CreateSetupIntentDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;
}

export class ChargeCardDto {
  @IsNumber()
  @IsPositive()
  @Min(50, { message: 'Minimum amount is 50 cents' })
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @Length(3, 3, { message: 'Currency must be a 3-letter code (e.g. usd, cad)' })
  currency!: string;

  @IsString()
  @IsNotEmpty()
  cardId!: string;
}

export class SaveCardDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 50, { message: 'Invalid payment method ID' })
  nonce!: string;
}