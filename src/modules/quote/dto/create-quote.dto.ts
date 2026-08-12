import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsArray,
  IsNumber,
  IsString,
  IsBoolean,
  IsEmail,
  IsDate,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuoteType } from 'src/common/enum/quote-type.enum';
import { ShipmentType } from 'src/common/enum/shipment-type.enum';
import { Currency } from 'src/common/enum/currency.enum';
import { AddressType } from 'src/common/enum/address-type.enum';
import { SpotFtlServices } from 'src/entities/spot-ftl-services.entity';
import { SpotLtlServices } from 'src/entities/spot-ltl-services.entity';
import { StandardFtlServices } from 'src/entities/standard-ftl-services.entity';
import { PalletServices } from 'src/entities/pallet-services.entity';
import { MeasurementUnits } from 'src/common/enum/measurement-units.enum';
import { SpotType } from 'src/common/enum/spot-type.enum';
import { RefrigeratedType } from 'src/common/enum/refrigerated.enum';
import { QuoteStatus } from 'src/common/enum/quote-status';
import { LineItemUnitType } from 'src/common/enum/line-item-unit-type';
import { DangerousGoodsClass } from 'src/common/enum/line-item.enum';

/* ---------------- ADDRESS ---------------- */

export class CreateAddressDto {
  @IsEnum(AddressType)
  type!: AddressType;

  @IsOptional()
  @IsNumber()
  addressBookId?: number;

  // Location type
  @IsOptional()
  @IsNumber()
  locationType?: number;

  // Required only if addressBookId is NOT provided
  @IsOptional()
  @IsBoolean()
  isResidential?: boolean;

  @IsOptional()
  @IsString()
  address1?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  // FTL only
  @IsOptional()
  @IsBoolean()
  includeStraps?: boolean;

  @IsOptional()
  @IsBoolean()
  appointmentDelivery?: boolean;

  // Spot only
  @IsOptional()
  @IsString()
  additionalNotes?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
  
  @IsOptional()
  @IsString()
  palletShippingReadyTime?: string;

  @IsOptional()
  @IsString()
  palletShippingCloseTime?: string;

  @IsOptional()
  @IsNumber()
  signatureId?: number;
}

/* ---------------- LINE ITEM UNIT ---------------- */

export class CreateLineItemUnitDto {
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  length?: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  // Pallet specific
  @IsOptional()
  @IsString()
  freightClass?: string;

  @IsOptional()
  @IsString()
  nmfc?: string;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsNumber()
  unitsOnPallet?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  dangerousGoods?: Record<string, any>;
  
  @IsOptional()
  @IsBoolean()
  specialHandlingRequired?: boolean;

  @IsEnum(LineItemUnitType)
  @IsOptional()
  palletUnitType?: LineItemUnitType

}

/* ---------------- LINE ITEM ---------------- */
export class DangerousGoodsDTO {
  @IsString()
  @IsNotEmpty()
  un!: string;

  @IsEnum(DangerousGoodsClass)
  class!: DangerousGoodsClass;
}
export class CreateLineItemDto {
  @IsOptional()
  @IsBoolean()
  hasStandardSize?: boolean;
  
  @IsEnum(ShipmentType)
  type!: ShipmentType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLineItemUnitDto)
  units!: CreateLineItemUnitDto[];

  @IsEnum(MeasurementUnits)
  measurementUnit!: MeasurementUnits
  
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DangerousGoodsDTO)
  dangerousGoods?: DangerousGoodsDTO;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;
}

/* ---------------- INSURANCE ---------------- */

export class CreateInsuranceDto {
  @IsNumber()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;
}

/* ---------------- SPOT DETAILS ---------------- */
export class CreateSpotContactDto {
  @IsNotEmpty()
  @IsString()
  contactName!: string;

  @IsNotEmpty()
  @IsString()
  phoneNumber!: string;

  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  shipDate!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deliveryDate!: Date;

  @IsOptional()
  @IsString()
  spotQuoteName?: string;
}

export class RefrigeratedDto {
  @IsOptional()
  @IsEnum(RefrigeratedType)
  type?: RefrigeratedType;
}

export class NextFlightOutDto {
  @IsOptional()
  @IsBoolean()
  knownShipper?: boolean;
}


export class CreateSpotEquipmentDto {
  @IsOptional()
  @IsBoolean()
  truck?: boolean;

  @IsOptional()
  @IsBoolean()
  car?: boolean;

  @IsOptional()
  @IsBoolean()
  van?: boolean;

  @IsOptional()
  @IsBoolean()
  dryVan?: boolean;

  @IsOptional()
  @IsBoolean()
  flatbed?: boolean;

  @IsOptional()
  @IsBoolean()
  ventilated?: boolean;

  // Nested object
  @IsOptional()
  @ValidateNested()
  @Type(() => RefrigeratedDto)
  refrigerated?: RefrigeratedDto;

  // Nested object
  @IsOptional()
  @ValidateNested()
  @Type(() => NextFlightOutDto)
  nextFlightOut?: NextFlightOutDto;
}

export class CreateSpotDetailsDto {
  @IsNotEmpty()
  @IsEnum(SpotType)
  spotType!: SpotType;

  @ValidateNested()
  @Type(() => CreateSpotContactDto)
  spotContact!: CreateSpotContactDto

  @ValidateNested()
  @Type(() => CreateSpotEquipmentDto)
  spotEquipment!: CreateSpotEquipmentDto

  @IsOptional()
  @IsBoolean()
  knownShipper?: boolean;
}

export class EstimatedAmountDTO {
  @IsNumber()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;
}
/* ---------------- ROOT DTO ---------------- */

export class CreateQuoteDTO {
  @IsOptional()
  id?: number
      
  @IsOptional()
  @ValidateNested()
  @Type(() => EstimatedAmountDTO)
  estimatedAmount?: EstimatedAmountDTO;

  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;
  
  @IsEnum(QuoteType)
  quoteType!: QuoteType;

  @IsEnum(ShipmentType)
  shipmentType!: ShipmentType;

  @IsOptional()
  @IsNumber()
  signature?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAddressDto)
  addresses?: CreateAddressDto[];

  @ValidateNested()
  @Type(() => CreateLineItemDto)
  lineItem?: CreateLineItemDto;
  
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateInsuranceDto)
  insurance?: CreateInsuranceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSpotDetailsDto)
  spotDetails?: CreateSpotDetailsDto;

  @IsOptional()
  additionalNotes?: string;
  
  @IsOptional()
  services?: SpotFtlServices | SpotLtlServices | StandardFtlServices | PalletServices;
}