import { Module } from "@nestjs/common";
import { ShipmentCarrierController } from "./controller/shipment-carrier.controller";
import { ShipmentCarrierService } from "./service/shipment-carrier.service";
import { FedExAdapter } from "./adapter/fedex.adapter";
import { TSTCFExpressAdapter } from "./adapter/tst-cf-express.adapter";
import { TForceAdapter } from "./adapter/tforce.adapter";
import { getEnv } from "src/utils/getEnv";
import { ENV } from "src/common/constants/env";
import { XPOAdapter } from "./adapter/xpo.adapter";
import { PaymentModule } from "../payment/payment.module";
import { RequestContextService } from "src/utils/request-context-service";
import { MinimaxAdapter } from "./adapter/minimax.adapter";
import { PolarisAdapter } from "./adapter/polaris.adapter";
import { TrackingUpdateService } from "../tracking/tracking-update.service";
import { TrackingSchedulerService } from "../tracking/tracking-scheduler.service";
import { TrackingWorkerService } from "../tracking/worker/tracking-worker.service";

@Module({
    imports: [
        PaymentModule
    ],
    controllers: [ShipmentCarrierController],
    providers: [
        RequestContextService,
        ShipmentCarrierService,
        TrackingUpdateService,
        TrackingWorkerService,
        TrackingSchedulerService,
        {
            provide: FedExAdapter,
            useFactory: () => new FedExAdapter({
                name: 'fedex',
                clientId: getEnv(ENV.FEDEX_CLIENT_ID)!,
                clientSecret: getEnv(ENV.FEDEX_CLIENT_SECRET)!,
                accountNumber: getEnv(ENV.FEDEX_US_ACCOUNT_NUMBER),
                trackingClientId: getEnv(ENV.FEDEX_CLIENT_TRACKING_ID),
                trackingClientSecret: getEnv(ENV.FEDEX_CLIENT_TRACKING_SECRET)
            }),
        },
        {
            provide: TSTCFExpressAdapter,
            useFactory: () => new TSTCFExpressAdapter({
                baseUrl: getEnv(ENV.TST_CF_BASE_URL),
                requestor: getEnv(ENV.TST_CF_REQUESTOR),          
                authorization: getEnv(ENV.TST_CF_AUTHORIZATION),  
                login: getEnv(ENV.TST_CF_USERNAME),              
                password: getEnv(ENV.TST_CF_PASSWORD),             
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
                baseUrl: getEnv(ENV.TFORCE_BASE_URL)!,
                basePickupUrl: getEnv(ENV.TFORCE_BASE_PICKUP_URL)!,
                apiVersion: 'cie-v1'
            }),
        },
        {
            provide: XPOAdapter,
            useFactory: () => new XPOAdapter({
                name: 'xpo',
                consumerKey: getEnv(ENV.XPO_CONSUMER_KEY!),
                consumerSecret: getEnv(ENV.XPO_CONSUMER_SECRET!),
                accountNumber: getEnv(ENV.XPO_ACCOUNT_NUMBER!),
                username: getEnv(ENV.XPO_USERNAME),
                password: getEnv(ENV.XPO_PASSWORD)
            }),
        },
        {
            provide: MinimaxAdapter,
            useFactory: () => new MinimaxAdapter({
                baseUrl: getEnv(ENV.MINIMAX_BASE_URL)!,
                username: getEnv(ENV.MINIMAX_USERNAME)!,
                password: getEnv(ENV.MINIMAX_PASSWORD)!,
            }),
        },
        {
            provide: PolarisAdapter,
            useFactory: () => new PolarisAdapter({
                baseUrl: getEnv(ENV.POLARIS_BASE_URL)!,
                apiKey: getEnv(ENV.POLARIS_API_KEY)!,
            }),
        },
    ],
    exports: [ShipmentCarrierService]
})
export class ShipmentCarrierModule {}