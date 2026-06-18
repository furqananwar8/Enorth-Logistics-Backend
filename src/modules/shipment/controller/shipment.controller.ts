import { Body, Controller, Param, Patch, Post, Session, UseGuards } from "@nestjs/common";
import type { SessionData } from "express-session";
import { SessionAuthGuard } from "src/guards/sessionAuth.guard";
import { ShipmentService } from "../service/shipment.service";
import { CreateShipmentDTO } from "../dto/create-shipment.dto";
import { UpdateShipmentDTO } from "../dto/update-shipment.dto";
import { RolesGuard } from "src/guards/roles.guard";
import { Role } from "src/decorators/role.decorator";
import { ROLES } from "src/common/constants/roles";

@Controller("shipments")
export class ShipmentController {
    constructor(private readonly shipmentService: ShipmentService) {}

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post("/")
    async createShipment(
      @Body() dto: CreateShipmentDTO,
      @Session() session: SessionData
    ) {
      return this.shipmentService.create(dto, session);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Patch("/:id")
    async updateShipment(
      @Body() dto: UpdateShipmentDTO,
      @Param("id") shipmentId: number,
      @Session() session: SessionData
    ) {
      return this.shipmentService.update(dto, shipmentId, session);
    }
}

