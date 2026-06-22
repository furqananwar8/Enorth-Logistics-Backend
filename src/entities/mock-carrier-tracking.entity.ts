// src/mock-carrier-tracking/entities/tracking-event.entity.ts
import { Entity, PrimaryKey, Property, ManyToOne, Index, Enum } from '@mikro-orm/core';
import { Shipment } from './shipment.entity';
import { Carrier } from  'src/modules/shipment-carrier/dto/create-carrier-shipment.dto';
import { IsEnum } from 'class-validator';

export enum TrackingEventType {
  SHIPMENT_CREATED = 'SHIPMENT_CREATED',
  PICKUP = 'PICKUP',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_AT_FACILITY = 'ARRIVED_AT_FACILITY',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  EXCEPTION = 'EXCEPTION',
  RETURNED = 'RETURNED',
}

@Entity()
@Index({ properties: ['shipment', 'carrierEventId'] })
export class TrackingEvent {
  @PrimaryKey({ autoincrement: true })
  id!: number;

  @ManyToOne(() => Shipment)
  shipment!: Shipment;

  @Enum(() => Carrier)
  carrier!: Carrier;

  @Property()
  carrierEventId!: string; // Unique per event for idempotency

  @Property()
  eventType!: TrackingEventType;

  @Property()
  status!: string; // Raw carrier status string

  @Property({ type: 'json', nullable: true })
  location?: {
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };

  @Property({ type: 'json', nullable: true })
  rawPayload?: Record<string, any>;

  @Property()
  occurredAt!: Date;

  @Property({ onCreate: () => new Date() })
  createdAt?: Date = new Date();
}