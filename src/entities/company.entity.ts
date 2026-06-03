import { Collection, Entity, OneToMany, OneToOne, PrimaryKey, Property} from '@mikro-orm/core'
import { Address } from './address.entity';
import { CompanyShippingPreference } from './company-shipping-preference.entity';
import { AddressBook } from './address-book.entity';
import { LineItemUnit } from './line-item-unit.entity';
import { Quote } from './quote.entity';
import { Wallet } from './wallet.entity';
import { SavedCard } from './saved-card.entity';
import { Invoice } from './invoice.entity';
import { Shipment } from './shipment.entity';
import { Claim } from './claim.entity';

@Entity()
export class Company{
    @PrimaryKey()
    id!: number;

    @Property()
    name!: string;

    @Property({ nullable: true})
    industryType?: string;

    @Property({ nullable: true, default: 0 })
    ltlRateToBeChargedPerShipment?: number;

    @Property({ nullable: true, default: 0 })
    ftlRateToBeChargedPerShipment?: number;

    @OneToOne(() => Address)
    address!: Address;

    @OneToMany(() => CompanyShippingPreference, pref => pref.company)
    shippingPreferences = new Collection<CompanyShippingPreference>(this);

    @OneToMany(() => AddressBook, addressBook => addressBook.company)
    addressBook = new Collection<AddressBook>(this);

    @OneToMany(() => LineItemUnit, lineItemUnit => lineItemUnit.company)
    lineItemUnit = new Collection<LineItemUnit>(this);

    @OneToMany(() => Quote, quote => quote.company)
    quote = new Collection<Quote>(this);

    @OneToOne(() => Wallet, (wallet) => wallet.company, { nullable: true })
    wallet?: Wallet;

    @OneToMany(() => SavedCard, card => card.company)
    savedCards = new Collection<SavedCard>(this);

    @OneToMany(() => Invoice, invoice => invoice.company, { nullable: true })
    invoices = new Collection<Invoice>(this);

    @OneToMany(() => Shipment, shipment => shipment.company, { nullable: true })
    shipments = new Collection<Invoice>(this);

    @OneToMany(() => Claim, claim => claim.company, { nullable: true })
    claims? = new Collection<Claim>(this)
}