import {
    IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { ClaimDocumentType, ClaimStatus, ClaimType } from 'src/common/enum/claims';
import { Currency } from 'src/common/enum/currency.enum';
import { User } from 'src/entities/user.entity';


export class CreateClaimDto {
  @IsNumber()
  shipmentId!: number;

  @IsOptional()
  @IsEnum(ClaimDocumentType)
  documentType?: ClaimDocumentType
  
  @IsOptional()
  @IsArray()
  documents?: Record<string, any>[];

  @IsEnum(ClaimStatus)
  status!: ClaimStatus;
  // --- Contact Person ---
  @IsString()
  @IsNotEmpty()
  contactFullName!: string;

  @IsString()
  @IsNotEmpty()
  contactPhoneNumber!: string;

  @IsEmail()
  contactEmailAddress!: string;

  @IsString()
  @IsNotEmpty()
  claimName!: string;

  // --- Type ---
  @IsEnum(ClaimType)
  claimType!: ClaimType;

  // --- Shared (both missing & damaged) ---
  @IsBoolean()
  additionalInsurancePurchased!: boolean;

  
  @IsEnum(Currency)
  currency!: Currency;

  // --- Missing only ---
  @ValidateIf((o) => o.claimType === ClaimType.MISSING)
  @IsString()
  @IsNotEmpty()
  goodsDescription?: string;

  @ValidateIf((o) => o.claimType === ClaimType.MISSING)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalValueOfGoods?: number;

  @ValidateIf((o) => o.claimType === ClaimType.MISSING)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalValueOfMissingGoods?: number;

  @ValidateIf((o) => o.claimType === ClaimType.MISSING)
  @IsString()
  @IsOptional()
  additionalNotes?: string;

  // --- Damaged only ---
  @ValidateIf((o) => o.claimType === ClaimType.DAMAGED)
  @IsString()
  @IsNotEmpty()
  damageDescription?: string;

  @ValidateIf((o) => o.claimType === ClaimType.DAMAGED)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valueOfDamageClaimed?: number;
}