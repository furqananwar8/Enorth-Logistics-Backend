import { Cascade, Collection, Entity, Index, ManyToOne, OneToMany, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { Quote } from "./quote.entity";
import { BillingReference } from "./BillingReference.entity";
import { TrackingEvent } from "./mock-carrier-tracking.entity";
import { Invoice } from "./invoice.entity";
import { Surcharge } from "./surcharge";
import { Company } from "./company.entity";
import { User } from "./user.entity";

@Entity()

@Index({ properties: ['trackingNumber'] })

@Index({ properties: ['quote'] })

@Index({ properties: ['nextPollAt', 'currentStatus'] })

export class Shipment {
    @PrimaryKey()
    id!: number
    
    @Property()
    shipDate!: Date

    @Property({ onCreate: () => new Date()})
    createdAt?: Date

    @Property({ onCreate: () => new Date(), onUpdate: () => new Date() })
    updatedAt?: Date

    @Property({ nullable: true })
    tailgateRequiredInToAddress?: Boolean

    @Property({ nullable: true })
    tailgateRequiredInFromAddress?: Boolean

    @Property({ nullable: true })
    serviceType?: string;

    @Property({ default: 0 })
    totalCharge?: number

    @Property({ nullable: true })
    carrier?: string;

    @Property({ nullable: true })
    currency?: string;

    @Property({ nullable: true })
    carrierQuoteId?: string | null;

    @Property({ nullable: true })
    trackingNumber?: string | null;

    @Property({ nullable: true })
    bolNumber?: string | null;

    @Property({ nullable: true })
    pickupConfirmation?: string | null;

    @Property({ nullable: true })
    serviceName?: string;
    
    @Property({ nullable: true })
    totalBaseCharge?: number;

    @Property({ nullable: true })
    totalFreightDiscounts?: number;

    @Property({ nullable: true })
    totalSurcharges?: number;

    @Property({ nullable: true })
    totalNetCharge?: number;

    @Property({ nullable: true })
    totalTax?: number;

    @Property({ nullable: true })
    currentStatus?: string;

    @Property({ nullable: true })
    lastEventAt?: Date;

    @Property({ nullable: true })
    lastTrackedAt?: Date;

    @Property({ nullable: true })
    shippingLabels?: string | null;

    @Property({ nullable: true })
    bolPdf?: string | null;

    @Property({ nullable: true })
    nextPollAt?: Date;

    @Property({ nullable: true })
    pollRetryCount?: number = 0; // For exponential backoff on errors

    @OneToOne(() => Quote, { nullable: false, owner: true, hidden: true })
    quote!: Quote;

    @ManyToOne(() => Company, { nullable: false })
    company!: Company;
    
    @OneToMany(() => BillingReference, billingReference => billingReference.shipment, { cascade: [Cascade.PERSIST, Cascade.REMOVE]})
    billingReferences = new Collection<BillingReference>(this); 
    shipmentType: any;

    @OneToMany(() => TrackingEvent, trackingEvent => trackingEvent.shipment, { cascade: [Cascade.PERSIST, Cascade.REMOVE]})
    trackingEvents = new Collection<TrackingEvent>(this);

    @OneToMany(() => Surcharge, (s) => s.shipment, {
        cascade: [Cascade.PERSIST, Cascade.REMOVE],
    })
    surcharges = new Collection<Surcharge>(this);

    @OneToMany(() => Invoice, invoice => invoice.shipment, { hidden: true, cascade: [Cascade.PERSIST, Cascade.REMOVE]})
    invoices = new Collection<Invoice>(this);

    @ManyToOne(() => User, { nullable: true })
    bookedBy?: User;
}