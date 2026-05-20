import { Controller, Get, Session, UseGuards } from "@nestjs/common";
import { PermissionService } from "../service/permission.service";
import { SessionAuthGuard } from "src/guards/sessionAuth.guard";
import { RolesGuard } from "src/guards/roles.guard";
import { Role } from "src/decorators/role.decorator";
import { ROLES } from "src/common/constants/roles";
import type { SessionData } from "express-session";

@Controller("permissions")
export class PermissionController {
    constructor(private readonly permissionService: PermissionService) {}

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.SUPER_ADMIN])
    @Get("/")
    async getAll(@Session() session: SessionData){
        return this.permissionService.getAll(session);
    }
}