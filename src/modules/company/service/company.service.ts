import { EntityManager } from "@mikro-orm/postgresql";
import { UpdateCompanyDTO } from "../dto/update-company.dto";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Company } from "src/entities/company.entity";
import { wrap } from "@mikro-orm/core";
import { UpdateCompanyRatesDTO } from "../dto/update-company-rates.dto";
import { SessionData } from "express-session";
import { buildQuery } from "src/utils/api-query";
import { RequestContextService } from "src/utils/request-context-service";

@Injectable()
export class CompanyService {
    constructor(
        private readonly em: EntityManager,
        private readonly requestContextService: RequestContextService,
    ) {}

    async update(dto: UpdateCompanyDTO, companyId: number, session: Record<string,any>) {
        //1) Check if company belongs to current user
        if(session.companyId !== companyId){
           throw new ForbiddenException("You can only update your own company");
        }

        //2) Extract fields
        const {
            name,
            industryType,
            unit,
            city,
            state,
            country,
            postalCode,
            address1,
            address2
        } = dto;

        //3) Find company with address relation
        const company = await this.em.findOne(
            Company,
            { id: companyId },
            { populate: ["address"] }
        );

        //4) Throw error for missing company
        if (!company) {
            throw new NotFoundException("Company not found");
        }

        //5) Update company fields
        wrap(company).assign({
            name,
            industryType
        }, { ignoreUndefined: true });

        //6) Update address fields if relation exists
        if (company.address) {
            wrap(company.address).assign({
                unit,
                city,
                state,
                country,
                postalCode,
                address1,
                address2
            }, { ignoreUndefined: true });
        }

        //7) Persist changes
        await this.em.flush();

        //8) Return back success response
        return {
            message: "Company updated successfully"
        };
    }
    
   async updateRates(id: number, dto: UpdateCompanyRatesDTO) {
        // 1) Get company
        const company = await this.em.findOne(Company, { id });

        // 2) Throw exception for invalid company
        if (!company) {
            throw new NotFoundException('Company not found');
        }   

        // 3) Guard: nothing to update
        if (dto.ltlAmount === undefined && dto.ftlAmount === undefined) {
            return { message: "No rates provided to update" };
        }

        // 4) Update available rates
        if (dto.ltlAmount !== undefined) {
            company.ltlRateToBeChargedPerShipment = dto.ltlAmount;
        }

        if (dto.ftlAmount !== undefined) {
            company.ftlRateToBeChargedPerShipment = dto.ftlAmount; // ← FIXED
        }

        // 5) Persist changes
        this.em.persist(company);
        await this.em.flush();

        // 6) Return back success response
        return { message: "Successfully updated LTL / FTL rates for the company" };
    }
    
    async getAll(session: SessionData, params: Record<string, any>) {
        // 1) Validate session details
        const ctx = await this.requestContextService.resolve({ session, em: this.em });

        // 2) Specify fields allowed for search and filters
        const allowedFields: Record<string, string> = {
            companyName: 'name',
            industryType: 'industryType',
            id: 'id',
        };

        // 3) Pass query params and allowed field to build query pagination params
        const { search, page, limit, orderBy } = buildQuery(params, allowedFields);

        // 4) Build filter query
        const filter: any = {};

        // 5) Handle search filter
        if (search) {
            filter.name = { $ilike: `${search}%` };
        }

        // 6) Count total companies and pages
        const total = await this.em.count(Company, filter);
        const totalPages = Math.ceil(total / limit) || 1;

        // 7) Clamp page based on default limit and total company pages
        const clampedPage = Math.min(page, totalPages);
        const offset = (clampedPage - 1) * limit;

        // 8) Fetch data
        const companies = await this.em.find(
            Company,
            filter,
            {
            limit,
            offset,
            orderBy: Object.entries(orderBy).map(([field, direction]) => ({
                [field]: direction,
            })),
            populate: ['address']
            },
        );

        // 9) Return success response
        return {
            message: 'Companies retrieved successfully',
            data: companies,
            meta: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage: clampedPage < totalPages,
            hasPrevPage: clampedPage > 1,
            sort: orderBy,
            },
        };
    }
}