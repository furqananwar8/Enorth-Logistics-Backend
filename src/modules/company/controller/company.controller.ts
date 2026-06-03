import { Body, Controller, Get, Param, Patch, Req, Session, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "src/guards/sessionAuth.guard";
import { UpdateCompanyDTO } from "../dto/update-company.dto";
import { CompanyService } from "../service/company.service";
import type { Request } from "express";
import { UpdateCompanyRatesDTO } from "../dto/update-company-rates.dto";
import { Role } from "src/decorators/role.decorator";

import { RolesGuard } from "src/guards/roles.guard";
import { ROLES } from "src/common/constants/roles";
import type { SessionData } from "express-session";

@Controller("companies")
export class CompanyController {
    constructor(private readonly companyService: CompanyService) {}

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.STAFF, ROLES.SUPER_ADMIN])
    @Get('/')
    async getAll(@Session() session: SessionData, @Param() params: Record<string, any>) {
        return this.companyService.getAll(session, params);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.STAFF, ROLES.SUPER_ADMIN])
    @Patch(':id/rates')
    async updateRates(
        @Param('id') id: number,
        @Body() dto: UpdateCompanyRatesDTO,
    ) {
        return this.companyService.updateRates(id, dto);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Patch("/:id")
    async Update(@Body() dto: UpdateCompanyDTO, @Param("id") companyId: number, @Req() req: Request) {
        const session = req.session;
        
        return this.companyService.update(dto, companyId, session);
    }
}