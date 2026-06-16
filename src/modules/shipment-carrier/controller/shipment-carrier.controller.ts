import { EntityManager } from "@mikro-orm/postgresql";
import { Body, Controller, Post, Req, Res, Session, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "src/guards/sessionAuth.guard";
import { ShipmentCarrierService } from "../service/shipment-carrier.service";
import type { Request, Response } from "express";
import { CreateCarrierShipmentDTO } from "src/modules/shipment-carrier/dto/create-carrier-shipment.dto";
import { ShipmentRatesStreamDTO } from "../dto/shipment-rates-stream.dto";
import type { SessionData } from "express-session";
import { RequestContextService } from "src/utils/request-context-service";
import { RolesGuard } from "src/guards/roles.guard";
import { Role } from "src/decorators/role.decorator";
import { ROLES } from "src/common/constants/roles";
import { ShipmentStatusDTO } from "../dto/get-shipment-status.dto";

@Controller("shipment-carriers")
export class ShipmentCarrierController {
    constructor(private readonly em: EntityManager,
        private readonly shipmentCarrierService: ShipmentCarrierService,
        private readonly requestContextService: RequestContextService
    ) {}

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post("/rates")
    async GetShipmentCarriersRates(@Body() dto: ShipmentRatesStreamDTO, @Session() session: SessionData){
        const ctx = await this.requestContextService.resolve({ session, em: this.em });

        const companyBasedRates = { LTLRate: ctx.company?.ltlRateToBeChargedPerShipment, FTLRate: ctx.company?.ftlRateToBeChargedPerShipment }
        return this.shipmentCarrierService.getShipmentCarriersRates(dto, companyBasedRates);
    }


    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post('/rates/stream')
    async StreamShipmentCarriersRates(
        @Body() dto: ShipmentRatesStreamDTO,
        @Res() res: Response,
        @Req() req: Request,
        @Session() session: SessionData
    ) {
        const ctx = await this.requestContextService.resolve({ session, em: this.em });

        const companyBasedRates = { LTLRate: ctx.company?.ltlRateToBeChargedPerShipment, FTLRate: ctx.company?.ftlRateToBeChargedPerShipment }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        res.flushHeaders();

        const stream$ = this.shipmentCarrierService.getShipmentCarriersRatesStream(dto,companyBasedRates);

        const subscription = stream$.subscribe({
            next: (event) => {
                if (!res.writableEnded) {
                    res.write(`data: ${event.data}\n\n`);
                }
            },
            error: (err) => {
                if (!res.writableEnded) {
                    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
                    res.end();
                }
            },
            complete: () => {
                if (!res.writableEnded) {
                    res.write(`event: complete\ndata: ${JSON.stringify({ done: true })}\n\n`);
                    res.end();
                }
            },
        });

        req.on('close', () => {
            subscription.unsubscribe();
            if (!res.writableEnded) {
                res.end();
            }
        });
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post('/shipments')
    async CreateShipment(@Body() dto: CreateCarrierShipmentDTO, @Session() session: SessionData){
        return this.shipmentCarrierService.createShipment(dto, session);
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post('/webhook-events')
    async ManageWebhookEvents(@Body() dto: any) {
        return dto;
    }

    @UseGuards(SessionAuthGuard, RolesGuard)
    @Role([ROLES.ADMIN, ROLES.USER])
    @Post('track')
    async trackShipment(@Body() dto: ShipmentStatusDTO) {
    return this.shipmentCarrierService.trackShipment(dto);
    }
}