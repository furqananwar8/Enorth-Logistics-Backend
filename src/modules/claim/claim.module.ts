import { Module } from "@nestjs/common";
import { ClaimService } from "./service/claim.service";
import { ClaimController } from "./controller/claim.controller";
import { RequestContextService } from "src/utils/request-context-service";

@Module({
    imports: [],
    controllers: [ClaimController],
    providers: [ClaimService, RequestContextService]
})

export class ClaimModule {}