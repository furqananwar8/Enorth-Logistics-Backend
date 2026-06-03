import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class AddressDTO {
    @IsNotEmpty()
    @IsString()
    address1?: string;

    @IsOptional()
    @IsString()
    address2?: string;
    
    @IsOptional()
    @IsString()
    unit?: string;

    @IsNotEmpty()
    @IsString()
    postalCode?: string;

    @IsNotEmpty()
    @IsString()
    country?: string;

    @IsNotEmpty()
    @IsString()
    city?: string;

    @IsNotEmpty()
    @IsString()
    state?: string;

}