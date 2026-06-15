import { Module } from "@nestjs/common";
import { ShipmentCarrierController } from "./controller/shipment-carrier.controller";
import { ShipmentCarrierService } from "./service/shipment-carrier.service";
import { FedExAdapter } from "./adapter/fedex.adapter";
import { TSTCFExpressAdapter } from "./adapter/tst-cf-express.adapter";
import { TForceAdapter } from "./adapter/tforce.adapter";
import { getEnv } from "src/utils/getEnv";
import { ENV } from "src/common/constants/env";
import { XPOAdapter } from "./adapter/xpo.adapter";
import { MockCarrierTrackingService } from "../mock-carrier-tracking/service/mock-carrier-tracking.service";
import { BullModule } from "@nestjs/bullmq";
import { PaymentModule } from "../payment/payment.module";
import { RequestContextService } from "src/utils/request-context-service";

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'mock-tracking',
        }),
        PaymentModule
    ],
    controllers: [ShipmentCarrierController],
    providers: [
        RequestContextService,
        ShipmentCarrierService,
        MockCarrierTrackingService,
        {
            provide: FedExAdapter,
            useFactory: () => new FedExAdapter({
                name: 'fedex',
                clientId: getEnv(ENV.FEDEX_CLIENT_ID)!,
                clientSecret: getEnv(ENV.FEDEX_CLIENT_SECRET)!,
                accountNumber: getEnv(ENV.FEDEX_US_ACCOUNT_NUMBER),
            }),
        },
        {
            provide: TSTCFExpressAdapter,
            useFactory: () => new TSTCFExpressAdapter({
                baseUrl: getEnv(ENV.TST_CF_BASE_URL)
            })
        },
        {
            provide: TForceAdapter,
            useFactory: () => new TForceAdapter({
                name: "tforce",
                clientId: getEnv(ENV.TFORCE_CLIENT_ID)!,
                clientSecret: getEnv(ENV.TFORCE_CLIENT_SECRET)!,
                accountNumber: getEnv(ENV.TFORCE_ACCOUNT_NUMBER)!,
                tokenUrl: getEnv(ENV.TFORCE_TOKEN_URL),
                apiScope: getEnv(ENV.TFORCE_API_SCOPE)!,
                apiVersion: 'cie-v1'
            }),
        },
        {
            provide: XPOAdapter,
            useFactory: () => new XPOAdapter({
                name: 'xpo',
                consumerKey: process.env.XPO_CONSUMER_KEY!,
                consumerSecret: process.env.XPO_CONSUMER_SECRET!,
                accountNumber: process.env.XPO_ACCOUNT_NUMBER!,
            }),
        },
    ],
})
export class ShipmentCarrierModule {}