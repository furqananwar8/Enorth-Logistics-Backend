import { IsString, IsDateString, IsBoolean, IsOptional, IsNumber, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { IsFutureDateTime } from 'src/utils/isFutureDateTime';

export enum Carrier {
  FEDEX = 'FEDEX',
  TST = 'TST',
  TFORCE = 'TFORCE',
  XPO = 'XPO',
  MINIMAX = 'MINIMAX',
  POLARIS = 'POLARIS'
}

class SelectedRateDto {
  @IsString()
  serviceType!: string;

  @IsString()
  @IsOptional()
  serviceName?: string;

  @IsString()
  @IsOptional()
  packagingType?: string;

  @IsNumber()
  totalCharge!: number;

  @IsString()
  currency!: string;

  @IsString()
  @IsOptional()
  transitDays?: string;

  @IsString()
  @IsOptional()
  serviceCode?: string;

  @IsString()
  @IsOptional()
  confirmationNumber?: string;

  @IsNumber()
  @IsOptional()
  totalSurcharges?: number;

  @IsNumber()
  @IsOptional()
  totalDiscount?: number;

  @IsArray()
  @IsOptional()
  surcharges?: Record<string, any>[];
}

export class CreateCarrierShipmentDTO {
  @IsNumber()
  quoteId!: number;

  @IsEnum(Carrier)
  carrier!: Carrier;

  @ValidateNested()
  @Type(() => SelectedRateDto)
  selectedRate!: SelectedRateDto;

  @IsDateString()
  @IsFutureDateTime({
    message: 'shipDate must be greater than current datetime',
  })
  shipDate!: string;

  @IsBoolean()
  @IsOptional()
  tailgatePickup?: boolean;

  @IsBoolean()
  @IsOptional()
  tailgateDelivery?: boolean;

  @IsString()
  @IsOptional()
  pickupType?: string;
}