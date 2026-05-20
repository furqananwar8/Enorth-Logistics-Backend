import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CompanyDTO {
    @IsNotEmpty()
    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    industryType!: string;
}