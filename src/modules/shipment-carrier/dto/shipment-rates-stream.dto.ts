import {
  IsString,
  IsEnum,
  IsArray,
  IsObject,
  ValidateNested,
  IsOptional,
  IsNumber,
  Min,
  ArrayMinSize,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShipmentType } from '../adapter/fedex.adapter';

export enum QuoteType {
  STANDARD = 'STANDARD',
  SPOT = 'SPOT',
}

export enum PickupType {
  DROPOFF_AT_FEDEX_LOCATION = 'DROPOFF_AT_FEDEX_LOCATION',
  CONTACT_FEDEX_TO_SCHEDULE = 'CONTACT_FEDEX_TO_SCHEDULE',
  USE_SCHEDULED_PICKUP = 'USE_SCHEDULED_PICKUP',
}

export enum ServiceType {
  FEDEX_EXPRESS_SAVER = 'FEDEX_EXPRESS_SAVER',
  FEDEX_GROUND = 'FEDEX_GROUND',
  FEDEX_2_DAY = 'FEDEX_2_DAY',
  STANDARD_OVERNIGHT = 'STANDARD_OVERNIGHT',
}

export enum RateRequestType {
  LIST = 'LIST',
  ACCOUNT = 'ACCOUNT',
  PREFERRED = 'PREFERRED',
}

export enum WeightUnit {
  LB = 'LB',
  KG = 'KG',
}

export enum DimensionsUnit {
  IN = 'IN',
  CM = 'CM',
}

export enum Packaging {
  BOX = 'BOX',
  FEDEX_ENVELOPE = 'FEDEX_ENVELOPE',
  FEDEX_PAK = 'FEDEX_PAK',
  FEDEX_TUBE = 'FEDEX_TUBE',
  YOUR_PACKAGING = 'YOUR_PACKAGING',
}

// ─── Address ─────────────────────────────────────

class AddressDTO {
  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  address!: string;

  @IsString()
  postalCode!: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;
}

// XPO Location ─────────────────────────────────────
export enum CountryCode {
  US = 'US',
  CA = 'CA',
  MX = 'MX',
}

export class XPOLocationDTO {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsString()
  postalCode!: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsOptional()
  @IsEnum(CountryCode)
  countryCode?: CountryCode = CountryCode.US;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsBoolean()
  isResidential?: boolean = false;
}

// ─── FedEx Location ──────────────────────────────
class FedExLocationDTO {
  @IsString()
  postalCode!: string;

  @IsString()
  countryCode!: string;
}

class TForceLocationDTO {
  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsString()
  postalCode!: string;

  @IsString()
  countryCode!: string;

  @IsOptional()
  @IsBoolean()
  isResidential?: boolean;
}

// ─── Minimax Location ──────────────────────────────
class MinimaxLocationDTO {
  @IsString()
  postalCode!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsEnum(CountryCode)
  countryCode?: CountryCode = CountryCode.CA;
}

// ─── Polaris Location ──────────────────────────────
class PolarisLocationDTO {
  @IsString()
  postalCode!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsEnum(CountryCode)
  countryCode?: CountryCode = CountryCode.CA;

  @IsOptional()
  @IsBoolean()
  residentialPickup?: boolean;

  @IsOptional()
  @IsBoolean()
  residentialDelivery?: boolean;

}

// ─── FedEx Section ─────────────────────────────────

class FedExDTO {
  @ValidateNested()
  @Type(() => FedExLocationDTO)
  from!: FedExLocationDTO;

  @ValidateNested()
  @Type(() => FedExLocationDTO)
  to!: FedExLocationDTO;
}

// ─── TST Section ───────────────────────────────────

class TSTDTO {
  @ValidateNested()
  @Type(() => AddressDTO)
  from!: AddressDTO;

  @ValidateNested()
  @Type(() => AddressDTO)
  to!: AddressDTO;
}

class XPODTO {
  @ValidateNested()
  @Type(() => XPOLocationDTO)
  from!: XPOLocationDTO;

  @ValidateNested()
  @Type(() => XPOLocationDTO)
  to!: XPOLocationDTO;
}

class TforceDTO {
  @ValidateNested()
  @Type(() => TForceLocationDTO)
  from!: TForceLocationDTO;

  @ValidateNested()
  @Type(() => TForceLocationDTO)
  to!: TForceLocationDTO;
}

// ─── Minimax Section ───────────────────────────────
class MinimaxDTO {
  @ValidateNested()
  @Type(() => MinimaxLocationDTO)
  from!: MinimaxLocationDTO;

  @ValidateNested()
  @Type(() => MinimaxLocationDTO)
  to!: MinimaxLocationDTO;
}


// ─── Minimax Section ───────────────────────────────
class PolarisDTO {
  @ValidateNested()
  @Type(() => PolarisLocationDTO)
  from!: PolarisLocationDTO;

  @ValidateNested()
  @Type(() => PolarisLocationDTO)
  to!: PolarisLocationDTO;
}
// ─── Package ───────────────────────────────────────

class PackageDTO {
  @IsEnum(WeightUnit)
  weightUnit!: WeightUnit;

  @IsNumber()
  @IsOptional()
  weight!: number;

  @IsEnum(DimensionsUnit)
  dimensionsUnit!: DimensionsUnit;

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
  handlingUnits!: number;

  @IsOptional()
  @IsEnum(Packaging)
  packaging?: Packaging;
}

// ─── Main DTO ──────────────────────────────────────

export class ShipmentRatesStreamDTO {
  @IsEnum(QuoteType)
  quoteType!: QuoteType;

  @IsEnum(ShipmentType)
  shipmentType!: ShipmentType;

  @IsObject()
  @ValidateNested()
  @Type(() => FedExDTO)
  fedex?: FedExDTO;

  @IsObject()
  @ValidateNested()
  @Type(() => TSTDTO)
  tst?: TSTDTO;

  @IsObject()
  @ValidateNested()
  @Type(() => XPODTO)
  xpo?: XPODTO;

  @IsObject()
  @ValidateNested()
  @Type(() => TforceDTO)
  tforce?: TforceDTO;

  @IsObject()
  @ValidateNested()
  @Type(() => MinimaxDTO)
  minimax?: MinimaxDTO;

  @IsObject()
  @ValidateNested()
  @Type(() => PolarisDTO)
  polaris?: PolarisDTO;

  @IsEnum(PickupType)
  pickupType!: PickupType;

  @IsEnum(RateRequestType, { each: true })
  @IsArray()
  @ArrayMinSize(1)
  rateRequestType!: RateRequestType[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageDTO)
  @ArrayMinSize(1)
  packages!: PackageDTO[];

  @IsOptional()
  @IsObject()
  services?: Record<string, any>;
  
  @IsBoolean()
  stackable?: boolean;
}