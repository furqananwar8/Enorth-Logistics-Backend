import { BadRequestException, CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/core";
import { User } from "src/entities/user.entity";

@Injectable()
export class SessionAuthGuard implements CanActivate {

    constructor(private readonly em: EntityManager) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const userId = request.session?.userId;

        if (!userId) {
            throw new BadRequestException({
                message: "User session not found. Please login first.",
                errorCode: "INVALID_SESSION",
            });
        }

        const user = await this.em.findOne(
            User,
            { id: userId },
            {
                populate: ["role", "company", "permissions"],
                fields: ["id", "role.name", "company.id", "permissions"],
            }
        );

        if (!user) {
            request.session.destroy(() => {});

            throw new BadRequestException({
                message: "Session user no longer exists. Please login again",
                errorCode: "INVALID_SESSION",
            });
        }

        request.session.userId = user.id;
        request.session.role = user.role.name;
        request.session.companyId = user?.company?.id;
        request.session.permissions =  user.permissions.getItems().map(p => p.name);

        return true;
    }
}