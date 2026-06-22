// src/modules/tracking/tracking-update.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Shipment } from '../../entities/shipment.entity';
import { TrackingEvent, TrackingEventType } from 'src/entities/mock-carrier-tracking.entity';
import { CarrierStatusRegistry } from './carrier-status.registery';

export interface TrackingUpdatePayload {
  rawStatus: string;
  canonicalStatus: string;
  eventType: TrackingEventType | null;
  label: string;
  events: any[];
}

@Injectable()
export class TrackingUpdateService {
  private readonly logger = new Logger(TrackingUpdateService.name);

  constructor(private readonly em: EntityManager) {}

  async apply(shipment: Shipment, update: TrackingUpdatePayload): Promise<{
    statusChanged: boolean;
    newEvents: number;
    events: TrackingEvent[];
  }> {
      const now = new Date();
      const previousStatus = shipment.currentStatus;
      
      // ── 1. Update shipment state ─────────────────────────────────────
      shipment.currentStatus = update.label;
      shipment.lastTrackedAt = now;

      // ── 2. Initialize trackingEvents collection if needed ────────────
      if (!shipment.trackingEvents.isInitialized()) {
          await shipment.trackingEvents.init();
      }

      // ── 3. Process events with deduplication ───────────────────────
      const newEvents: TrackingEvent[] = [];
      const seenIds = new Set<string>();

      for (const rawEvent of update.events) {
          const occurredAt = this.parseTimestamp(
              rawEvent.timestamp ?? rawEvent.date ?? rawEvent.histdate,
              rawEvent.time ?? rawEvent.histtime
          );
          
          if (!occurredAt) {
              this.logger.warn(`Skipping event with unparseable timestamp: ${JSON.stringify(rawEvent)}`);
              continue;
          }

          const carrierEventId = CarrierStatusRegistry.generateEventId(
              shipment.carrier!,
              shipment.trackingNumber!,
              rawEvent
          );

          // Deduplicate within the same batch first
          if (seenIds.has(carrierEventId)) {
              this.logger.debug(`Event ${carrierEventId} already seen in batch, skipping`);
              continue;
          }

          const exists = await this.em.findOne(TrackingEvent, {
              shipment: shipment.id,
              carrierEventId,
          });

          let finalCarrierEventId = carrierEventId;

          if (exists) {
              const incomingStatus = rawEvent.status || rawEvent.description || rawEvent.histremarks || update.rawStatus;

              // ── DEFENSIVE: same ID but different status = carrier updated the event ──
              if (exists.status !== incomingStatus) {
                  this.logger.warn(
                      `Event ${carrierEventId} exists with different status (${exists.status} → ${incomingStatus}). ` +
                      `Treating as new event.`
                  );
                  finalCarrierEventId = `${carrierEventId}_${Date.now()}`;
              } else {
                  this.logger.debug(`Event ${carrierEventId} already exists in DB, skipping`);
                  seenIds.add(carrierEventId);
                  continue;
              }
          }

          seenIds.add(finalCarrierEventId);

          const eventNorm = CarrierStatusRegistry.normalize(
              shipment.carrier!,
              rawEvent.statusCode || rawEvent.status || rawEvent.histcode || rawEvent.histremarks || update.rawStatus
          );

          const event = this.em.create(TrackingEvent, {
              shipment,
              carrier: shipment.carrier as any,
              carrierEventId: finalCarrierEventId,
              eventType: eventNorm.eventType || TrackingEventType.IN_TRANSIT,
              status: rawEvent.status || rawEvent.description || rawEvent.histremarks || update.rawStatus,
              location: this.extractLocation(rawEvent),
              rawPayload: rawEvent,
              occurredAt,
              createdAt: new Date()
          });

          shipment.trackingEvents.add(event);
          newEvents.push(event);
          shipment.lastEventAt = occurredAt;
          
          this.logger.debug(`Created new tracking event: ${finalCarrierEventId} | type=${eventNorm.eventType}`);
      }

      // ── 4. Persist ───────────────────────────────────────────────────
      if (newEvents.length > 0) {
          this.em.persist(newEvents);
      }
      this.em.persist(shipment);
      await this.em.flush();

      // ── 5. Emit domain events ────────────────────────────────────────
      const statusChanged = previousStatus !== update.label;
      if (statusChanged || newEvents.length > 0) {
          this.logger.log(
              `Shipment ${shipment.id} updated: status ${previousStatus} → ${update.label}, ${newEvents.length} new events`
          );
      }

      return {
          statusChanged,
          newEvents: newEvents.length,
          events: newEvents,
      };
  }
  
  private parseTimestamp(ts: any, time?: any): Date | null {
    if (!ts && !time) return null;
    if (ts instanceof Date) return ts;
    
    // Minimax format: date='2026-06-19', time='15:20'
    if (typeof ts === 'string' && time) {
      const timeStr = String(time).padStart(5, '0'); // '15:20'
      const combined = new Date(`${ts}T${timeStr}:00`);
      if (!isNaN(combined.getTime())) return combined;
    }
    
    // ISO string
    const iso = new Date(ts);
    if (!isNaN(iso.getTime())) return iso;

    // TST format: "20240615T1430" or "2024-06-15T14:30:00"
    const tstMatch = String(ts).match(/^(\d{4})(\d{2})(\d{2})T?(\d{2}):?(\d{2})/);
    if (tstMatch) {
      const [, y, m, d, h, min] = tstMatch;
      const parsed = new Date(`${y}-${m}-${d}T${h}:${min}:00`);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // Date-only: "2026-06-19"
    const dateOnly = new Date(`${ts}T00:00:00`);
    if (!isNaN(dateOnly.getTime())) return dateOnly;

    return null;
  }

  private extractLocation(event: any) {
    if (!event) return undefined;

    // FedEx structured location
    if (event.location?.city) {
      return {
        city: event.location.city,
        state: event.location.state || event.location.stateOrProvinceCode,
        country: event.location.country || event.location.countryCode,
        postalCode: event.location.postalCode,
      };
    }

    // Minimax histcity/histstate
    if (event.histcity || event.histstate) {
      return {
        city: event.histcity || undefined,
        state: event.histstate || undefined,
      };
    }

    // XPO / TForce string location
    if (typeof event.location === 'string' && event.location) {
      return { city: event.location };
    }

    // TForce serviceCenter
    if (event.serviceCenter) {
      return { city: event.serviceCenter };
    }

    // Minimax statusCity/statusState from normalized response
    if (event.statusCity || event.statusState) {
      return {
        city: event.statusCity || undefined,
        state: event.statusState || undefined,
      };
    }

    return undefined;
  }
}