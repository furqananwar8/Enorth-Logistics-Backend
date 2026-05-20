import { IsNotEmpty, ValidateNested } from "class-validator";
import { AddressDTO } from "./address.dto";
import { CompanyShippingPreferenceEntity } from "./company-shipping-preference.dto";
import { CompanyDTO } from "./company.dto";
import { UserDTO } from "./user.dto";
import { Type } from "class-transformer";

export class SignupDTO {
    @IsNotEmpty()
    @ValidateNested()
    @Type(() => UserDTO)
    user!: UserDTO

    @IsNotEmpty()
    @ValidateNested()
    @Type(() => CompanyDTO)
    company!: CompanyDTO

    @IsNotEmpty()
    @ValidateNested()
    @Type(() => AddressDTO)
    address!: AddressDTO

    @IsNotEmpty()
    @ValidateNested()
    @Type(() => CompanyShippingPreferenceEntity)
    shippingPreference!: CompanyShippingPreferenceEntity[]
}