// line-item-unit.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { LineItemUnit } from 'src/entities/line-item-unit.entity';
import { CreateLineItemUnitDTO } from 'src/modules/line-item-unit/dto/create-line-item-unit.dto';
import { UpdateLineItemUnitDTO } from 'src/modules/line-item-unit/dto/update-line-item-unit.dto';
import { getRules, validateUnit } from 'src/utils/validateQuote';
import { ShipmentType } from 'src/common/enum/shipment-type.enum';
import { User } from 'src/entities/user.entity';
import { buildQuery } from 'src/utils/api-query';
import { GetAllAgainstCurrentUserQueryParams } from '../controller/line-item-unit.controller';
import { hasValidField } from 'src/utils/has-valid-fields';
import { SessionData } from 'express-session';
import { RequestContextService } from 'src/utils/request-context-service';
import { Company } from 'src/entities/company.entity';

@Injectable()
export class LineItemUnitService {
  constructor(private readonly em: EntityManager, private readonly requestContextService: RequestContextService) {}

    private mapDtoToEntity(unit: LineItemUnit, dto: Partial<CreateLineItemUnitDTO>): void {
        if (dto.weight !== undefined) unit.weight = dto.weight;
        if (dto.length !== undefined) unit.length = dto.length;
        if (dto.width !== undefined) unit.width = dto.width;
        if (dto.height !== undefined) unit.height = dto.height;
        if (dto.freightClass !== undefined) unit.freightClass = dto.freightClass;
        if (dto.nmfc !== undefined) unit.nmfc = dto.nmfc;
        if (dto.description !== undefined) unit.description = dto.description;
        if (dto.unitsOnPallet !== undefined) unit.unitsOnPallet = dto.unitsOnPallet;
        if (dto.specialHandlingRequired !== undefined) unit.specialHandlingRequired = dto.specialHandlingRequired;
        if (dto.palletUnitType !== undefined) unit.palletUnitType = dto.palletUnitType;
        if (dto.shipmentType !== undefined) unit.type = dto.shipmentType;
        if (dto.name !== undefined) unit.name = dto.name;
        if (dto.measurementUnit !== undefined) unit.measurementUnit = dto.measurementUnit;
    }

    async create(dto: CreateLineItemUnitDTO, session: SessionData) {
        //1) Validate session details
        const  ctx = await this.requestContextService.resolve({ session, em: this.em });

        //2) Throw error for missing fields
        if (!dto.name || !dto.measurementUnit) {
            throw new ForbiddenException("name and measurementUnit are required")
        }

        //3) Validate remaining fields , get fields to validate against shipment type
        const rules = getRules(dto.shipmentType as ShipmentType);
        
        //4) Validate fields
        const validation = validateUnit(dto, rules);
        
        //5) Throw error for invalid payload
        if (!validation.valid) {
        throw new BadRequestException(validation.errors);
        }

        //6) Create new line item unit entity
        const unit = new LineItemUnit();

        //7) Map fields to entity
        this.mapDtoToEntity(unit, dto);

        //8) Set line item null
        unit.lineItem = undefined; // Explicitly standalone
        unit.createdBy = ctx.user;
        unit.company = ctx.company as Company;

        //9) Persist changes
        await this.em.persist(unit).flush();
        
        //10) Return back success response
        return {
            message: "Line item created successfully"
        };
    }

    async getAllAgainstCurrentUserCompany(
        queryParams: Record<keyof GetAllAgainstCurrentUserQueryParams, any>,
        session: SessionData
        ) {
            //1) Validate session details
            const ctx = await this.requestContextService.resolve({ session, em: this.em })

            //2) Specify fields allowed for search and filters
            const allowedFields: Record<string, string> = {
                type: "type",
                measurementUnit: "measurementUnit",
                id: "id",
            };

            //3) Build query params
            const { search, page, limit, orderBy } = buildQuery(queryParams, allowedFields);

            //4) Base filter
            const filter: any = {
                company: ctx.company
            };

            //5) Handle lineItem filter (FIXED)
            if (queryParams.lineItemId !== undefined) {
                filter.lineItem = queryParams.lineItemId;
            } else {
                // same behavior as your original logic
                filter.lineItem = null;
            }

            if (queryParams.type) {
                filter.type = queryParams.type;
            }

            //6) Handle search (same pattern as reference)
            if (search) {
                filter.name = { $ilike: `${search}%` };
            }

            //7) Count total
            const total = await this.em.count(LineItemUnit, filter);
            const totalPages = Math.ceil(total / limit) || 1;

            //8) Clamp page
            const clampedPage = Math.min(page, totalPages);
            const offset = (clampedPage - 1) * limit;

            //9) Fetch data
            const units = await this.em.find(
                LineItemUnit,
                filter,
                {
                    limit,
                    offset,
                    orderBy: Object.entries(orderBy).map(([field, direction]) => ({
                        [field]: direction,
                    }))
                }
            );

            //10) Response
            return {
                message: "Line item units retrieved successfully",
                data: units,
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

    async getOneAgainstCurrentUserCompany(lineItemUnitId: number, session: SessionData) {
        //1) Validate session details
        const ctx = await this.requestContextService.resolve({ session, em: this.em });

        //2) Get line item unit against current user
        const lineItemUnit = await this.em.findOne(LineItemUnit, {id: lineItemUnitId, company: ctx.company});
        
        //3) Throw error for invalid line item unit
        if(!lineItemUnit) {
            throw new NotFoundException("Line item unit not found or you don't have the required permissions")
        }

        //4) Return back line item
        return {
            message: "Line item unit retrieved successfully",
            lineItemUnit
        };
    }

    async updateOneAgainstCurrentUserCompany(lineItemUnitId: number, dto: UpdateLineItemUnitDTO, session: SessionData) {
        //1) Validate session details
        const ctx = await this.requestContextService.resolve({ session, em: this.em })

        //2) Validate payload has at least one meaningful field
        const isValidPayload = hasValidField(dto);

        //3) Throw exception for invalid payload
        if (!isValidPayload) {
            throw new BadRequestException("Provide at least one valid field to update");
        }

        //4) Fetch line item unit entity
        const lineItemUnit = await this.em.findOne(LineItemUnit, {
            id: lineItemUnitId,
            company: ctx.company
        });

        //5) Throw exception for invalid line item 
        if (!lineItemUnit) {
            throw new NotFoundException(
            "Line item unit not found or you don't have the required permissions"
            );
        }

        //6) Determine changing shipment type
        const previousShipmentType = lineItemUnit.type;
        
        const newShipmentType = dto.shipmentType ?? previousShipmentType;

        const isShipmentTypeChanging = dto.shipmentType && dto.shipmentType !== previousShipmentType;

        //7) Get rules for new shipment type
        const rules = getRules(newShipmentType);
        
        //8) Map allowed fields set from rules
        const allowedFields = new Set(rules.map(r => r.field));

        //9) Handle shipment type transition
        if (isShipmentTypeChanging) {
                const newRuleFields = new Set(rules.map(r => r.field));

                //10) Get ALL rule fields from OLD type
                const oldRules = getRules(previousShipmentType);
                const oldRuleFields = new Set(oldRules.map(r => r.field));

                //11) Reset only fields that:
                // - existed in old type
                // - are NOT part of new type
                for (const field of oldRuleFields) {
                    if (!newRuleFields.has(field)) {
                    (lineItemUnit as any)[field] = null;
                    }
                }
            }

            //12) Apply DTO fields (only allowed ones)
            for (const key of Object.keys(dto)) {
                if (allowedFields.has(key)) {
                    (lineItemUnit as any)[key] = dto[key];
                }
            }

            //13) Update shipment type last
            if (dto.shipmentType) {
                lineItemUnit.type = dto.shipmentType;
            }

            //14) Merge final state
            const finalState = { ...lineItemUnit };

            //15) Validate final merged state against current rules
            const validation = validateUnit(finalState, rules);

            //16) Throw exception for invalid payload
            if (!validation.valid) {
            throw new BadRequestException(validation.errors);
            }

            //17) Persist changes
            await this.em.flush();

            //18) Response
            return {
                message: "Line item unit updated successfully"
            };
    }

    async deleteOneAgainstCurrentUserCompany(lineItemUnitId: number, session: SessionData) {
        //1) Validate sessin details
        const ctx = await this.requestContextService.resolve({ session, em: this.em })

        //2) Get the line item unit against current user
        const lineItemUnit = await this.em.findOne(LineItemUnit, {id: lineItemUnitId, company: ctx.company });
        
        //3) Throw error for invalid line item unit
        if(!lineItemUnit) {
            throw new NotFoundException("Line item unit not found or you don't have the required permissions")
        }

        //4) Delete line item unit
        await this.em.remove(lineItemUnit).flush();

        //5) Return back success response
        return {
            message: "Line item unit deleted successfully"
        }
    }
}