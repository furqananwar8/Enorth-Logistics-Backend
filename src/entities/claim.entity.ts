import { Entity, PrimaryKey, OneToOne, Enum, Property, OneToMany, Collection, ManyToOne, BeforeCreate, Cascade } from "@mikro-orm/core";
import { ClaimDocumentType, ClaimStatus, ClaimType } from "src/common/enum/claims";
import { Shipment } from "./shipment.entity";
import { Currency } from "src/common/enum/currency.enum";
import { ClaimDocument } from "./claim-document.entity";
import { User } from "./user.entity";
import { Company } from "./company.entity";
import { randomBytes } from "crypto";
import { Optional } from "@nestjs/common";
import { ClaimComment } from "./claim-comment.entity";

@Entity()
export class Claim {
  @PrimaryKey()
  id!: number;

  @Property({ unique: true })
  claimId!: string;

  @BeforeCreate()
  generateClaimId() {
    this.claimId = randomBytes(4).toString('hex').toUpperCase();
  }

  @Enum(() => ClaimStatus)
  status: ClaimStatus = ClaimStatus.DRAFT;

  // --- Contact Person Details ---
  @Property()
  contactFullName!: string;

  @Property()
  contactPhoneNumber!: string;

  @Property()
  contactEmailAddress!: string;

  @Property()
  claimName!: string;

  // --- Claim Classification ---
  @Enum(() => ClaimType)
  claimType!: ClaimType;

  @Property({ nullable: true })
  adminNotes?: string;

  @Property({ nullable: true })
  statusUpdatedAt?: Date

  // === Missing ===
  @Property({ type: 'text', nullable: true })
  goodsDescription?: string;

  @Property({ nullable: true })
  additionalInsurancePurchased?: boolean;

  @Enum(() => Currency)
  currency?: Currency;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalValueOfGoods?: number;

  @Property({ type: 'text', nullable: true, default: null })
  additionalNotes?: string | null = null;

  @OneToMany(() => ClaimDocument, claimDocument=> claimDocument.claim, { cascade: [Cascade.ALL], orphanRemoval: true})
  documents = new Collection<ClaimDocument>(this);

  @OneToMany(() => ClaimComment, comment => comment.claim, { nullable: true })
  comments? = new Collection<ClaimComment>(this);  

  @Property({ nullable: true })
  submittedAt?: Date;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;

  @OneToOne(() => Shipment, { owner: true, unique: true })
  shipment!: Shipment;

  @ManyToOne(() => User)
  submittedBy!: User;

  @ManyToOne(() => User, { nullable: true })
  statusUpdatedBy?: User;

  @ManyToOne(() => Company)
  company!: Company;
}