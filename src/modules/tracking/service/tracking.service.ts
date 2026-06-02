import { EntityManager } from "@mikro-orm/core";
import { BadRequestException, Injectable } from "@nestjs/common";
import { SessionData } from "express-session";
import { ROLES } from "src/common/constants/roles";
import { QuoteStatus } from "src/common/enum/quote-status";
import { Company } from "src/entities/company.entity";
import { Quote } from "src/entities/quote.entity";
import { PaginationParams } from "src/types/pagination";
import { buildQuery } from "src/utils/api-query";

@Injectable()
export class TrackingService {
    constructor(private readonly em: EntityManager) {}

    async getAllTrackingsAgainstCurrentUserCompany(session: SessionData, params: PaginationParams) {
        const allowedFields = {
            quoteNumber: "quoteNumber",
            shipmentType: "shipmentType",
            status: "status",
            createdAt: "createdAt",
            trackingNumber: "shipment.trackingNumber",
            shipDate: "shipment.shipDate",
            carrier: "shipment.carrier",
        };

        const { search, page, limit, orderBy } = buildQuery(params, allowedFields);

        let filter: Record<string, any> = {};

        if (session.role !== ROLES.SUPER_ADMIN) {
            filter["company"] = this.em.getReference(Company, session.companyId as number);
        }

        filter["shipment"] = { $ne: null };

        if (params?.status) {
            const normalized = params.status.toUpperCase();
            const validStatuses = Object.values(QuoteStatus);
            if (!validStatuses.includes(normalized as QuoteStatus)) {
                throw new BadRequestException(
                    `Invalid status '${params.status}'. Allowed: ${validStatuses.join(', ')}`
                );
            }
            filter["status"] = normalized;
        }

        if (search) {
            filter["$or"] = [
                { shipment: { trackingNumber: { $ilike: `%${search}%` } } },
                {
                    addresses: {
                        $some: {
                            address: {
                                $or: [
                                    { address1: { $ilike: `%${search}%` } },
                                    { address2: { $ilike: `%${search}%` } },
                                ],
                            },
                        },
                    },
                },
                {
                    shipment: {
                        billingReferences: {
                            $some: { code: { $ilike: `%${search}%` } },
                        },
                    },
                },
            ];
        }

        if (params.shipmentType) filter["shipmentType"] = params.shipmentType;

        if (params.dateFrom || params.dateTo) {
            filter["createdAt"] = {
                ...(params.dateFrom && { $gte: new Date(params.dateFrom) }),
                ...(params.dateTo   && { $lte: new Date(params.dateTo) }),
            };
        }

        if (params.carrier) {
            filter["shipment"] = { ...filter["shipment"], carrier: params.carrier };
        }

        if (params.shipDateFrom || params.shipDateTo) {
            filter["shipment"] = {
                ...filter["shipment"],
                shipDate: {
                    ...(params.shipDateFrom && { $gte: new Date(params.shipDateFrom) }),
                    ...(params.shipDateTo   && { $lte: new Date(params.shipDateTo) }),
                },
            };
        }

        if (params.originPostalCode) {
            filter["addresses"] = {
                $some: { type: "FROM", address: { postalCode: { $ilike: `${params.originPostalCode}%` } } },
            };
        }

        if (params.destinationPostalCode) {
            const dest = {
                $some: { type: "TO", address: { postalCode: { $ilike: `${params.destinationPostalCode}%` } } },
            };
            filter["addresses"] = filter["addresses"]
                ? { $and: [filter["addresses"], dest] }
                : dest;
        }

        const orderByArr = Object.entries(orderBy).map(([field, dir]) => ({ [field]: dir }));

        const total = await this.em.count(Quote, filter);   // keep separate only if you
        const totalPages = Math.ceil(total / limit) || 1;   // need exact total; otherwise
        const clampedPage = Math.min(page, totalPages);     // use findAndCount() below ↓
        const offset = (clampedPage - 1) * limit;

        const quotes = await this.em.find(Quote, filter, {
        limit,
        offset,
        orderBy: orderByArr,

        // Only join what's actually needed
        populate: [
            "shipment",
            "lineItems",
            "lineItems.units",
            "addresses",
            "addresses.address",
            "addresses.addressBookEntry",        
            "addresses.addressBookEntry.address",
        ],

        fields: [
            // Quote root (always include PK + anything in meta/filter)
            "id",
            "status",
            "shipmentType",
            "createdAt",

            // Shipment
            "shipment.id",
            "shipment.trackingNumber",
            "shipment.shipDate",
            "shipment.currentStatus",
            "shipment.carrier",

            // Line items
            "lineItems.id",
            "lineItems.type",

            // Line item units
            "lineItems.units.id",
            "lineItems.units.length",
            "lineItems.units.width",
            "lineItems.units.height",
            "lineItems.units.weight",
            "lineItems.units.unitsOnPallet",

            // Addresses
            "addresses.id",
            "addresses.type",
            "addresses.address",
            "addresses.address.id",
            "addresses.address.address1",
            "addresses.address.address2",
            "addresses.address.unit",
            "addresses.address.postalCode",
            "addresses.address.city",
            "addresses.address.state",
            "addresses.address.country",
            "addresses.addressBookEntry",
            "addresses.addressBookEntry.id",
            "addresses.addressBookEntry.companyName",
            "addresses.addressBookEntry.contactName",
            "addresses.addressBookEntry.phoneNumber",
            "addresses.addressBookEntry.email",
            "addresses.addressBookEntry.isResidential",
            "addresses.addressBookEntry.address",
            "addresses.addressBookEntry.address.id",
            "addresses.addressBookEntry.address.address1",
            "addresses.addressBookEntry.address.address2",
            "addresses.addressBookEntry.address.unit",
            "addresses.addressBookEntry.address.postalCode",
            "addresses.addressBookEntry.address.city",
            "addresses.addressBookEntry.address.state",
            "addresses.addressBookEntry.address.country",
        ],
    });

        return {
            message: "Trackings retrieved successfully",
            data: quotes,
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