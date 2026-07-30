// dto/create-shipment.dto.ts
import { IsDateString, IsBoolean, IsEnum, IsArray, ValidateNested, IsString, IsOptional, IsNotEmptyObject, ValidatorConstraint, ValidatorConstraintInterface, Validate } from 'class-validator';
import { Type } from 'class-transformer';
import { ShipmentType } from 'src/common/enum/shipment-type.enum';
import { CreateQuoteDTO } from 'src/modules/quote/dto/create-quote.dto';
import { Mode } from 'src/common/enum/mode.enum';

@ValidatorConstraint({ name: 'isFutureDate', async: false })
// class IsFutureDateConstraint implements ValidatorConstraintInterface {
//   validate(value: string) {
//     const date = new Date(value);
//     if (isNaN(date.getTime())) return false;
//     const now = new Date();
//     now.setHours(0, 0, 0, 0);
//     const input = new Date(date);
//     input.setHours(0, 0, 0, 0);
//     return input >= now;
//   }
//   defaultMessage() {
//     return 'shipDate must be today or a future date';
//   }
// }

export class CreateShipmentDTO {
    @IsEnum(Mode)
    mode!: Mode
    
    @IsDateString()
    // @Validate(IsFutureDateConstraint)
    shipDate!: string;

    @IsEnum(ShipmentType)
    shipmentType!: ShipmentType;

    @IsNotEmptyObject()
    @ValidateNested()
    @Type(() => CreateQuoteDTO)
    quote?: CreateQuoteDTO;

    @IsBoolean()
    @IsOptional()
    tailgateRequiredInToAddress?: boolean;

    @IsBoolean()
    @IsOptional()
    tailgateRequiredInFromAddress?: boolean;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    billingReferences?: string[];
}