// src/modules/tracking/tracking-scheduler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MikroORM } from '@mikro-orm/core';
import { Shipment } from '../../entities/shipment.entity';
import { getQueue } from './tracking-queues';

@Injectable()
export class TrackingSchedulerService {
    private readonly logger = new Logger(TrackingSchedulerService.name);

    constructor(private readonly orm: MikroORM) {}

    @Cron(CronExpression.EVERY_5_MINUTES)
    async scheduleDueShipments() {
        const em = this.orm.em.fork();
        const now = new Date();

        const dueShipments = await em.find(Shipment, {
            $and: [
                { nextPollAt: { $lte: now } },
                {
                    $or: [
                        { currentStatus: null },
                        { currentStatus: { $nin: ['DELIVERED', 'CANCELLED', 'RETURNED'] } }
                    ]
                },
                { trackingNumber: { $ne: null } },
                { carrier: { $ne: null } }
            ]
        }, { 
            limit: 1000,
            orderBy: { nextPollAt: 'ASC' }
        });

        this.logger.log(`[TrackingScheduler] ${dueShipments.length} shipments due for tracking`);

        for (const shipment of dueShipments) {
            try {
                const queue = getQueue(shipment.carrier!);
                
                // Use unique job ID to avoid collisions
                const jobId = `track-${shipment.id}-${Date.now()}`;
                await queue.add(
                    jobId,
                    { shipmentId: shipment.id, carrier: shipment.carrier },
                    { jobId, delay: 0 }
                );
                
                this.logger.log(`[TrackingScheduler] Queued job ${jobId} for shipment ${shipment.id}`);
                
                // Bump nextPollAt to prevent re-scheduling until worker processes it
                shipment.nextPollAt = new Date(Date.now() + 5 * 60 * 1000);
            } catch (err: any) {
                this.logger.error(`[TrackingScheduler] Failed to schedule ${shipment.id}: ${err.message}`);
            }
        }

        await em.flush();
    }

    @Cron(CronExpression.EVERY_HOUR)
    async safetyNet() {
        const em = this.orm.em.fork();
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const orphans = await em.find(Shipment, {
            $and: [
                {
                    $or: [
                        { nextPollAt: null },
                        { nextPollAt: { $lte: oneHourAgo } }
                    ]
                },
                {
                    $or: [
                        { currentStatus: null },
                        { currentStatus: { $nin: ['DELIVERED', 'CANCELLED', 'RETURNED'] } }
                    ]
                },
                { trackingNumber: { $ne: null } },
                { carrier: { $ne: null } }
            ]
        }, { limit: 500 });

        this.logger.log(`[TrackingScheduler] Safety net: ${orphans.length} orphaned shipments`);

        for (const shipment of orphans) {
            try {
                const queue = getQueue(shipment.carrier!);
                const jobId = `track-${shipment.id}-${Date.now()}`;
                await queue.add(
                    jobId,
                    { shipmentId: shipment.id, carrier: shipment.carrier },
                    { jobId, delay: 0 }
                );
                this.logger.log(`[TrackingScheduler] Safety net queued ${jobId} for shipment ${shipment.id}`);
                shipment.nextPollAt = new Date(Date.now() + 5 * 60 * 1000);
            } catch (err: any) {
                this.logger.error(`[TrackingScheduler] Safety net failed for ${shipment.id}: ${err.message}`);
            }
        }

        await em.flush();
    }
}