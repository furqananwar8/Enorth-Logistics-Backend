import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MinLength } from "class-validator";

export class CreateProfileDTO {
    @IsNotEmpty()
    @IsString()
    firstName!: string;

    @IsNotEmpty()
    @IsString()
    lastName!: string;
    
    @IsNotEmpty()
    @IsString()
    email!: string;
    
    @IsNotEmpty()
    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/, {
        message: "Phone number must be in international format (e.g., +923001234567)"
    })
    phoneNumber!: string;

    @IsNotEmpty()
    @IsNumber()
    roleId!: number;

    @IsOptional()
    @IsArray()
    permissionIds?: number[];
}   