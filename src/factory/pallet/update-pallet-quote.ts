import { wrap } from '@mikro-orm/core';
import { BadRequestException } from '@nestjs/common';
import { AddressBook } from 'src/entities/address-book.entity';
import { Company } from 'src/entities/company.entity';
import { LineItemUnit } from 'src/entities/line-item-unit.entity';
import { LineItem } from 'src/entities/line-item.entity';
import { Quote } from 'src/entities/quote.entity';
import { ShippingAddress } from 'src/entities/shipping-address.entity';
import { User } from 'src/entities/user.entity';
import { StandardQuote } from '../standard-quote';
import { QuoteConstructorParams, AddressData, AddressType } from '../base-quote';
import { palletRules } from 'src/common/constants/quote';
import { multiOptionFields, validateAndFilterServicesForUpdate, validateUnit } from 'src/utils/validateQuote';
import { Insurance } from 'src/entities/insurance.entity';
import { Currency } from 'src/common/enum/currency.enum';
import { PalletServices } from 'src/entities/pallet-services.entity';
import { DangerousGoodsClass, PackagingGroup, QuantityType } from 'src/common/enum/line-item.enum';
import { LimitedAccessType, BondType, ContactKey } from 'src/common/enum/services.enum';
import { Address } from 'src/entities/address.entity';

export interface UpdateAddressData extends ShippingAddress {
    addressBook?: {
        id?: number;
        address?: Record<string, any> ;
    }
}

export class UpdatePalletQuote extends StandardQuote {
    protected existingQuote!: Quote;
    protected validServices?: Record<string, any>;

    constructor(params: QuoteConstructorParams) {
        super();
        this.data = params.data;
        this.em = params.em;
        this.session = params.session;
    }

    async init(): Promise<void> {
        const quote = await this.em.findOne(Quote, 
            { id: this.data?.quote?.id},
            { populate: ["addresses","addresses.addressBookEntry","addresses.addressBookEntry.address", "lineItems", "lineItems.units", "insurance", "palletServices"] }
        )

        if(!quote) return;

        this.existingQuote = quote;
    }

    async validate(): Promise<void> {
        if (!this.existingQuote) return;

        this.errors = [];

        await this.validateAddresses();
        this.validateLineItem();
        this.validateLineItemUnits();
        this.validateInsurance();
        this.validateServices();

        if (this.errors.length > 0) {
            throw new BadRequestException({
                message: this.errors
            });
        }

        this.validatedData = {
            addresses: this.data.quote.addresses,
            lineItems: this.data.quote.lineItems,
            insurance: this.data.quote.insurance,
            services: this.validServices,
        };
    }

    async update(): Promise<Quote | void> {
        if (!this.existingQuote) return;

        if (this.validatedData.addresses !== undefined) await this.updateAddresses();

        if (this.validatedData.lineItems !== undefined) await this.updateLineItem();

        if (this.validatedData.insurance !== undefined) this.updateInsurance();

        if (this.validatedData.services !== undefined) this.updateServices();

        await this.em.flush();

        await this.em.refresh(this.existingQuote, {
            populate: [
                "addresses",
                "addresses.addressBookEntry",
                "addresses.addressBookEntry.address",
                "lineItems",
                "lineItems.units",
                "insurance",
                "palletServices"
            ]
        });

        return this.existingQuote;
    }

    protected async validateAddresses(): Promise<void> {
        const addresses = this.data.quote.addresses;
        if(!this.hasValidAddressPayload(addresses)) return;

        await this.validateAddressRules(addresses);
    }

    protected hasValidAddressPayload(addresses: AddressData[]): boolean {
        
        if(!addresses || addresses.length === 0) return false;
        
        if(addresses.length > 2 ){
            this.errors.push("Can not send more than 2 addresses");
            return false;
        }

        return true;
    }

    protected async validateAddressRules(addresses: UpdateAddressData[]): Promise<void> {
        for (const address of addresses) {
             if (!address?.type || !Object.values(AddressType).includes(address.type)) {
                throw new BadRequestException(
                    `Address type '${address?.type}' is invalid. Allowed values: ${Object.values(AddressType).join(", ")}`
                );
            }
        }
    }

    protected validateLineItemUnits(): void {
        
        if (!this.data.quote.lineItems?.units?.length) return;

        const units = this.data.quote.lineItems.units;
        
        // Filter only new units (no ID) - existing units allow partial updates
        const newUnits = units.filter(unit => !unit.id);
        
        if (newUnits.length > 0) {
            this.processLineItemUnit(newUnits);
        }
    }

    protected validateLineItem(): void {
        // Skip entirely if not provided in payload
        if (!this.data.quote.lineItems) {
            return;
        }

        const lineItem = this.data.quote.lineItem;

        // If they send units, validate they have at least one
        if (lineItem?.units !== undefined) {
            if (!Array.isArray(lineItem.units) || lineItem.units.length === 0) {
                this.errors.push("At least one unit is required");
            }
        }

        // Type must match shipment type (critical check even for updates)
        if (lineItem?.type && lineItem?.type !== this.data.quote.shipmentType) {
            this.errors.push("Line item type must match shipment type");
        }
    }

    protected validateInsurance(): void {
        const insurance = this.data.quote.insurance;
        
        // Skip if not provided (partial update)
        if (!insurance) return;
        
        // Validate amount if present
        if (insurance.amount !== undefined) {
            if (typeof insurance.amount !== 'number' || insurance.amount < 0) {
                this.errors.push("Insurance amount must be a non-negative number");
            }
        }
        
        // Validate currency if present
        if (insurance.currency !== undefined) {
            if (!Object.values(Currency).includes(insurance.currency)) {
                this.errors.push(
                    `Invalid currency '${insurance.currency}'. Allowed values: ${Object.values(Currency).join(", ")}`
                );
            }
        }
    }

    protected validateServices(): void {
        const { errors, validServices } =
            validateAndFilterServicesForUpdate(
                this.data.quote.services,
                this.data.shipmentType
            );
        if (errors.length) {
            this.errors.push(...errors);
        }

        this.validServices = validServices;
    }

    protected updateServices(): void {
        const incomingServices = this.validatedData.services || {};
        console.log("Incoming services", incomingServices)
        const currentServices = this.existingQuote.palletServices as PalletServices;

        for (const [field, value] of Object.entries(incomingServices)) {
            console.log({field, value})
            // LIMITED_ACCESS
            if (field === multiOptionFields.LIMITED_ACCESS.key) {
                if (typeof value !== "string") continue;

                if (!Object.values(LimitedAccessType).includes(value as LimitedAccessType)) {
                    continue; // ignore invalid enum
                }

                currentServices[field] = value;

                // -----------------------------
                // OTHERS → set description
                // -----------------------------
                if (value === LimitedAccessType.OTHERS) {
                    const desc = incomingServices.limitedAccessDescription;

                    if (typeof desc === "string" && desc.trim()) {
                        currentServices.limitedAccessDescription = desc.trim();
                    } else {
                        currentServices.limitedAccessDescription = null;
                    }
                }

                continue;
            }

            // IN_BOUND
           if (field === multiOptionFields.IN_BOUND.key) {
                if (!value || typeof value !== "object") continue;

                const current = currentServices[field] || {};
                const updated: any = { ...current };

                const {
                    bondType,
                    bondCancler,
                    contactKey,
                    contactValue,
                    address,
                } = value as any;
                console.log({bondType, bondCancler, contactKey, contactValue, address})
                // -----------------------------
                // bondType (enum)
                // -----------------------------
                if (
                    bondType !== undefined &&
                    Object.values(BondType).includes(bondType)
                ) {
                    updated["bondType"] = bondType;
                }

                // -----------------------------
                // contactKey (enum)
                // -----------------------------
                if (
                    contactKey !== undefined &&
                    Object.values(ContactKey).includes(contactKey)
                ) {
                    updated["contactKey"] = contactKey;
                }

                // -----------------------------
                // strings
                // -----------------------------
                if (typeof bondCancler === "string" && bondCancler.trim()) {
                    updated["bondCancler"] = bondCancler.trim();
                }

                if (typeof contactValue === "string" && contactValue.trim()) {
                    updated["contactValue"] = contactValue.trim();
                }

                if (typeof address === "string" && address.trim()) {
                    updated["address"] = address.trim();
                }

                currentServices["inBound"] = updated;
                continue;
            }

            // DEFAULT (simple fields)
            currentServices[field] = value;
        }
    }

    protected async updateAddresses(): Promise<void> {
        for (const address of this.validatedData.addresses) {
            const shippingAddress = this.existingQuote.addresses
                .getItems()
                .find(a => a.type === address.type);
            if (!shippingAddress) {
                this.errors.push(`Address type '${address.type}' not found in existing quote`);
                continue;
            }

            // Support flat addressBookId from DTO
            const addressBookId = address.addressBookId ?? address.addressBook?.id;

            /**
             * 1. SWITCH TO DIFFERENT ADDRESS BOOK (by ID)
             */
            if (addressBookId) {
                const newBook = await this.em.findOne(AddressBook, {
                    id: addressBookId
                });

                if (!newBook) {
                    this.errors.push(
                        `Address '${address.type}': AddressBook ${addressBookId} not found`
                    );
                    continue;
                }

                shippingAddress.addressBookEntry = newBook;
                shippingAddress.address = null;

                continue;
            }

            // Resolve manual address fields (supports flat or nested `address.address` shape)
            const addr = address.address || address;
            const manualAddressFields = {
                address1: addr.address1,
                address2: addr.address2,
                unit: addr.unit,
                postalCode: addr.postalCode,
                city: addr.city,
                state: addr.state,
                country: addr.country,
            };
            const hasManualFields = Object.values(manualAddressFields).some(v => v !== undefined);

            if (hasManualFields) {
                // If email + contactName are present, create a new AddressBook instead of raw manual
                if (address.email && address.contactName) {
                    const newAddress = new Address();
                    wrap(newAddress).assign(manualAddressFields);

                    const newBook = new AddressBook();
                    wrap(newBook).assign({
                        email: address.email,
                        contactName: address.contactName,
                        companyName: address.companyName,
                        phoneNumber: address.phoneNumber,
                        address: newAddress,
                        palletShippingCloseTime: address.palletShippingCloseTime,
                        palletShippingReadyTime: address.palletShippingReadyTime,
                        createdBy: this.session.userId,
                        company: this.session.companyId,
                        signature: 1,
                        locationType: address.locationType ?? addr.locationTypeId ?? 1,
                    }, { em: this.em });

                    this.em.persist(newAddress);
                    this.em.persist(newBook);

                    // ---------------------------------------------
                    // 🔑 FIX: flush now so newBook gets a real PK
                    // before we touch shippingAddress's FKs. Without
                    // this, when multiple ShippingAddress rows in the
                    // same flush each point at their own pending
                    // (unsaved) AddressBook, MikroORM's change-set
                    // batching can drop the FK assignment for all but
                    // the first row.
                    // ---------------------------------------------

                    await this.em.flush();

                    shippingAddress.addressBookEntry = newBook;
                    shippingAddress.address = null;

                    if (address.locationType !== undefined) shippingAddress.locationType = address.locationType;
                    if (address.isResidential !== undefined) shippingAddress.isResidential = address.isResidential;
                    if (address.additionalNotes !== undefined) shippingAddress.additionalNotes = address.additionalNotes;

                    continue;
                }

                // Otherwise patch as pure manual address (no address book)
                shippingAddress.addressBookEntry = null;

                if (!shippingAddress.address) {
                    shippingAddress.address = new Address();
                    // 🔑 FIX: Address.PERSIST isn't cascaded from ShippingAddress
                    // (only Cascade.REMOVE is configured), so a freshly created
                    // Address must be persisted explicitly or it won't be inserted.
                    this.em.persist(shippingAddress.address);
                }

                wrap(shippingAddress.address).assign(manualAddressFields);

                if (address.locationType !== undefined) shippingAddress.locationType = address.locationType;
                if (address.isResidential !== undefined) shippingAddress.isResidential = address.isResidential;
                if (address.additionalNotes !== undefined) shippingAddress.additionalNotes = address.additionalNotes;

                continue;
            }

            const entry = shippingAddress.addressBookEntry;
            if (!entry) {
                this.errors.push(`Address '${address.type}' has no address book entry`);
                continue;
            }

            /**
             * 1. SWITCH TO DIFFERENT ADDRESS BOOK (by ID)
             */
            if (address.addressBook?.id) {
                const newBook = await this.em.findOne(AddressBook, {
                    id: address.addressBook.id
                });

                if (!newBook) {
                    this.errors.push(
                        `Address '${address.type}': AddressBook ${address.addressBook.id} not found`
                    );
                    continue;
                }

                shippingAddress.addressBookEntry = newBook;

                continue;
            }

            /**
             * 2. PATCH ADDRESS BOOK FIELDS (companyName, phoneNumber, etc.)
             */
            const { address: addressFields, ...bookFields } = address.addressBook || {};
            if (Object.keys(bookFields).length > 0) {
                wrap(entry).assign(bookFields);
            }

            /**
             * 3. PATCH ADDRESS FIELDS (street, city, etc.)
             */
            if (addressFields && entry.address) {
                wrap(entry.address).assign(addressFields);
            }
        }
    }
    
    protected async updateLineItem(): Promise<void> {
        const lineItemData = this.validatedData.lineItems as any;
        
        // Get existing line item (assuming one per quote for now)
        const existingLineItem = this.existingQuote.lineItems as any;
        
        if (!existingLineItem) return;

        // Update scalar fields if provided
        if (lineItemData.type !== undefined) {
            existingLineItem.type = lineItemData.type;
        }
        
        if (lineItemData.dangerousGoods !== undefined) {
            const dg = lineItemData.dangerousGoods;

            if (dg && typeof dg === "object") {
                const current = existingLineItem.dangerousGoods || {};

                const updated = { ...current, ...dg };

                // UN validation
                if (
                    dg.un !== undefined &&
                    (typeof dg.un !== "string" || !dg.un.trim())
                ) {
                    updated.un = current.un;
                }

                // CLASS validation
                if (
                    dg.class !== undefined &&
                    !Object.values(DangerousGoodsClass).includes(dg.class)
                ) {
                    updated.class = current.class;
                }

                // QUANTITY TYPE validation
                if (
                    dg.quantityType !== undefined &&
                    !Object.values(QuantityType).includes(dg.quantityType)
                ) {
                    updated.quantityType = current.quantityType;
                }

                // PACKAGING GROUP validation
                if (
                    dg.packagingGroup !== undefined &&
                    !Object.values(PackagingGroup).includes(dg.packagingGroup)
                ) {
                    updated.packagingGroup = current.packagingGroup;
                }

                existingLineItem.dangerousGoods = updated;
            }
        }
        
        if (lineItemData.measurementUnit !== undefined) {
            existingLineItem.measurementUnit = lineItemData.measurementUnit;
        }

        if (lineItemData.stackable !== undefined) {
            existingLineItem.stackable = lineItemData.stackable;
        }

        // Update units if provided
        if (lineItemData.units) {
             const unitCount = await this.updateLineItemUnits(existingLineItem, lineItemData.units);
            existingLineItem.quantity = unitCount;
        }
    }

    protected async updateLineItemUnits(
        lineItem: LineItem, 
        unitsData: any[]
    ): Promise<number> {
        if (unitsData.length === 0) {
            return lineItem.units.getItems().length;
        }

        const existingUnits = lineItem.units.getItems();
        const existingUnitsMap = new Map(existingUnits.map(u => [u.id, u]));
        
        for (let i = 0; i < unitsData.length; i++) {
            const unitData = unitsData[i];
            
            if (unitData.action === "DELETED") {
                if (!unitData.id) {
                    this.errors.push(`Unit ${i + 1}: ID is required for deletion`);
                    continue;
                }
                
                const unitToDelete = existingUnitsMap.get(unitData.id);
                if (!unitToDelete) {
                    this.errors.push(`Unit with id ${unitData.id} not found for deletion`);
                    continue;
                }
                
                lineItem.units.remove(unitToDelete);
                continue;
            }
            
            if (unitData.id) {
                const targetUnit = existingUnitsMap.get(unitData.id);
                if (!targetUnit) {
                    this.errors.push(`Unit with id ${unitData.id} not found`);
                    continue;
                }
                
                const updates: Partial<LineItemUnit> = {};
                // FIX: Iterate palletRules as array to get field names
                for (const rule of palletRules) {
                    const field = rule.field;
                    if (unitData[field] !== undefined) {
                        updates[field] = unitData[field];
                    }
                }
                
                if (Object.keys(updates).length > 0) {
                    wrap(targetUnit).assign(updates);
                }
            } else {
                const updates: Partial<LineItemUnit> = {};
                // FIX: Iterate palletRules as array here too
                for (const rule of palletRules) {
                    const field = rule.field;
                    if (unitData[field] !== undefined) {
                        updates[field] = unitData[field];
                    }
                }
                
                const unit = new LineItemUnit();
                unit.createdBy = this.em.getReference(User, this.session.userId as number);
                unit.company = this.em.getReference(Company, this.session.companyId as number);
                Object.assign(unit, updates);
                lineItem.units.add(unit);
                this.em.persist(unit);
            }
        }

        return lineItem.units.getItems().length;
    }

    protected processLineItemUnit(units: any): void {
        units.forEach((unit: any, idx: number) => {
            const result = validateUnit(unit, palletRules, { unitIndex: idx });
            if (result.errors) {
                this.errors.push(...result.errors);
            }
        });
    }
    
    protected updateInsurance(): void {
        const insuranceData = this.validatedData.insurance;
        
        // Skip if not provided
        if (!insuranceData) return;
        
        const insurance = this.existingQuote.insurance as Insurance;
        
        const updates: Partial<Insurance> = {};
    
        if (insuranceData.amount !== undefined) {
            updates.amount = insuranceData.amount;
        }
        
        if (insuranceData.currency !== undefined) {
            updates.currency = insuranceData.currency;
        }
        
        // Use wrap to ensure MikroORM tracks the change
        wrap(insurance).assign(updates);
    }

    protected async buildAddressDetails(
        addrData: AddressData, 
        shippingAddress: ShippingAddress, 
        bookMap: Map<number, AddressBook>
    ): Promise<void> {}
    protected assignLineItemFields(lineItem: LineItem): void {}
    protected buildUnitFields(unit: LineItemUnit, unitData: any, idx: number): void {}
    protected async validateAddressDetails(addresses: AddressData[]): Promise<void> {}
    protected attachServiceToQuote(serviceEntity: any): void {}
    protected validateLineItemSpecific(): void {}
}