import { EntityManager, wrap } from "@mikro-orm/postgresql";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateQuoteDTO } from "../dto/create-quote.dto";
import { Quote } from "src/entities/quote.entity";
import { ShipmentType } from "src/common/enum/shipment-type.enum";
import { Insurance } from "src/entities/insurance.entity";
import { LineItemUnit } from "src/entities/line-item-unit.entity";
import { LineItem } from "src/entities/line-item.entity";
import { SpotDetails } from "src/entities/spot-details.entity";
import { Signature } from "src/entities/signature.entity";
import { AddressBook } from "src/entities/address-book.entity";
import { Address } from "src/entities/address.entity";
import { ShippingAddressMeta } from "src/entities/shipping-address-meta.entity";
import { SpotEquipment } from "src/entities/spot-equipment.entity";
import { SpotContact } from "src/entities/spot-contact.entity";
import { User } from "src/entities/user.entity";
import { PaginationParams } from "src/types/pagination";
import { buildQuery } from "src/utils/api-query";
import { PalletServices } from "src/entities/pallet-services.entity";
import { StandardFtlServices } from "src/entities/standard-ftl-services.entity";
import { SpotFtlServices } from "src/entities/spot-ftl-services.entity";
import { QuoteType } from "src/common/enum/quote-type.enum";
import { UpdateQuoteDTO } from "../dto/update-quote.dto";
import { QuoteFavorite } from "src/entities/quote-favorite.entity";
import { VALID_STATUS_TRANSITIONS } from "src/common/constants/valid-quote-status";
import { UpdateQuoteStatusDTO } from "../dto/update-quote-status.dto";
import { QuoteStatus } from "src/common/enum/quote-status";
import { validateUpdateQuote } from "src/utils/validate-quote-update-fields";
import { RefrigeratedType } from "src/common/enum/refrigerated.enum";
import { hasValidField } from "src/utils/has-valid-fields";
import { getAllowedFields } from "src/common/constants/line-item-rules";
import { patchUnit, resetUnit } from "src/utils/line-item-units-helpers";
import { SessionData } from "express-session";
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityEventPayload } from "src/types/notification";
import { NotificationType } from "src/common/enum/notification-type.enum";
import { SpotQuoteFactory } from "src/factory/spot-quote.factory";
import { StandardQuoteFactory } from "src/factory/standard-quote.factory";
import { Company } from "src/entities/company.entity";
import { DangerousGoodsClass, PackagingGroup, QuantityType } from "src/common/enum/line-item.enum";
import { BondType, ContactKey, LimitedAccessType } from "src/common/enum/services.enum";
import { EQUIPMENT_RULES } from "src/common/constants/spot-equipment";
import { getEnv } from 'src/utils/getEnv';
import { ENV } from 'src/common/constants/env';
import { EmailTemplate } from "src/common/enum/email-template.enum";
import { EmailService } from "src/email/service/email.service";
import { getEmailTemplate } from "src/utils/get-email-template";
import { ShipmentTypeLabel } from "src/utils/shipment-type-label-mapping";
import { RequestContextService } from "src/utils/request-context-service";
import { ROLES } from "src/common/constants/roles";
import { startOfDay, endOfDay } from "src/utils/dates";
@Injectable()
export class QuoteService {
    constructor(
        private readonly em: EntityManager,
        private readonly eventEmitter: EventEmitter2,
        private readonly emailService: EmailService,
        private readonly requestContextService: RequestContextService,
    ) {}
    private quoteShipmentTypesMapping = {
            [ShipmentType.SPOT_LTL] : ShipmentType.PALLET,
            [ShipmentType.SPOT_FTL] : ShipmentType.PALLET,
            [ShipmentType.PACKAGE] : ShipmentType.PACKAGE,
            [ShipmentType.PALLET] : ShipmentType.PALLET,
            [ShipmentType.COURIER_PAK] : ShipmentType.COURIER_PAK
        }
    // Helper method
    private getExistingService(quote: Quote, shipmentType: ShipmentType): any {
        switch (shipmentType) {
            case ShipmentType.PALLET: return quote.palletServices;
            case ShipmentType.SPOT_FTL: return quote.spotFtlServices;
            case ShipmentType.SPOT_LTL: return quote.spotLtlServices;
            case ShipmentType.STANDARD_FTL: return quote.standardFTLService;
            default: return null;
        }
    }

    async create(dto: CreateQuoteDTO, session: SessionData) {
        //1) Resolve currently logged in user and his company details
        const ctx = await this.requestContextService.resolve({ session, em: this.em })

        if (!ctx?.user?.accountIsVerified) {
            throw new ForbiddenException("Only approved account can create quote, get your account approved by admin first")
        }

        //2) Generate factory function based on quote type
        const quoteFactory: any = dto.quoteType === QuoteType.STANDARD ? new StandardQuoteFactory() : new SpotQuoteFactory();
        
        //3) Create quote from factory
        let quote = quoteFactory.create({ shipmentType: dto.shipmentType, data: dto, em: this.em, session });
        
        //4) Validate created quote
        await quote.validate();
        
        //5) Build validated quote
        quote = await quote.build();

        quote.company = session.companyId;
        quote.user = session.userId;
        quote.status = dto.status ? dto.status : QuoteStatus.DRAFT;

        //6) Persist and save quote
        this.em.persist(quote);
        
        await this.em.flush();
        
        //7) Format created at for email template
        const createdAtFormatted = new Date(quote.createdAt).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        //8) Send out email only for spot quotes
        if(dto.quoteType === QuoteType.SPOT) {
            this.emailService.sendSpotQuoteEmail({
                to: getEnv(ENV.ADMIN_EMAIL),
                subject: "Spot Quote Created",
                template: getEmailTemplate(EmailTemplate.SPOT_QUOTE_CREATED),
                context: {
                    shipmentType: ShipmentTypeLabel[quote.shipmentType],
                    estimatedAmount: dto.estimatedAmount?.amount,
                    currency: dto.estimatedAmount?.currency,
                    measurementUnit: quote.lineItems.measurementUnit,
                    createdAt: createdAtFormatted,
                    companyName: ctx?.company?.name,
                    contactNumber: ctx.user.phoneNumber,
                    createdBy: `${ctx.user?.firstName} ${ctx.user?.lastName}`,
                    lineItemUnits: quote.lineItems.units
                }
            });
        }

        //9) Get the notification type
        const notificationType = dto.quoteType === QuoteType.STANDARD ? NotificationType.QUOTE_CREATED : NotificationType.SPOT_QUOTE_CREATED
        
        //10) Emit notification event
        this.eventEmitter.emit(notificationType, {
            entity: quote,
            actorId: session.userId,
            companyId: session.companyId,
            metadata: {
            quoteId: quote.id
            }
        })

        //11) Return back success response
        return { message: "Quote created successfully", quote: { id: quote.id } }
    }


    async update(quoteId: number, rawDto: UpdateQuoteDTO, session: SessionData) {
        const isValidPayload = hasValidField(rawDto);

        if (!isValidPayload) {
            throw new BadRequestException("Provide at least one valid field to update");
        }
        
        const em = this.em.fork();

        //1) Fetch quote with relations
        const quote = await em.findOne(
            Quote,
            { id: quoteId , company: this.em.getReference(Company, session.companyId as number)},
            {
            populate: [
                "createdBy",
                "company",
                "addresses.address",
                "addresses.meta",
                "lineItems",
                "lineItems.units",
                "insurance",
                "spotDetails.spotContact",
                "spotDetails.spotEquipment",
                "palletServices",
                "standardFTLService",
                "spotLtlServices",
                "spotFtlServices",
            ],
            }
        );

        if (!quote) {
            throw new NotFoundException("Quote not found or you don't have the required permission");
        }

        //2) Ownership check
        if (quote.company.id !== session.companyId) {
            throw new ForbiddenException("You are not allowed to update this quote");
        }

        //3) VALIDATE & FILTER
        const validation = validateUpdateQuote(rawDto, quote);

        if (!validation.valid) {
            throw new BadRequestException({
                message: validation.errors,
            });
        }

        if (validation.removedFields) {
            console.log(`[Audit] Quote ${quoteId}: Removed fields:`, validation.removedFields);
        }

        const dto = validation.filteredDto!;
        //4) Update operations

        //5) Status & knownShipper
        if (dto.status) quote.status = dto.status as QuoteStatus;

        if (dto.knownShipper !== undefined) {
            if (quote.spotDetails?.spotEquipment?.nextFlightOut) {
                quote.spotDetails.spotEquipment.nextFlightOut.knownShipper = dto.knownShipper;
            }
        }

        //6) Signature
        if (dto.signature !== undefined) {
            if ([ShipmentType.COURIER_PAK, ShipmentType.PACKAGE].includes(quote.shipmentType as ShipmentType)) {
                const signature = await em.findOne(Signature, { id: dto.signature });
                if (!signature) throw new BadRequestException("Invalid signature id");
                quote.signature = signature;
            }
        }

        //7) Addresses
        if (dto.addresses && dto.addresses.length > 0) {
            for (const addrDto of dto.addresses) {
                const addressType = addrDto.type!;
                const existingAddress = quote.addresses.getItems().find(a => a.type === addressType);

                if (!existingAddress) continue; // Shouldn't happen due to validation

                const hasManualFields = addrDto.address1 || addrDto.city || addrDto.state || 
                                    addrDto.country || addrDto.postalCode;
                const sendingAddressBookId = addrDto.addressBookId !== undefined;

                // SCENARIO 1: Manual exists
                if (existingAddress.address && !existingAddress.addressBookEntry) {
                
                if (sendingAddressBookId && !hasManualFields) {
                    // Manual → AddressBook
                    em.remove(existingAddress.address);
                    existingAddress.address = undefined;
                    
                    const addressBook = await em.findOne(AddressBook, { id: addrDto.addressBookId });
                    if (!addressBook) throw new NotFoundException(`Address book ${addrDto.addressBookId} not found`);
                    existingAddress.addressBookEntry = addressBook;
                    
                } else if (hasManualFields) {
                    // Partial update
                    const address = existingAddress.address;
                    if (addrDto.address1 !== undefined) address.address1 = addrDto.address1;
                    if (addrDto.address2 !== undefined) address.address2 = addrDto.address2;
                    if (addrDto.city !== undefined) address.city = addrDto.city;
                    if (addrDto.state !== undefined) address.state = addrDto.state;
                    if (addrDto.country !== undefined) address.country = addrDto.country;
                    if (addrDto.postalCode !== undefined) address.postalCode = addrDto.postalCode;
                }
                }

                // SCENARIO 2: AddressBook exists
                else if (!existingAddress.address && existingAddress.addressBookEntry) {
                
                if (sendingAddressBookId && !hasManualFields) {
                    // Update to new address book entry
                    if (existingAddress.addressBookEntry.id !== addrDto.addressBookId) {
                    const addressBook = await em.findOne(AddressBook, { id: addrDto.addressBookId });
                    if (!addressBook) throw new NotFoundException(`Address book ${addrDto.addressBookId} not found`);
                    existingAddress.addressBookEntry = addressBook;
                    }
                    
                } else if (hasManualFields) {
                    // AddressBook → Manual (full switch)
                    existingAddress.addressBookEntry = undefined;

                    const address = new Address();
                    address.address1 = addrDto.address1!;
                    address.address2 = addrDto.address2;
                    address.city = addrDto.city!;
                    address.state = addrDto.state!;
                    address.country = addrDto.country!;
                    address.postalCode = addrDto.postalCode!;
                    
                    existingAddress.address = address;
                    em.persist(address);
                }
                }

                // Update meta fields (all scenarios)
                if (!existingAddress.meta) {
                existingAddress.meta = new ShippingAddressMeta();
                em.persist(existingAddress.meta);
                }

                if (quote.quoteType === QuoteType.SPOT && addrDto.additionalNotes !== undefined) {
                existingAddress.meta.additionalNotes = addrDto.additionalNotes;
                }

                if (quote.quoteType !== QuoteType.SPOT && quote.shipmentType === ShipmentType.STANDARD_FTL) {
                if (addrDto.includeStraps !== undefined) existingAddress.meta.includeStraps = addrDto.includeStraps;
                if (addrDto.appointmentDelivery !== undefined) existingAddress.meta.appointmentDelivery = addrDto.appointmentDelivery;
                }

                if (addrDto.isResidential !== undefined) {
                    existingAddress.isResidential = addrDto.isResidential;
                }

                if (addrDto.additionalNotes !== undefined) {
                    existingAddress.additionalNotes = addrDto.additionalNotes;
                }

            }
        }
        //8) Line Item
       const LINE_ITEM_SHIPMENT_TYPES = [
            ShipmentType.COURIER_PAK,
            ShipmentType.PACKAGE,
            ShipmentType.PALLET
        ];
       
        if (dto.lineItem && LINE_ITEM_SHIPMENT_TYPES.includes(this.quoteShipmentTypesMapping[quote.shipmentType as ShipmentType])) {
            const lineItem = quote.lineItems as LineItem;
            
            if (!lineItem) throw new NotFoundException('Line item not found for this quote');
            
            const incomingType = dto.lineItem.type ?? lineItem.type;
            const isTypeChanged = incomingType !== lineItem.type;

            lineItem.type = incomingType;

            if (
                dto.lineItem.measurementUnit !== undefined &&
                LINE_ITEM_SHIPMENT_TYPES.includes(incomingType)
            ) {
                lineItem.measurementUnit = dto.lineItem.measurementUnit;
            }

          if (
                dto.lineItem.dangerousGoods !== undefined &&
                [ShipmentType.PACKAGE, ShipmentType.PALLET].includes(incomingType)
            ) {
                const dangerousGoods = dto.lineItem.dangerousGoods;

                if (dangerousGoods && typeof dangerousGoods === "object") {
                    const current = lineItem.dangerousGoods || {};

                    const updated = { ...current, ...dangerousGoods } as any;

                    // UN
                    if (
                        dangerousGoods.un !== undefined &&
                        (typeof dangerousGoods.un !== "string" || !dangerousGoods.un.trim())
                    ) {
                        updated.un = current.un;
                    }

                    // CLASS
                    if (
                        dangerousGoods.class !== undefined &&
                        !DangerousGoodsClass[dangerousGoods.class]
                    ) {
                        updated.class = current.class;
                    }

                    // QUANTITY TYPE
                    if (
                        dangerousGoods.quantityType !== undefined &&
                        !QuantityType[dangerousGoods.quantityType]
                    ) {
                        updated.quantityType = current.quantityType;
                    }

                    // PACKAGING GROUP
                    if (
                        dangerousGoods.packagingGroup !== undefined &&
                        !PackagingGroup[dangerousGoods.packagingGroup]
                    ) {
                        updated.packagingGroup = current.packagingGroup;
                    }

                    lineItem.dangerousGoods = updated;
                }
            } else if (isTypeChanged) {
                lineItem.dangerousGoods = null;
            }

            
            if (incomingType === ShipmentType.PALLET) {
                if (dto.lineItem.stackable !== undefined) lineItem.stackable = dto.lineItem.stackable;
                if (dto.lineItem.quantity  !== undefined) lineItem.quantity  = dto.lineItem.quantity;
            } else if (isTypeChanged) {
                lineItem.stackable = null;
                lineItem.quantity  = null;
            }

            const unitDtos = dto.lineItem.units ?? [];
            const allowedFields = getAllowedFields(incomingType);
            const existingUnits = lineItem.units.getItems();
            if (isTypeChanged) {
                for (const unit of existingUnits) {
                    resetUnit(unit);
                    unit.type = incomingType;
                }
            }
            
            //9) Line Item Unit
            for (const [index, unitDto] of unitDtos.entries()) {
                const isCreate = !unitDto.id;

               //10) Update existing
                if (!isCreate) {
                    const unit = existingUnits.find(u => u.id === unitDto.id);

                    if (!unit) {
                        throw new NotFoundException(`Unit ${unitDto.id} not found`);
                    }

                    patchUnit(unit, unitDto, allowedFields, {
                        resetUnallowed: isTypeChanged,
                        isCreate: false,
                        context: {
                            index,
                            id: unitDto.id,
                        },
                    });

                    em.persist(unit);
                    continue;
                }

                //11) Create new line item unit
                const newUnit = em.create(LineItemUnit, {
                    type: incomingType,
                    lineItem: lineItem,
                    createdBy: this.em.getReference(User, session.userId as number),
                    company: this.em.getReference(Company, session.companyId as number),
                });

                patchUnit(newUnit, unitDto, allowedFields, {
                    resetUnallowed: true,
                    isCreate: true,
                    context: {
                        index,
                    },
                });

                //12) Attach to parent
                lineItem.units.add(newUnit);

                //13) Persist
                em.persist(newUnit);
            }

            //14) Persist line item changes
            em.persist(lineItem);
        }

        //15) Insurance
        if (dto.insurance) {
            if(quote.insurance){
                quote.insurance.amount   = dto.insurance.amount   ?? quote.insurance.amount;
                quote.insurance.currency = dto.insurance.currency ?? quote.insurance.currency;
            }else{
                let insurance = new Insurance();
                if(!dto.insurance.amount || !dto.insurance.currency){
                    throw new BadRequestException("Insurance.amount , Insurance.currency is required");
                }
                insurance.amount = dto.insurance.amount;
                insurance.currency = dto.insurance.currency;
                quote.insurance = insurance;
                em.persist(insurance)
            }
        }

        //16) Spot Details - FIXED: Added proper null checks
        if (quote.quoteType === QuoteType.SPOT && dto.spotDetails) {
            let spotDetail = quote.spotDetails;

            if (!spotDetail) {
            spotDetail = new SpotDetails();
            spotDetail.quote = quote;
            }

            spotDetail.spotType = dto.spotDetails.spotType!;

            // Contact - with null checks
            if (dto.spotDetails.spotContact) {
            const contactDto = dto.spotDetails.spotContact;
            const contact = spotDetail.spotContact ?? new SpotContact();
            
            contact.contactName = contactDto.contactName!;
            contact.phoneNumber = contactDto.phoneNumber!;
            contact.email = contactDto.email!;
            contact.shipDate = new Date(contactDto.shipDate!);
            
            if (quote.shipmentType === ShipmentType.TIME_CRITICAL && contactDto.deliveryDate) {
                contact.deliveryDate = new Date(contactDto.deliveryDate);
            }
            
            contact.spotQuoteName = contactDto.spotQuoteName ?? null;

            contact.spotDetail = spotDetail;
            spotDetail.spotContact = contact;
            em.persist(contact);
            }

            // Equipment - with null checks
            if (dto.spotDetails?.spotEquipment) {
                const eq = dto.spotDetails.spotEquipment;

                const equipment = spotDetail.spotEquipment ?? new SpotEquipment();

                const allowedFields = EQUIPMENT_RULES[quote.shipmentType] || [];

                // Step 1: find provided fields
                const providedFields = allowedFields.filter(
                    (field) => eq[field] !== undefined && eq[field] !== null
                );

                // Step 2: enforce only one field
                if (providedFields.length !== 1) {
                    throw new BadRequestException(
                    `Exactly one equipment must be provided: ${allowedFields.join(", ")}`
                    );
                }

                const selectedField = providedFields[0];

                // Step 3: reset all fields first (since only one allowed)
                for (const field of allowedFields) {
                    equipment[field] = null;
                }

                // Step 4: assign selected field safely
                switch (selectedField) {
                    case "dryVan":
                    case "flatbed":
                    case "ventilated":
                    case "car":
                    case "truck":
                    case "van":
                    if (typeof eq[selectedField] !== "boolean") {
                        throw new BadRequestException(`${selectedField} must be boolean`);
                    }
                    equipment[selectedField] = eq[selectedField];
                    break;

                    case "refrigerated":
                    if (typeof eq.refrigerated !== "object") {
                        throw new BadRequestException("refrigerated must be an object");
                    }
                    equipment.refrigerated = {
                        type: eq.refrigerated.type as RefrigeratedType,
                    };
                    break;

                    case "nextFlightOut":
                    if (typeof eq.nextFlightOut !== "object") {
                        throw new BadRequestException("nextFlightOut must be an object");
                    }
                    equipment.nextFlightOut = {
                        knownShipper: eq.nextFlightOut.knownShipper ?? false,
                    };
                    break;
                }

                equipment.spotDetail = spotDetail;
                spotDetail.spotEquipment = equipment;

                em.persist(equipment);
            }

            em.persist(spotDetail);
        }

        //17) Services
        if (dto.services) {
            const mapping: Record<string, any> = {
                [ShipmentType.PALLET]: PalletServices,
                [ShipmentType.STANDARD_FTL]: StandardFtlServices,
                [ShipmentType.SPOT_LTL]: PalletServices,
                [ShipmentType.SPOT_FTL]: SpotFtlServices,
            };

            const ServiceEntity = mapping[quote.shipmentType as ShipmentType];

            if (ServiceEntity) {
                const existingService = this.getExistingService(
                    quote,
                    quote.shipmentType as ShipmentType
                );

                if (existingService) em.remove(existingService);

                const serviceSchema = new ServiceEntity();

                // -----------------------------
                // ONLY CHANGE: PALLET SAFE MERGE
                // -----------------------------
                if ([ShipmentType.PALLET, ShipmentType.SPOT_LTL].includes(quote.shipmentType)) {
                    const current = new PalletServices();
                    const incoming = dto.services || {};

                    // reuse SAME logic style as your updateServices()
                    const merged: any = { ...current, ...incoming };

                    // LIMITED_ACCESS
                    if (
                        incoming.limitedAccess !== undefined &&
                        Object.values(LimitedAccessType).includes(incoming.limitedAccess as any)
                    ) {
                        merged.limitedAccess = incoming.limitedAccess;

                        if (incoming.limitedAccess === LimitedAccessType.OTHERS) {
                            const desc = incoming.limitedAccessDescription as any;
                            merged.limitedAccessDescription =
                                typeof desc === "string" && desc.trim()
                                    ? desc.trim()
                                    : null;
                        } else {
                            merged.limitedAccessDescription = null;
                        }
                    }

                    // IN_BOUND
                    if (incoming.inbound && typeof incoming.inbound === "object") {
                        const currentIn = merged.inbound || {};
                        const inB = incoming.inbound;

                        const updated: any = { ...currentIn };

                        if (
                            inB.bondType !== undefined &&
                            Object.values(BondType).includes(inB.bondType)
                        ) {
                            updated.bondType = inB.bondType;
                        }

                        if (
                            inB.contactKey !== undefined &&
                            Object.values(ContactKey).includes(inB.contactKey)
                        ) {
                            updated.contactKey = inB.contactKey;
                        }

                        if (typeof inB.bondCancler === "string" && inB.bondCancler.trim()) {
                            updated.bondCancler = inB.bondCancler.trim();
                        }

                        if (typeof inB.contactValue === "string" && inB.contactValue.trim()) {
                            updated.contactValue = inB.contactValue.trim();
                        }

                        if (typeof inB.address === "string" && inB.address.trim()) {
                            updated.address = inB.address.trim();
                        }

                        merged.inBound = updated;
                    }
                    // copy final merged result into entity
                    Object.assign(serviceSchema, merged);
                } else {
                    // ALL OTHER TYPES untouched
                    Object.assign(serviceSchema, dto.services);
                }

                switch (quote.shipmentType) {
                    case ShipmentType.PALLET:
                        quote.palletServices = serviceSchema;
                        break;
                    case ShipmentType.SPOT_FTL:
                        quote.spotFtlServices = serviceSchema;
                        break;
                    case ShipmentType.SPOT_LTL:
                        quote.palletServices = serviceSchema;
                        break;
                    case ShipmentType.STANDARD_FTL:
                        quote.standardFTLService = serviceSchema;
                        break;
                }

                em.persist(serviceSchema);
            }
        }

        if ([ShipmentType.COURIER_PAK, ShipmentType.PACKAGE].includes(quote.shipmentType) && dto.signature) {
            const signature = await this.em.findOne(Signature, { id: dto.signature });

            if(!signature){
                throw new NotFoundException("Signature not found or you don't have the required permissions")
            }

            quote.signature = signature;

        }
        
        em.persist(quote);

        //18) Flush
        await em.flush();

        //19) Send out quote updated notification to all members of 
        this.eventEmitter.emit(NotificationType.QUOTE_UPDATED, {
            entity: quote,
            actorId: session.userId,
            companyId: quote.company.id,
            metadata: {
                changedFields: Object.keys(dto),
                quoteNumber: quote.id,
                quoteStatus: quote.status,
            }
        } as EntityEventPayload<Quote>);

        //20) Return back success response
        return { message: "Quote updated successfully" };
    }

    async getSingleAgainstCurrentUserCompany(quoteId: number, session: SessionData):Promise<any>{
        //1) Get the quote against current user
        const filter: any = {
            id: quoteId
        };

        if (session.role !== ROLES.SUPER_ADMIN) {
            filter.company = this.em.getReference(Company, session.companyId as number);
        }
        
        const quote = await this.em.findOne(Quote, filter,{
            populate: ["createdBy","createdBy.firstName", "createdBy.lastName","addresses", "addresses.locationType", "addresses.addressBookEntry", "addresses.addressBookEntry.address", "addresses.address","lineItems", "lineItems.units",
                        "palletServices", "spotFtlServices", "spotLtlServices", "standardFTLService", 
                        "signature", "insurance","spotDetails", "spotDetails.spotContact", "spotDetails.spotEquipment","shipment", "shipment.trackingEvents", "shipment.surcharges", "shipment.bookedBy"]
        });
        //2) Throw error for invalid quote
        if(!quote){
            throw new BadRequestException("Invalid quote id or you are not allowed to access this resource")
        }

        //3) Map from addressBookEntry, not the QuoteAddress wrapper
        const mappedAddresses = quote.addresses.map(addr => {
            // 1. Pick whichever source exists
            const source = addr.addressBookEntry ?? addr.address;
            
            // 2. Convert to plain object (breaks out of MikroORM proxies)
            const address: any = wrap(source as any).toObject();
            let mappedAddress = {type: addr.type ,...address};
            
            // 3. Add the transformed fields directly INTO the address object
            if(address.signature) {
                mappedAddress = {...mappedAddress, signatureId: address.signature}
                delete mappedAddress.signature;
            }
            
            if(address.locationType || addr.locationType) {
                mappedAddress = {...mappedAddress, locationTypeId: address.locationType || addr?.locationType?.id}
                delete mappedAddress.locationType;
            }
            
            return mappedAddress;
        });

        const createdBy = quote.createdBy ? {
            firstName: quote.createdBy.firstName,
            lastName: quote.createdBy.lastName
        } : null;


        //4) Return the mapped addresses in the response
        return {
            message: "Successfully retrieved quote",
            quote: {
                ...quote,
                addresses: mappedAddresses,
                createdBy
            }
        };
    }


    async getAllAgainstCurrentUserCompany(
        session: SessionData,
        params: PaginationParams,
    ) {
        // 1) Fields allowed for sorting / searching
        const allowedFields = {
            quoteNumber: "quoteNumber",
            shipmentType: "shipmentType",
            status: "status",
            createdAt: "createdAt",
        };

        // 2) Derive pagination params from raw query-string params
        const { search, page, limit, orderBy } = buildQuery(params, allowedFields);

        // ── Helpers: cover full days so "2026-06-09" means the ENTIRE 9th ──────
       
        // 3) Base filter — always scope to the caller's company
        const filter: any = {};

        if (session.role !== ROLES.SUPER_ADMIN) {
            filter.company = this.em.getReference(Company, session.companyId as number);
        }

        // 4) Optional status filter
        if (params?.status) {
            const normalized = params.status.toUpperCase();
            const validStatuses = Object.values(QuoteStatus);

            if (!validStatuses.includes(normalized as QuoteStatus)) {
                throw new BadRequestException(
                    `Invalid status '${params.status}'. Allowed: ${validStatuses.join(", ")}`,
                );
            }

            filter.status = normalized;
        }

        // 5) Optional search (substring match on quoteNumber — finds partial and exact)
        if (search) {
            filter.quoteNumber = { $ilike: `%${search}%` };
        }

        // 6) Optional shipment-type filter
        if (params.shipmentType) {
            filter.shipmentType = params.shipmentType;
        }

        if (params.quoteType) {
            filter.quoteType = params.quoteType;
        }

        // 7) Optional date-range filter (normalized to full days)
        if (params.dateFrom || params.dateTo) {
            filter.createdAt = {};
            if (params.dateFrom) filter.createdAt.$gte = startOfDay(params.dateFrom);
            if (params.dateTo)   filter.createdAt.$lte = endOfDay(params.dateTo);
        }

        const orderByClause = Object.entries(orderBy).map(([field, direction]) => ({
            [field]: direction,
        }));

        const [idRows, total] = await this.em.findAndCount(Quote, filter, {
            fields: ["id"],           // SELECT id only — minimises data transfer
            limit,
            offset: (page - 1) * limit,
            orderBy: orderByClause,
        });

        // 8) Derive page metadata
        const totalPages  = Math.ceil(total / limit) || 1;
        const clampedPage = Math.min(page, totalPages);
        const ids         = idRows.map((q) => q.id);

        if (ids.length === 0) {
            return {
                message: "Quotes retrieved successfully",
                data: [],
                meta: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNextPage: false,
                    hasPrevPage: clampedPage > 1,
                    sort: orderBy,
                },
            };
        }

        const quotes = await this.em.find(
            Quote,
            { id: { $in: ids } },
            {
                populate: [
                    "addresses",
                    "addresses.addressBookEntry",
                    "addresses.addressBookEntry.address",
                    "addresses.address",
                    "lineItems",
                    "lineItems.units",
                ],
                fields: [
                    "name",
                    "quoteId",
                    "quoteType",
                    "createdAt",
                    "shipmentType",

                    // Direct address on quote address
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

                    // Address-book path
                    "addresses.addressBookEntry.address.country",
                    "addresses.addressBookEntry.address.state",

                    // Line items — keep only the units relation
                    "lineItems.measurementUnit",
                    "lineItems.units.weight",
                ],
                orderBy: orderByClause,
            },
        );

        // 9) Return paginated response
        return {
            message: "Quotes retrieved successfully",
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

    async deleteSingleAgainstCurrentUserCompany(quoteId: number, session: SessionData){
        //1) Get the user reference
        const company = this.em.getReference(Company, session.companyId as number);
        //2) Check for valid quote
        const quote = await this.em.findOne(Quote, { id: quoteId, company: company.id },
            {
                populate: [
                    'lineItems',
                    'lineItems.units',
                    'spotDetails',
                    'insurance',
                    'signature',
                    'standardFTLService',
                    'palletServices',
                    'spotFtlServices',
                    'spotLtlServices',
                    'userMeta',
                    'addresses'
                ]
            }
        );
        
        //3) Throw error for invalid quote
        if(!quote){
            throw new NotFoundException("Quote not found or you don't have the required permissions");
        }

        //4) Delete quote
        this.em.remove(quote)
        await this.em.flush();
        
        //5) Send out quote deleted notification to all members of company
        this.eventEmitter.emit(NotificationType.QUOTE_DELETED, {
            actorId: session.userId,
            entity: quote,
            companyId: quote.company.id
        } as EntityEventPayload<Quote>);

        //6) Return back success response
        return { message: 'Quote deleted successfully' };
    }

    async markQuoteFavoriteAgainstCurrentUserCompany(quoteId: number, session: SessionData) {
        //1) Get the quote
        const quote = await this.em.findOne(Quote, { id: quoteId }, { 
            populate: ['company'],
            fields: ['id', 'company'] 
        });

        //2) Throw exception for invalid quote
        if (!quote) {
            throw new NotFoundException('Quote not found');
        }

        //3) Throw exception if quote doesn't belong to current user
        if (quote.company.id !== session.companyId) {
            throw new ForbiddenException('You can only favorite your own quotes');
        }

        //4) Set quote as favorite
        const existing = await this.em.findOne(QuoteFavorite, {
            quote: quoteId,
            company: session.companyId,
        });

        //5) Throw error if it's already favorited
        if (existing) {
            throw new ConflictException('Already favorited');
        }

        //6) Mark as favorite
        const favorite = this.em.create(QuoteFavorite, {
            quote: this.em.getReference(Quote, quoteId),
            user: this.em.getReference(User, session.userId as number),
            company: this.em.getReference(Company, session.companyId as number)
        });

        //7) Persist changes
        await this.em.persist(favorite).flush();
        
        //8) Return back success response
        return {
            message: "Marked quote as favorite successfully"
        }
    }

    async unmarkQuoteFavoriteAgainstCurrentUserCompany(quoteId: number, session: SessionData) {
        // 1) Verify quote exists and belongs to current user
        const quote = await this.em.findOne(Quote, { 
            id: quoteId, 
            company: session.companyId 
        }, { 
            fields: ['id'] 
        });

        //2) Throw exception for invalid quote 
        if (!quote) {
            throw new NotFoundException("Quote not found or you don't have the required permissions");
        }

        //3) Find the favorite to remove
        const favorite = await this.em.findOne(QuoteFavorite, {
            quote: quoteId,
            user: session.userId,
            company: session.companyId
        });

        //4) Throw exception for invalid favorite quote
        if (!favorite) {
            throw new NotFoundException('Favorite quote not found, Quote has been already unmaked as favorite');
        }

        //5) Remove and flush
        this.em.remove(favorite);
        
        //6) Commit the changes
        await this.em.flush();

        //7) Return success message
        return {
            message: "Unmarked quote as favorite successfully"
        }
    }

    async updateStatus(quoteId: number, dto: UpdateQuoteStatusDTO, session: SessionData) {
        //1) Extract status 
        const { status } = dto;
        
        //2) Find the quote against current user
        const quote = await this.em.findOne(Quote, {
            id: quoteId,
            company: session.companyId,
        });

        //3) Throw error for invalid quote id
        if (!quote) {
            throw new NotFoundException("Quote not found or you don't have the required permissions");
        }

        //4) Check if transition is valid
        const allowedTransitions = VALID_STATUS_TRANSITIONS[quote.status];
        
        //5) Throw exception for invalid transition status
        if (!allowedTransitions?.includes(status)) {
            throw new BadRequestException(
                `Invalid status transition: ${quote.status} → ${status}`
            );
        }

        //6) Update status
        quote.status = status;
        
        //7) Persist changes
        await this.em.flush();

        //8) Rturn success response
        return {
            message: "Quote status updated successfully"
        };
    }

    async getAllFavoritesAgainstCurrentUserCompany(
        session: SessionData,
        params: PaginationParams
        ) {
        // 1) Allowed fields for sorting/search
        const allowedFields = {
            createdAt: "createdAt",
            updatedAt: "updatedAt",
        };

        // 2) Build query params
        const { search, page, limit, orderBy } = buildQuery(params, allowedFields);

        // 3) Base filter (user company scoped)
        const filter: any = {
            company: this.em.getReference(Company, session.companyId as number),
        };

        // 4) Optional date filters
        if (params.dateFrom || params.dateTo) {
            filter.createdAt = {};
            if (params.dateFrom) filter.createdAt.$gte = new Date(params.dateFrom);
            if (params.dateTo) filter.createdAt.$lte = new Date(params.dateTo);
        }

        // 5) Optional search (if you want to search inside related Quote fields)
        if (search) {
            filter.quote = {
            quoteId: { $ilike: `${search}%` },
            };
        }

        // 6) Count total
        const total = await this.em.count(QuoteFavorite, filter);
        const totalPages = Math.ceil(total / limit) || 1;

        // 7) Clamp pagination
        const clampedPage = Math.min(page, totalPages);
        const offset = (clampedPage - 1) * limit;

        // 8) Fetch data
        const favorites = await this.em.find(
            QuoteFavorite,
            filter,
            {
            limit,
            offset,
            orderBy: Object.entries(orderBy).map(([field, direction]) => ({
                [field]: direction,
            })),
            populate: [
                "quote",
                "quote.addresses",
                "quote.addresses.addressBookEntry",
                "quote.addresses.addressBookEntry.address",
                "quote.addresses.address",
            ],
            fields: [
                    "quote.name",
                    "quote.quoteId",
                    "createdAt",
                    "quote.shipmentType",

                    // Direct address on quote address
                    "quote.addresses.id",
                    "quote.addresses.type",
                    "quote.addresses.address",
                    "quote.addresses.address.id",
                    "quote.addresses.address.address1",
                    "quote.addresses.address.address2",
                    "quote.addresses.address.unit",
                    "quote.addresses.address.postalCode",
                    "quote.addresses.address.city",
                    "quote.addresses.address.state",
                    "quote.addresses.address.country",
                    "quote.addresses.addressBookEntry",
                    "quote.addresses.addressBookEntry.id",
                    "quote.addresses.addressBookEntry.companyName",
                    "quote.addresses.addressBookEntry.contactName",
                    "quote.addresses.addressBookEntry.phoneNumber",
                    "quote.addresses.addressBookEntry.email",
                    "quote.addresses.addressBookEntry.isResidential",
                    "quote.addresses.addressBookEntry.address",
                    "quote.addresses.addressBookEntry.address.id",
                    "quote.addresses.addressBookEntry.address.address1",
                    "quote.addresses.addressBookEntry.address.address2",
                    "quote.addresses.addressBookEntry.address.unit",
                    "quote.addresses.addressBookEntry.address.postalCode",
                    "quote.addresses.addressBookEntry.address.city",
                    "quote.addresses.addressBookEntry.address.state",
                    "quote.addresses.addressBookEntry.address.country",

                    // Address-book path
                    "quote.addresses.addressBookEntry.address.country",
                    "quote.addresses.addressBookEntry.address.state",

                    // Line items — keep only the units relation
                    "quote.lineItems.measurementUnit",
                    "quote.lineItems.units.weight",
                ]
            }
        );

        // 9) Response
        return {
            message: "Favorite quotes retrieved successfully",
            data: favorites,
            meta: {
            total,
            page: clampedPage,
            limit,
            totalPages,
            hasNextPage: clampedPage < totalPages,
            hasPrevPage: clampedPage > 1,
            sort: orderBy,
            },
        };
    }

    async getFavoriteQuoteByIdAgainstCurrentUserCompany(session: SessionData, favoriteId: number) {
        //1) Find quote against current user and favoriteId
        const favorite = await this.em.findOne(
            QuoteFavorite,
            {
                id: favoriteId,
                company: session.companyId,
            },
            {
                populate: [
                    "quote", 
                    "quote.addresses",
                    "quote.addresses.addressBookEntry",
                    "quote.addresses.addressBookEntry.address",
                    "quote.addresses.address"
                ],
                 fields: [
                    "quote.name",
                    "quote.quoteId",
                    "createdAt",
                    "quote.shipmentType",

                    // Direct address on quote address
                    "quote.addresses.id",
                    "quote.addresses.type",
                    "quote.addresses.address",
                    "quote.addresses.address.id",
                    "quote.addresses.address.address1",
                    "quote.addresses.address.address2",
                    "quote.addresses.address.unit",
                    "quote.addresses.address.postalCode",
                    "quote.addresses.address.city",
                    "quote.addresses.address.state",
                    "quote.addresses.address.country",
                    "quote.addresses.addressBookEntry",
                    "quote.addresses.addressBookEntry.id",
                    "quote.addresses.addressBookEntry.companyName",
                    "quote.addresses.addressBookEntry.contactName",
                    "quote.addresses.addressBookEntry.phoneNumber",
                    "quote.addresses.addressBookEntry.email",
                    "quote.addresses.addressBookEntry.isResidential",
                    "quote.addresses.addressBookEntry.address",
                    "quote.addresses.addressBookEntry.address.id",
                    "quote.addresses.addressBookEntry.address.address1",
                    "quote.addresses.addressBookEntry.address.address2",
                    "quote.addresses.addressBookEntry.address.unit",
                    "quote.addresses.addressBookEntry.address.postalCode",
                    "quote.addresses.addressBookEntry.address.city",
                    "quote.addresses.addressBookEntry.address.state",
                    "quote.addresses.addressBookEntry.address.country",

                    // Address-book path
                    "quote.addresses.addressBookEntry.address.country",
                    "quote.addresses.addressBookEntry.address.state",

                    // Line items — keep only the units relation
                    "quote.lineItems.measurementUnit",
                    "quote.lineItems.units.weight",
                ]
            }
        );

        //2) Throw error for invalid favoriteId
        if (!favorite) {
            throw new NotFoundException("Favorite quote not found or you don't have the required permissions");
        }

        //3) Return success response
        return {
            message: 'Favorite quote retrieved successfully',
            favoriteQuote: favorite,
        };
    }
}