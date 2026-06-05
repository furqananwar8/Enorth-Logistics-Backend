import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { SignupDTO } from "../dto/signup.dto";
import { EntityManager } from "@mikro-orm/postgresql";
import { User } from "src/entities/user.entity";
import { Address } from "src/entities/address.entity";
import { Company } from "src/entities/company.entity";
import * as bcrypt from 'bcrypt';
import { CompanyShippingPreference } from "src/entities/company-shipping-preference.entity";
import { PackageShipmentVolume, PalletShipmentVolume } from "src/common/enum/shipment-volume.enum";
import { ShippingType } from "src/common/enum/shipping-type.enum";
import { SigninDTO } from "../dto/signin.dto";
import { Role } from "src/entities/role.entity";
import { ROLES } from "src/common/constants/roles";
import { OtpPurpose } from "src/common/enum/otp-purpose.enum";
import { OtpService } from "src/modules/otp/service/otp.service";
import { ForgotPasswordDTO } from "../dto/forgot-password.dto";
import { ResetPasswordDTO } from "../dto/reset-password.dto";
import { Wallet } from "src/entities/wallet.entity";
import { ENV } from "src/common/constants/env";
import { getEnv } from "src/utils/getEnv";
import { SquareClient, SquareEnvironment } from "square";
import { randomUUID } from "crypto";

@Injectable()
export class AuthService{
    private square: any;
    constructor(
        private readonly em: EntityManager,
        private readonly otpService: OtpService
    ){
        const accessToken = getEnv(ENV.SQUARE_ACCESS_TOKEN);
        const envString = (getEnv(ENV.SQUARE_ENVIRONMENT) || 'sandbox').toLowerCase();

        this.square = new SquareClient({
            token: accessToken,
            environment: envString === 'production' 
                ? SquareEnvironment.Production 
                : SquareEnvironment.Sandbox,
        });
    }

    // ── Updated signup method ───────────────────────────────────────
    async signup(dto: SignupDTO) {
        const { user, company, address, shippingPreference } = dto;

        // 1) Fast fail BEFORE starting transaction or Square
        const existingUser = await this.em.findOne(User, { email: user.email });
        if (existingUser) {
            throw new ConflictException("User already exists with this email address");
        }

        // 2) Start Square customer creation in parallel (all data comes from DTO)
        const squarePromise = this.square.customers.create({
            idempotencyKey: randomUUID(),
            emailAddress: user.email,
            givenName: user.firstName,
            familyName: user.lastName,
        }).then(res => res.customer).catch((err) => {
            console.error('Square customer.create error:', err);
            return null;
        });

        let squareCustomer: any = null;

        try {
            const userEntity = await this.em.transactional(async (em) => {
                // 3) Create address
                const addressEntity = em.create(Address, { ...address as Address });

                // 4) Create company
                const companyEntity = em.create(Company, { ...company, address: addressEntity });

                // 5) Create company preferences
                const companyPreference = shippingPreference.map((pref) => {
                    const { shippingType, shippingVolume } = pref;

                    if (shippingVolume) {
                        const palletVolumes = Object.values(PalletShipmentVolume);
                        const packageVolumes = Object.values(PackageShipmentVolume);

                        if (shippingType === ShippingType.PALLET && !palletVolumes.includes(shippingVolume as PalletShipmentVolume))
                            throw new BadRequestException("Invalid pallet shipment volume, volume should be one of: 1-5, 6-10, 11-20, 21-50, >50");

                        if (shippingType === ShippingType.PACKAGE && !packageVolumes.includes(shippingVolume as PackageShipmentVolume))
                            throw new BadRequestException("Invalid package shipment volume, volume should be one of: <25, 26-50, 50-100, 101-300, >300");
                    }

                    return em.create(CompanyShippingPreference, {
                        shippingType: shippingType as ShippingType,
                        shippingVolume: shippingType === ShippingType.PTLORFTL ? null : (shippingVolume as PalletShipmentVolume | PackageShipmentVolume) ?? null,
                        company: companyEntity
                    });
                });

                // 6) Hash password + fetch role IN PARALLEL
                const [hashedPassword, role] = await Promise.all([
                    bcrypt.hash(user.password, 10),
                    em.findOneOrFail(Role, { name: ROLES.ADMIN }),
                ]);

                // 7) Create user
                const userEntity = em.create(User, {
                    ...user,
                    role,
                    password: hashedPassword,
                    company: companyEntity,
                    emailIsVerified: false,
                    isMasterAccount: true,
                    settings: {
                        default_landing_page: "dashboard",
                        home_quick_button: "create_order",
                        language: "en",
                        dark_mode: "dark"
                    }
                });

                // 8) Create wallet
                const wallet = em.create(Wallet, {
                    company: companyEntity,
                    balance: 0,
                    totalDeposited: 0,
                });
                companyEntity.wallet = wallet;

                // 9) Persist all changes
                await em.persist([
                    addressEntity,
                    companyEntity,
                    ...companyPreference,
                    userEntity,
                    wallet,
                ]).flush();

                return userEntity;
            });

            // 10) Square already ran in parallel — just unwrap the result
            squareCustomer = await squarePromise;

            if (!squareCustomer) {
                throw new InternalServerErrorException('Failed to create Square customer');
            }

            // 11) Save squareCustomerId
            userEntity.squareCustomerId = squareCustomer.id;
            await this.em.persist(userEntity).flush();

            // 12) Send OTP (fire and forget)
            this.otpService.generate({
                email: userEntity.email,
                purpose: OtpPurpose.EMAIL_VERIFICATION
            });

            return userEntity;

        } catch (error) {
            // Cleanup: if DB failed but Square succeeded, delete orphan Square customer
            if (!squareCustomer) {
                squareCustomer = await squarePromise;
            }
            if (squareCustomer) {
                await this.square.customers.delete({ customerId: squareCustomer.id }).catch(() => {});
            }
            throw error;
        }
    }
    async signin(dto: SigninDTO) {
        //1) Extract email and password
        const { email, password } = dto;

        //2) Check user exists and throw error for invalid credentials
        const user = await this.em.findOne(User, { email }, { populate: ["role", "permissions", "company.wallet"]});
        
        if(!user){
            throw new UnauthorizedException("Invalid credentials or user not found");
        }

        //4) Compare password and throw error for invalid credentials
        const passwordMatched = await bcrypt.compare(password, user.password);
        
        if(!passwordMatched){
            throw new UnauthorizedException("Invalid credentials")
        }

        //5) Update last login field
        user.lastLogin = new Date();

        (user as any).routePermissions = user.permissions.getItems().map(p => p.name);

        await this.em.persist(user).flush();

        //6) return user
        return user;
    }

    async forgotPassword(dto: ForgotPasswordDTO){
        //1) Extract fields
        const { email } = dto;

        //2) Validate email account
        const user = await this.em.findOne(User, {email}, { fields: ["id"]});

        //3) Throw error for invalid user email
        if(!user){
            throw new BadRequestException("Invalid email address")
        }

        //4) Send otp to email address
        this.otpService.generate({
            email,
            purpose: OtpPurpose.PASSWORD_RESET
        })

        return {
            message: "Otp sent to email successfully"
        };
    }

    async resetPassword(dto: ResetPasswordDTO){
        //1) Extract fields
        const { email, resetToken, password } = dto;

        //2) Check for reset token validity
        const user = await this.em.findOne(User, { email }, { fields: ["id", "password", "resetPasswordToken", "resetPasswordExpires"]});

        //3) Throw error for invalid email
        if(!user){
            throw new BadRequestException("Invalid email address")
        }

        //4) Throw error for invalid reset request
        if(!user.resetPasswordToken || !user.resetPasswordExpires){
            throw new BadRequestException("Invalid reset request");
        }

        //5) Compare token and check it's validity
        const isExpired = (user.resetPasswordExpires as Date) < new Date();

        if(isExpired){
            throw new BadRequestException("Expired reset token, try resetting again")
        }

        //6) Check token validity
        const isValidToken = await bcrypt.compare(resetToken, user.resetPasswordToken as string);

        if(!isValidToken){
            throw new BadRequestException("Invalid reset token");
        }

        //7) Prevent reusing the same password
        const isSamePassword = await bcrypt.compare(password, user.password);

        if (isSamePassword) {
            throw new BadRequestException(
                "New password must be different from the previous password"
            );
        }

        //8) hash user password and update user
        const hashedPassword = await bcrypt.hash(password, 10);

        await this.em.nativeUpdate(User, { id: user.id },{
            password: hashedPassword,
            resetPasswordToken: null,
            resetPasswordExpires: null
        })

        //9) Return success response
        return {
            message: "Password reset successful"
        }
    }
}