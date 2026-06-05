// src/modules/surcharge/surcharge.controller.ts
import { Controller, Post, Body, UsePipes, ValidationPipe, UseGuards, Session } from '@nestjs/common';
import { SessionAuthGuard } from 'src/guards/sessionAuth.guard';
import { CreateSurchargeDto } from '../dto/create-surcharge.dto';
import { SurchargeService } from '../service/surcharge.service';
import type { SessionData } from 'express-session';
import { ROLES } from 'src/common/constants/roles';

import { RolesGuard } from 'src/guards/roles.guard';
import { Role } from 'src/decorators/role.decorator';



@Controller('surcharges')
export class SurchargeController {
  constructor(private readonly surchargeService: SurchargeService) {}

  @Post("/")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Role([ROLES.SUPER_ADMIN, ROLES.STAFF])
  async create(@Body() dto: CreateSurchargeDto, @Session() session: SessionData) {
    return this.surchargeService.create(dto, session);
  }
}