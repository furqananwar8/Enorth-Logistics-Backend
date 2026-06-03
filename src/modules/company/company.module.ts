import { Module } from "@nestjs/common";
import { CompanyController } from "./controller/company.controller";
import { CompanyService } from "./service/company.service";
import { RequestContextService } from "src/utils/request-context-service";

@Module({
    controllers: [CompanyController],
    providers: [CompanyService, RequestContextService]
})

export class CompanyModule {}