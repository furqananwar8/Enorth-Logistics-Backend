import { Entity, PrimaryKey, Property, Enum, ManyToOne } from "@mikro-orm/core";
import { ClaimDocumentType } from "src/common/enum/claims";
import { Claim } from "./claim.entity";
import { User } from "./user.entity";

@Entity()
export class ClaimDocument {
  @PrimaryKey()
  id!: number;

  @Property()
  fileName!: string;

  @Property()
  fileUrl!: string;

  @Property({ nullable: true })
  mimeType?: string;

  @Property({ nullable: true })
  fileSize?: number;

  @ManyToOne(() => Claim, { hidden: true })
  claim!: Claim;

  @ManyToOne(() => User, { hidden: true})
  uploadedBy!: User;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}