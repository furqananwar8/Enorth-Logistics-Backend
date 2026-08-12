import { wrap } from '@mikro-orm/core';
import { BadRequestException } from '@nestjs/common';
import { AddressBook } from 'src/entities/address-book.entity';
import { LineItemUnit } from 'src/entities/line-item-unit.entity';
import { LineItem } from 'src/entities/line-item.entity';
import { Quote } from 'src/entities/quote.entity';
import { ShippingAddress } from 'src/entities/shipping-address.entity';
import { StandardQuote } from '../standard-quote';
import { QuoteConstructorParams, AddressData, AddressType } from '../base-quote';
import { validateAndFilterServicesForUpdate, validateUnit } from 'src/utils/validateQuote';
import { StandardFtlServices } from 'src/entities/standard-ftl-services.entity';
import { Address } from 'src/entities/address.entity';

export interface UpdateAddressData extends ShippingAddress {
    addressBook?: {
        id?: number;
        address?: Record<string, any> ;
    }
}

export class UpdateStandardFTLQuote extends StandardQuote {
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
            { populate: ['addresses','addresses.addressBookEntry','addresses.addressBookEntry.address', 'standardFTLService'] }
        )

        if(!quote) return;

        this.existingQuote = quote;
    }

    async validate(): Promise<void> {
        if(!this.existingQuote) return;

        this.errors = [];
        await this.validateAddresses();
        this.validateServices();

        if (this.errors.length > 0) {
            throw new BadRequestException({
                message: this.errors
            });
        }

        // Store validated data for build phase
        this.validatedData = this.data.quote;
    }

    async update(): Promise<Quote | void> {
        if (!this.existingQuote) return;

        if (this.validatedData.addresses !== undefined) await this.updateAddresses();

        if (this.validatedData.services !== undefined) this.updateServices();

        await this.em.flush();

        await this.em.refresh(this.existingQuote, {
            populate: [
                "addresses",
                "addresses.addressBookEntry",
                "addresses.addressBookEntry.address",
                "standardFTLService"
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
                        signature: address.signatureId ?? 1,
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
                    // 🔑 FIX: Address isn't cascade-persisted from ShippingAddress
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

                // Replace the relationship, not a property on the entry
                shippingAddress.addressBookEntry = newBook;

                // If switching to a different address book, we typically don't patch it in the same request
                continue;
            }

            /**
             * 2. PATCH ADDRESS BOOK FIELDS (companyName, phoneNumber, etc.)
             */
            const { address: addressFields, ...bookFields } = address.addressBook || {};

            if (Object.keys(bookFields).length > 0) {
                // Update the AddressBook entity directly, not entry.addressBook
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
        const validServices = this.validatedData.services;

        for (const [key, value] of Object.entries(validServices)) {
            (this.existingQuote.standardFTLService as StandardFtlServices)[key] = value;
        }
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
    protected processLineItemUnit(units: any): void {}
}