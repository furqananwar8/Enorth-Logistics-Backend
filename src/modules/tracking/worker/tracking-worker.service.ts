// src/modules/tracking/tracking-worker.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { Worker, Job } from 'bullmq';
import { Shipment } from 'src/entities/shipment.entity';
import { CARRIER_RATE_LIMITS, redisConnection, CARRIER_CONCURRENCY, getQueue } from '../tracking-queues';
import { TrackingUpdateService } from '../tracking-update.service';
import { ShipmentCarrierService } from 'src/modules/shipment-carrier/service/shipment-carrier.service';

@Injectable()
export class TrackingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingWorkerService.name);
  private workers: Worker[] = [];

  constructor(
    private readonly orm: MikroORM,
    private readonly carrierTracking: ShipmentCarrierService,
    private readonly trackingUpdate: TrackingUpdateService,
  ) {}

  onModuleInit() {
    this.logger.log('[WORKER] onModuleInit START');
    const carriers = Object.keys(CARRIER_RATE_LIMITS);
    this.logger.log(`Initializing tracking workers for carriers: ${carriers.join(', ')}`);

    for (const carrier of carriers) {
      const worker = new Worker(
        `tracking-${carrier.toLowerCase()}`,
        (job) => this.processJob(job),
        {
          connection: redisConnection,
          concurrency: CARRIER_CONCURRENCY[carrier],
          limiter: CARRIER_RATE_LIMITS[carrier],
        }
      );

      worker.on('completed', (job) => {
        this.logger.log(`[${carrier}] Job ${job.id} completed for shipment ${job.data.shipmentId}`);
      });

      worker.on('failed', (job, err) => {
        this.logger.error(`[${carrier}] Job ${job?.id} failed for shipment ${job?.data?.shipmentId}: ${err.message}`);
      });

      this.workers.push(worker);
      this.logger.log(`[${carrier}] Worker started (concurrency: ${CARRIER_CONCURRENCY[carrier]}, limit: ${CARRIER_RATE_LIMITS[carrier].max}/${CARRIER_RATE_LIMITS[carrier].duration}ms)`);
    }
  }

  onModuleDestroy() {
    this.logger.log('Shutting down tracking workers...');
    return Promise.all(this.workers.map(w => w.close()));
  }

  private async processJob(job: Job<{ shipmentId: number; carrier: string }>) {
    const { shipmentId, carrier } = job.data;
    const jobStart = Date.now();
    
    this.logger.log(`[${carrier}] START processing shipment ${shipmentId} | Job: ${job.id}`);

    // ── Distributed lock (prevents duplicate processing) ─────────────
    const lockKey = `tracking:lock:${shipmentId}`;
    const lock = await redisConnection.set(lockKey, '1', 'EX', 120, 'NX');
    if (!lock) {
      this.logger.warn(`[${carrier}] Shipment ${shipmentId} already locked by another worker — skipping`);
      return;
    }

    try {
      // ── Fork EM for isolated unit of work ─────────────────────────
      await RequestContext.create(this.orm.em.fork(), async () => {
       const shipment = await this.orm.em.findOne(Shipment, { id: shipmentId }, {
            populate: ['trackingEvents']
        });

        if (!shipment) {
          this.logger.warn(`[${carrier}] Shipment ${shipmentId} NOT FOUND in database`);
          return;
        }

        this.logger.log(`[${carrier}] Shipment ${shipmentId} found | PRO: ${shipment.trackingNumber} | Current status: ${shipment.currentStatus ?? 'null'}`);

        // Fetch from carrier
        this.logger.log(`[${carrier}] Calling carrier API for PRO ${shipment.trackingNumber}...`);
        const update = await this.carrierTracking.fetchUpdate(shipment);
        
        this.logger.log(`[${carrier}] API response for ${shipmentId}: rawStatus="${update.rawStatus}" | canonical="${update.canonicalStatus}" | label="${update.label}" | events=${update.events?.length ?? 0}`);

        if (update.events && update.events.length > 0) {
          this.logger.log(`[${carrier}] Events received for ${shipmentId}:`);
          update.events.forEach((evt, idx) => {
            this.logger.log(`  [${idx}] ts=${evt.timestamp ?? evt.date} | code=${evt.statusCode ?? evt.status ?? evt.histcode} | desc="${evt.description ?? evt.status ?? evt.histremarks}" | loc=${JSON.stringify(evt.location ?? evt.serviceCenter ?? evt.histcity ?? 'null')}`);
          });
        } else {
          this.logger.log(`[${carrier}] No events in carrier response for ${shipmentId}`);
        }

        // Apply update (persist + deduplicate)
        const result = await this.trackingUpdate.apply(shipment, update);
        
        this.logger.log(`[${carrier}] Persist result for ${shipmentId}: statusChanged=${result.statusChanged} | newEvents=${result.newEvents} | totalEvents=${shipment.trackingEvents?.count() ?? 'n/a'}`);

        if (result.newEvents > 0) {
          this.logger.log(`[${carrier}] New events persisted for ${shipmentId}:`);
          result.events.forEach((evt, idx) => {
            this.logger.log(`  [NEW ${idx}] type=${evt.eventType} | status="${evt.status}" | occurredAt=${evt.occurredAt.toISOString()}`);
          });
        }

        // Schedule next poll
        await this.scheduleNextPoll(shipment, update.canonicalStatus);
        
        const duration = Date.now() - jobStart;
        this.logger.log(`[${carrier}] DONE shipment ${shipmentId} in ${duration}ms | nextPollAt=${shipment.nextPollAt?.toISOString()}`);
      });

    } catch (error: any) {
      this.logger.error(`[${carrier}] ERROR processing shipment ${shipmentId}: ${error.message}`);
      this.logger.debug(`[${carrier}] Stack: ${error.stack}`);
      await this.handleError(error, shipmentId, carrier);
    } finally {
      await redisConnection.del(lockKey);
      this.logger.log(`[${carrier}] Lock released for shipment ${shipmentId}`);
    }
  }

  private async scheduleNextPoll(shipment: Shipment, canonicalStatus: string) {
    const interval = this.getPollInterval(canonicalStatus, shipment);
    const nextPollAt = new Date(Date.now() + interval);
    
    shipment.nextPollAt = nextPollAt;
    shipment.pollRetryCount = 0; // Reset on success
    
    await this.orm.em.flush();

    const queue = getQueue(shipment.carrier!);
    
    this.logger.log(`[${shipment.carrier}] Scheduling next poll for shipment ${shipment.id} in ${interval}ms (${Math.round(interval/1000)}s) at ${nextPollAt.toISOString()}`);

    try {
      // Use unique job ID with timestamp to avoid collisions
      const jobId = `track-${shipment.id}-${Date.now()}`;
      await queue.add(
        jobId,
        { shipmentId: shipment.id, carrier: shipment.carrier },
        {
          jobId,
          delay: interval,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }
      );
      this.logger.log(`[${shipment.carrier}] Next poll job queued successfully: ${jobId}`);
    } catch (err: any) {
      this.logger.error(`[${shipment.carrier}] Failed to queue next poll for ${shipment.id}: ${err.message}`);
      throw err;
    }
  }

  // ── TEST INTERVALS: 5 minutes for everything ──────────────────────
  private getPollInterval(canonicalStatus: string, shipment: Shipment): number {
    // TEST MODE: Poll every 5 minutes
    const TEST_INTERVAL = 2 * 60 * 60 * 1000; // 5 minutes
    
    this.logger.debug(`[${shipment.carrier}] getPollInterval called for status="${canonicalStatus}" | lastEventAt=${shipment.lastEventAt?.toISOString() ?? 'null'}`);
    
    return TEST_INTERVAL;
  }

  private async handleError(error: any, shipmentId: number, carrier: string) {
    this.logger.error(`[${carrier}] Handling error for shipment ${shipmentId}: ${error.message}`);

    await RequestContext.create(this.orm.em.fork(), async () => {
      const shipment = await this.orm.em.findOne(Shipment, { id: shipmentId });
      if (!shipment) {
        this.logger.warn(`[${carrier}] Cannot handle error — shipment ${shipmentId} not found`);
        return;
      }

      const retryCount = (shipment.pollRetryCount || 0) + 1;
      shipment.pollRetryCount = retryCount;
      
      // TEST MODE: Retry every 5 minutes
      const backoff = 5 * 60 * 1000; // 5 minutes for testing
      
      shipment.nextPollAt = new Date(Date.now() + backoff);
      await this.orm.em.flush();

      this.logger.log(`[${carrier}] Error backoff for ${shipmentId}: retryCount=${retryCount} | nextPollAt=${shipment.nextPollAt.toISOString()}`);

      // Re-queue with backoff using unique job ID
      const queue = getQueue(carrier);
      const jobId = `track-${shipmentId}-${Date.now()}`;
      await queue.add(
        jobId,
        { shipmentId, carrier },
        { jobId, delay: backoff }
      );
      this.logger.log(`[${carrier}] Re-queued shipment ${shipmentId} after error: ${jobId}`);

      if (retryCount >= 5) {
        this.logger.error(`[ALERT] Shipment ${shipmentId} (carrier: ${carrier}) has failed ${retryCount} tracking attempts`);
        // TODO: Emit alert to Slack/PagerDuty
      }
    });
  }
}