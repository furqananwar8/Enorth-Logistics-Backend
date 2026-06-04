import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { User } from './user.entity';
import { Claim } from './claim.entity';

@Entity()
export class ClaimComment {
  @PrimaryKey()
  id!: number;

  @Property({ type: 'text' })
  message!: string;

  @ManyToOne(() => User)
  addedBy!: User;

  @ManyToOne(() => Claim, { hidden: true })
  claim!: Claim;

  @Property({ nullable: true, onCreate: () => new Date() })
  createdAt?: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}