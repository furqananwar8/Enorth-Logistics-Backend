import { EntityManager } from "@mikro-orm/core";
import { Controller, Get, Query, UseGuards, Session } from "@nestjs/common";
import type { SessionData } from "express-session";
import { SessionAuthGuard } from "src/guards/sessionAuth.guard";
import { TrackingService } from "../service/tracking.service";
import { RolesGuard } from "src/guards/roles.guard";
import { ROLES } from "src/common/constants/roles";
import { Role } from "src/decorators/role.decorator";

@Controller("trackings")
export class TrackingController {
    constructor(private readonly em: EntityManager,
                private readonly trackingService: TrackingService
    ) {}

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Get("/")
    async GetAllTrackingsAgainstCurrentUserCompany(@Query() queryParams: any, @Session() session: SessionData) {
        return this.trackingService.getAllTrackingsAgainstCurrentUserCompany(session, queryParams)
    }
}