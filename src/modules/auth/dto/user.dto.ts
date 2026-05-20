import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class UserDTO {
    @IsNotEmpty()
    @IsString()
    firstName!: string;

    @IsNotEmpty()
    @IsString()
    lastName!: string;

    @IsEmail()
    @IsString()
    email!: string;

    @IsNotEmpty()
    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/, {
        message: "Phone number must be in international format (e.g., +923001234567)"
    })
    phoneNumber!: string;

    @IsNotEmpty()
    @IsString()
    @MinLength(2)
    @MaxLength(12)
    username!: string;

    @IsOptional()
    @IsString()
    @MinLength(8)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])[^\s]{8,}$/, { 
        message: "newConfirmPassword must contain at least 8 characters, including uppercase, lowercase, number, and special character"
    })
    password!: string;

    @IsOptional()
    @IsString()
    signupCode!: string;

    @IsBoolean()
    termsAndConditionAccepted!: boolean;

    @IsBoolean()
    companyPolicyAccepted!: boolean;

    @IsBoolean()
    freightBroker!: boolean;
}