import { EntityManager, wrap } from "@mikro-orm/postgresql";
import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { User } from "src/entities/user.entity";
import { CreateProfileDTO } from "../dto/create-profile.dto";
import { Role } from "src/decorators/role.decorator";
import { Permission } from "src/entities/permission.entity";
import { Company } from "src/entities/company.entity";
import bcrypt from "bcrypt";
import { UpdateProfileDTO } from "../dto/update-profile.dto";
import path, { join } from "path";
import * as fs from "fs/promises";
import { UpdatePasswordDTO } from "../dto/update-password.dto";
import { UpdateSettingsDto } from "../dto/user-settings-update.dto";
import { remvoeUndefinedKeysFromDto } from "src/utils/removeUndefinedKeysFromDto";
import { EmailService } from "src/email/service/email.service";
import { UpdateProfileByAdminDTO } from "../dto/update-profile-by-admin.dto";
import { SessionData } from "express-session";
import { ROLES } from "src/common/constants/roles";
import { ENV } from "src/common/constants/env";
import { getEnv } from "src/utils/getEnv";
import { ADMIN_EXCLUDED_PERMISSIONS, STAFF_ALLOWED_PERMISSIONS } from "src/common/constants/permissions";
import { AccountReviewAction } from "src/common/constants/user";
import { buildQuery } from "src/utils/api-query";

@Injectable()
export class UserService {
    constructor(
        private readonly em: EntityManager, 
        private readonly emailService: EmailService
    ) {}

    async reviewAccount(userId: number, action: AccountReviewAction, session: SessionData) {
        const user = await this.em.findOne(User, userId);

        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (action === AccountReviewAction.APPROVE && user.accountIsVerified) {
            throw new BadRequestException('Profile already verified');
        }

        user.accountIsVerified = false;
        user.accountApprovedBy = null;

        if (action === AccountReviewAction.APPROVE) {
            user.accountIsVerified = true;
            user.accountApprovedBy = this.em.getReference(User, session.userId as number);
        }

        this.em.persist(user)
        await this.em.flush();

        return { message: 'Account review successfull'};
    }

    async getProfile(userId: number, session: SessionData): Promise<any> {
        //1) Get the user based on userId
        const user = await this.em.findOne(User, { id: userId }, {
            populate: [
                'company',
                'company.address',
                'company.shippingPreferences',
                'role',
                'permissions',
                'company.wallet',
                'company.savedCards'
            ]
        });

        //2) Throw exception for no user data
        if (!user) {
            throw new BadRequestException("User doesn't exist, Try logging in again");
        }

        //3) Get team members from the same company (excluding self)
        const teamMembers = await this.em.find(User, 
            { 
                company: session.companyId,
                id: { $ne: userId }
            },
            { fields: ['id', 'firstName', 'lastName'] }
        );

        //4) Return user with teamMembers
        return {
            ...wrap(user).toObject(),
            teamMembers: teamMembers.map(u => u)
        };
    }

    async createProfile(
        dto: CreateProfileDTO,
        companyId: number | null | undefined,
        session: SessionData
    ) {
        return this.em.transactional(async (em) => {
            const { roleId, permissionIds, ...userData } = dto;

            // 1) Validate role
            const role = await em.findOne(Role, { id: roleId });
            if (!role) {
                throw new BadRequestException("Invalid role");
            }

            // 2) Prevent non-superAdmin from creating a superAdmin account
            if (role.name === ROLES.SUPER_ADMIN && session.role !== ROLES.SUPER_ADMIN) {
                throw new ForbiddenException("Only a superAdmin can create another superAdmin account");
            }

            // 3) Validate company (optional for SUPER_ADMIN and STAFF)
            const isCompanyOptional = role.name === ROLES.SUPER_ADMIN || role.name === ROLES.STAFF;
            let company: Company | null = null;

            if (companyId) {
                company = await em.findOne(Company, { id: companyId });
                if (!company) {
                    throw new NotFoundException("Company not found");
                }
            } else if (!isCompanyOptional) {
                throw new BadRequestException("Company is required for this role");
            }

            // 4) Validate creator account is verified
            const userDoc = await em.findOne(User, { id: session.userId });
            if (!userDoc?.accountIsVerified) {
                throw new ForbiddenException(
                    "Only approved accounts can create sub-users. Get your account approved by admin first."
                );
            }

            // 5) Validate & resolve permissions
            let permissions: Permission[] = [];

            if (role.name === ROLES.ADMIN) {
                permissions = await em.find(Permission, {
                    name: { $nin: ADMIN_EXCLUDED_PERMISSIONS },
                });
            } else if (role.name === ROLES.SUPER_ADMIN) {
                permissions = await em.find(Permission, {
                    name: { $in: STAFF_ALLOWED_PERMISSIONS },
                });
            } else {
                if (!permissionIds?.length) {
                    throw new BadRequestException("Provide at least one permission for user role");
                }

                const uniquePermissionIds = [...new Set(permissionIds)];
                const count = await em.count(Permission, {
                    id: { $in: uniquePermissionIds },
                });

                if (count !== uniquePermissionIds.length) {
                    throw new BadRequestException("Invalid permissions provided");
                }

                if (role.name === ROLES.STAFF) {
                    permissions = await em.find(Permission, {
                        id:   { $in: uniquePermissionIds },
                        name: { $in: STAFF_ALLOWED_PERMISSIONS },
                    });
                } else {
                    permissions = uniquePermissionIds.map((id) => em.getReference(Permission, id));
                }
            }

            // 6) Hash password
            const dummyPassword = getEnv(ENV.CREATE_PROFILE_PASSWORD);
            const passwordHash = await bcrypt.hash(dummyPassword, 10);

            // 7) Create user
            const user = em.create(User, {
                ...userData,
                password: passwordHash,
                role,
                ...(company ? { company: em.getReference(Company, company.id) } : {}),
                termsAndConditionAccepted: true,
                companyPolicyAccepted: true,
                freightBroker: false,
                accountIsVerified: true,
                emailIsVerified: true,
                settings: {
                    default_landing_page: "dashboard",
                    home_quick_button: "create_order",
                    language: "en",
                    dark_mode: "dark",
                },
            });

            // 8) Assign permissions
            if (permissions.length) {
                user.permissions.set(permissions);
            }

            // 9) Persist user
            await em.persist(user).flush();

            // 10) Send account creation email
            this.emailService.sendProfileCreatedByAdminEmail({
                to: userData.email,
                subject: "Your Account Has Been Created – Login Details",
                template: "create-profile",
                context: {
                    name: `${userData.firstName} ${userData.lastName}`,
                    email: userData.email,
                    password: dummyPassword,
                    ...(company ? { companyName: company.name } : {}),
                    loginUrl: `${process.env.FRONTEND_ORIGIN}/login`,
                },
            });

            // 11) Return user
            return;
        });
    }

    async deleteProfilePic(userId: number) {
        //1) Get user profile
        const user = await this.em.findOne(User, { id: userId }, { fields: ["id", "profilePic"]});

        //2) Throw error if user does not exist
        if (!user) {
            throw new NotFoundException("User does not exist");
        }

        //3) Return if profile pic is already deleted
        if (!user.profilePic) {
            return { message: "Profile picture already removed" };
        }

        //4) Remove image from server (fire and forget)
        const profilePicPath = path.join(process.cwd(), user.profilePic)
        fs.unlink(profilePicPath).catch(() => {});

        //5) Remove profile picture
        user.profilePic = null;

        //6) Persist change
        await this.em.flush();

        //7) Return response
        return {
            message: "Profile picture deleted successfully"
        };
    }

    async update( userId: number, dto: UpdateProfileDTO, file?: Express.Multer.File ) {
        //1) Get the user
        const user = await this.em.findOneOrFail(User, { id: userId });

        //2) Throw not found exception for missing user
        if (!user) {
            throw new NotFoundException("User not found");
        }

        //3) Copy filtered dto into entity
        wrap(user).assign(dto, { ignoreUndefined: true });

        //4) Check for uploaded image
        if (file) {
            //5) Remove old(alreday existed) image
            if (user.profilePic) {
                const oldPath = join(process.cwd(), user.profilePic);

                fs.unlink(oldPath).catch(() => {});
            }
        
            //6) Update new image path in user
            const fileUrl = `/uploads/profile-pics/${file.filename}`;

            user.profilePic = fileUrl;
        }

        //7) Save user
        await this.em.flush();

        //8) Return updated user
        return user;
    }

    async updatePassword(dto: UpdatePasswordDTO, userId: number){
        //1) Extract fields
        const { currentPassword, newPassword, newConfirmPassword } = dto;

        //2) Get the user
        const user = await this.em.findOne(User, { id: userId }, { fields: ["id", "password"] });

        //3) Throw error for no user
        if(!user){
            throw new NotFoundException("User not found")
        }

        //4) Compare newPassword and newConfirmPassword
        if(newPassword !== newConfirmPassword){
            throw new BadRequestException("Passwords do not match")
        }

        //5) Validate old password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

        //6) Throw error for invalid password
        if(!isPasswordValid){
            throw new BadRequestException("Invalid current password")
        }

        //7) Check password is not the same
        const isPasswordSame = await bcrypt.compare(newPassword, user.password);

        //8) Throw error for same old password match
        if(isPasswordSame) {
            throw new BadRequestException("New password must be different from new password")
        }

        //9) Hash password and update user
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await this.em.nativeUpdate(User, { id: userId }, {
            password: hashedPassword
        })

        //10) Return success response
        return {
            message: "Password updated successfully"
        };
    }

    async getAllProfiles(userId: number, session: SessionData) {
        //1) Get all users except the current user
        const users = await this.em.find(User, {
            id: { $ne: userId },
            company: { id: session.companyId }
        }, {
            populate: ["permissions"]
        });

        //2) Return users
        return {
            message: "Profiles retrieved successfully",
            users
        };
    }

    async getAllUnVerifiedAccounts(params: Record<string, any>) {
        // 1) Specify fields allowed for search and filters
        const allowedFields: Record<string, string> = {
            firstName: 'firstName',
            lastName: 'lastName',
            email: 'email',
            username: 'username',
            id: 'id',
        };

        // 2) Pass query params and allowed fields to build query pagination params
        const { search, page, limit, orderBy } = buildQuery(params, allowedFields);

        // 3) Build filter query
        const filter: any = {};

        filter.accountIsVerified = false;
        // ── NEW: Exclude admin / staff / superAdmin roles ──
        const excludedRoles = await this.em.find(
            Role,
            { name: { $in: [ROLES.SUPER_ADMIN, ROLES.STAFF] } },
            { fields: ['id'] },
        );

        if (excludedRoles.length) {
            filter.role = { $nin: excludedRoles };
        }

        // 4) Handle search filter (searches across firstName, lastName, email)
        if (search) {
            filter.$or = [
                { firstName: { $ilike: `${search}%` } },
                { lastName: { $ilike: `${search}%` } },
                { email: { $ilike: `${search}%` } },
            ];
        }

        // 5) Count total users and pages
        const total = await this.em.count(User, filter);
        const totalPages = Math.ceil(total / limit) || 1;

        // 6) Clamp page based on default limit and total user pages
        const clampedPage = Math.min(page, totalPages);
        const offset = (clampedPage - 1) * limit;

        // 7) Fetch data
        const users = await this.em.find(
            User,
            filter,
            {
                limit,
                offset,
                orderBy: Object.entries(orderBy).map(([field, direction]) => ({
                    [field]: direction,
                })),
                populate: ['role', 'company'],
            },
        );

        // 8) Return success response
        return {
            message: 'Users retrieved successfully',
            data: users,
            meta: {
                total,
                page,
                limit,
                totalPages,
                hasNextPage: clampedPage < totalPages,
                hasPrevPage: clampedPage > 1,
                sort: orderBy,
            },
        };
    }

    async deleteProfile(companyId:number, userId: number) {
        //1) Fetch profile
        const user = await this.em.findOne(User, { id: userId, company: companyId });

        //2) Throw error if there is no profile
        if(!user){
            throw new NotFoundException("User not found in this company")
        }

        //3) Delte user profile
        await this.em.remove(user).flush();

        //4) Send back success response
        return {
            message: "Profile deleted successfully"
        };
    }

    async updateSettings(userId: number, dto: UpdateSettingsDto) {
        //1) Get user details
        const user = await this.em.findOne(User, { id: userId });

        //2) Throw error if user does not exist
        if (!user) {
            throw new NotFoundException("User not found");
        }

        //3) Merge new settings with existing settings
        const existingSettings = user.settings || {};

        //4) Filter out undefined key value pairs
        const cleanedDto = remvoeUndefinedKeysFromDto(dto);

        //5) Throw error for empty request payload
        if (Object.keys(cleanedDto).length === 0) {
            throw new BadRequestException("Provide at least one setting to update");
        }

        //6) Update user settings
        user.settings = {
            ...existingSettings,
            ...cleanedDto
        };

        //7) Persist changes
        await this.em.flush();

        //8) Return back success response
        return {
            message: "Settings updated successfully",
            settings: user.settings
        };
    }


    async updateProfileByAdmin(
        dto: UpdateProfileByAdminDTO,
        session: SessionData,
        userId: number,
        loggedInUserId: number
    ) {
        //1) Check if admin is trying to update his account
        if(userId === loggedInUserId){
            throw new ForbiddenException(
                "You cannot update your own profile via this endpoint"
            );
        }

        return await this.em.transactional(async (em) => {

            //2) Extract fields from DTO
            const { firstName, lastName, roleId, permissionIds } = dto;

            //3) Ensure at least one field is provided
            if (
                firstName === undefined &&
                lastName === undefined &&
                roleId === undefined &&
                permissionIds === undefined
            ) {
                throw new BadRequestException(
                    "Provide at least one valid field to update"
                );
            }

            const companyId = session.companyId;

            //4) Fetch user with permissions + role
            const user = await em.findOne(
                User,
                {
                    id: userId,
                    company: { id: companyId },
                },
                {
                    populate: ["permissions", "role"],
                }
            );

            //5) Validate user
            if (!user) {
                throw new ForbiddenException(
                    "You can only update user from your own company"
                );
            }

            //6) Validate role (if provided)
            let role: any = null;

            if (roleId !== undefined) {
                role = await em.findOne(Role, { id: roleId });

                if (!role) {
                    throw new BadRequestException("Invalid roleId");
                }
            }

            //7) Validate permissions
            let validPermissions: Permission[] = [];

            if (permissionIds && permissionIds.length > 0) {
                validPermissions = await em.find(Permission, {
                    id: { $in: permissionIds },
                });

                if (validPermissions.length !== permissionIds.length) {
                    throw new BadRequestException(
                        "Some permissionIds are invalid"
                    );
                }
            }

            //8) Validate role and permissionIds
            if (role) {
                const previousRole = user.role.name;
                const newRole = role.name;

                //9) Manage ADMIN → USER role and permissions
                if (previousRole === ROLES.ADMIN && newRole === ROLES.USER) {
                    if (!permissionIds || permissionIds.length === 0) {
                        throw new BadRequestException(
                            "Permissions are required when assigning USER role"
                        );
                    }

                    //10) Clear permissions
                    await em.nativeDelete("user_permissions", {
                        user_id: user.id,
                    });

                    //11) Assign new permissions
                    user.permissions.set(validPermissions);
                }

                //12) Manage USER → ADMIN role and permissions
                if (previousRole === ROLES.USER && newRole === ROLES.ADMIN) {
                    await em.nativeDelete("user_permissions", {
                        user_id: user.id,
                    });
                }

                //13) Manage USER → USER role and permissions
                if (previousRole === ROLES.USER && newRole === ROLES.USER) {
                    if (permissionIds) {
                        await em.nativeDelete("user_permissions", {
                            user_id: user.id,
                        });

                        user.permissions.set(validPermissions);
                    }
                }

                //14) Update role
                user.role = role;
            }

            //15) Throw error for 
            if (!role && permissionIds) {
                if (user.role.name !== ROLES.USER) {
                    throw new BadRequestException(
                        "Only USER role can have permissions"
                    );
                }

                await em.nativeDelete("user_permissions", {
                    user_id: user.id,
                });

                user.permissions.set(validPermissions);
            }

            //16) Update user fields
            if (firstName !== undefined) {
                user.firstName = firstName;
            }

            if (lastName !== undefined) {
                user.lastName = lastName;
            }

            //17) Flush once at the end
            await em.flush();

            //18) Return back success reponse
            return {
                message: "User profile updated successfully",
            };
        });
    }
}