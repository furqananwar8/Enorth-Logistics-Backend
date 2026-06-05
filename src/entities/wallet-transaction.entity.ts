import { Entity, PrimaryKey, Property, ManyToOne, Index, Enum } from '@mikro-orm/core';
import { User } from './user.entity';
import { Wallet } from './wallet.entity';
import { v4 } from 'uuid';
import { TransactionType, TransactionStatus } from 'src/common/enum/wallet';

@Entity()
export class WalletTransaction {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @ManyToOne(() => User, { index: true })
  user!: User;

  @ManyToOne(() => Wallet, { index: true })
  wallet!: Wallet;

  @Enum(() => TransactionType)
  type!: TransactionType;

  @Enum(() => TransactionStatus)
  status: TransactionStatus = TransactionStatus.PENDING;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  amount!: number;

  @Property({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balanceBefore?: number = 0;

  @Property({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balanceAfter?: number = 0;

  @Property({ nullable: true })
  squarePaymentId?: string;

  @Property({ nullable: true })
  stripeChargeId?: string;

  @Property({ nullable: true, type: 'text' })
  description?: string;

  @Property({ nullable: true, type: 'text' })
  failureReason?: string;

  @Property({ onCreate: () => new Date() })
  createdAt?: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt?: Date = new Date();
}