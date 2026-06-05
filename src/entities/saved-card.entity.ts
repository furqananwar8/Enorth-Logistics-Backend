import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { v4 } from 'uuid';
import { Company } from './company.entity';

@Entity()
export class SavedCard {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @ManyToOne(() => Company, { index: true })
  company!: Company;

  @Property()
  squareCardId?: string;

  @Property()
  brand?: string;

  @Property()
  last4?: string;

  @Property()
  expMonth?: number;

  @Property()
  expYear?: number;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}