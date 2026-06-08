// src/modules/quote/dto/update-quote.dto.ts

import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { QuoteType } from "src/common/enum/quote-type.enum";
import { ShipmentType } from "src/common/enum/shipment-type.enum";
import { MeasurementUnits } from "src/common/enum/measurement-units.enum";
import { Currency } from "src/common/enum/currency.enum";
import { SpotType } from "src/common/enum/spot-type.enum";
import { QuoteStatus } from "src/common/enum/quote-status";
import { LineItemUnitType } from "src/common/enum/line-item-unit-type";

// ==================== Address DTO ====================
export class AddressDTO {
  @IsOptional()
  @IsString()
  type?: "FROM" | "TO";

  @IsOptional()
  @IsString()
  address1?: string;

  @IsOptional()
  @IsString()
  address2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsNumber()
  locationType?: number;

  @IsOptional()
  @IsString()
  additionalNotes?: string;

  @IsOptional()
  @IsNumber()
  addressBookId?: number;

  @IsOptional()
  @IsBoolean()
  isResidential?: boolean;

  // STANDARD_FTL specific
  @IsOptional()
  @IsBoolean()
  includeStraps?: boolean;

  @IsOptional()
  @IsBoolean()
  appointmentDelivery?: boolean;
}

// ==================== Unit DTO ====================
export class UnitDTO {
  @IsOptional()
  @IsNumber()
  id?: number;

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

  @IsOptional()
  @IsString()
  freightClass?: string;

  @IsOptional()
  @IsString()
  nmfc?: string;

  @IsOptional()
  @IsNumber()
  unitsOnPallet?: number;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  specialHandlingRequired?: boolean;

  @IsEnum(LineItemUnitType)
  @IsOptional()
  palletUnitType?: LineItemUnitType
}

// ==================== Line Item DTO ====================
export class LineItemDTO {
  @IsOptional()
  @IsEnum(ShipmentType)
  type?: ShipmentType;

  @IsOptional()
  @IsEnum(MeasurementUnits)
  measurementUnit?: MeasurementUnits;

  @IsOptional()
  @IsObject()
  dangerousGoods?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnitDTO)
  units?: UnitDTO[];
}

// ==================== Insurance DTO ====================
export class InsuranceDTO {
  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

export class LooseFreightDTO {
  @IsNumber()
  totalWeight!: number;

  @IsString()
  measurementUnit!: string; // or use an enum if you have one

  @IsNumber()
  totalCount!: number;
}

// ==================== Services DTO ====================
export class ServicesDTO {
  // PALLET services
  @IsOptional()
  @IsString()
  limitedAccess?: string;

  @IsOptional()
  @IsString()
  limitedAccessDescription?: string;
  
  @IsOptional()
  @IsBoolean()
  appointmentDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  thresholdDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  thresholdPickup?: boolean;

  // STANDARD_FTL services
  @IsOptional()
  @ValidateNested()
  @Type(() => LooseFreightDTO)
  looseFreight?: LooseFreightDTO;

  @IsOptional()
  @IsBoolean()
  pallets?: boolean;

  // SPOT_LTL services
  @IsOptional()
  @IsObject()
  inbound?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  protectFromFreeze?: boolean;
}

// ==================== Spot Contact DTO ====================
export class SpotContactDTO {
  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  shipDate?: string;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  spotQuoteName?: string;
}

// ==================== Spot Equipment DTO ====================
export class SpotEquipmentDTO {
  @IsOptional()
  @IsBoolean()
  car?: boolean;

  @IsOptional()
  @IsBoolean()
  dryVan?: boolean;

  @IsOptional()
  @IsBoolean()
  flatbed?: boolean;

  @IsOptional()
  @IsBoolean()
  truck?: boolean;

  @IsOptional()
  @IsBoolean()
  van?: boolean;

  @IsOptional()
  @IsBoolean()
  ventilated?: boolean;

  @IsOptional()
  refrigerated?: { type: string };

  @IsOptional()
  nextFlightOut?: { knownShipper?: boolean };
}

// ==================== Spot Details DTO ====================
export class SpotDetailsDTO {
  @IsOptional()
  @IsEnum(SpotType)
  spotType?: SpotType;

  @IsOptional()
  @ValidateNested()
  @Type(() => SpotContactDTO)
  spotContact?: SpotContactDTO;

  @IsOptional()
  @ValidateNested()
  @Type(() => SpotEquipmentDTO)
  spotEquipment?: SpotEquipmentDTO;

  @IsOptional()
  spotRequirements?: Record<string, any>;
}

// ==================== Main Update Quote DTO ====================
export class UpdateQuoteDTO {
  @IsOptional()
  @IsEnum(ShipmentType)
  shipmentType?: ShipmentType;

  @IsOptional()
  @IsEnum(QuoteType)
  quoteType?: QuoteType;

  @IsOptional()
  @IsBoolean()
  knownShipper?: boolean;

  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;

  @IsOptional()
  @IsNumber()
  signature?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddressDTO)
  addresses?: AddressDTO[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LineItemDTO)
  lineItem?: LineItemDTO;

  @IsOptional()
  @ValidateNested()
  @Type(() => InsuranceDTO)
  insurance?: InsuranceDTO;

  @IsOptional()
  @ValidateNested()
  @Type(() => ServicesDTO)
  services?: ServicesDTO;

  @IsOptional()
  @ValidateNested()
  @Type(() => SpotDetailsDTO)
  spotDetails?: SpotDetailsDTO;
}