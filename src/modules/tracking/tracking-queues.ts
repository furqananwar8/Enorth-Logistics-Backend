// src/modules/tracking/tracking-queues.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const redisConnection = new IORedis(process.env.REDIS_CLIENT_URL!, {
  maxRetriesPerRequest: null,
});

export const TRACKING_QUEUES = {
  FEDEX:  new Queue('tracking-fedex',  { connection: redisConnection, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }),
  XPO:    new Queue('tracking-xpo',    { connection: redisConnection, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }),
  TST:    new Queue('tracking-tst',    { connection: redisConnection, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }),
  TFORCE: new Queue('tracking-tforce', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }),
  MINIMAX:new Queue('tracking-minimax',{ connection: redisConnection, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 } }),
} as const;

export function getQueue(carrier: string): Queue {
  const key = carrier.toUpperCase() as keyof typeof TRACKING_QUEUES;
  const q = TRACKING_QUEUES[key];
  if (!q) throw new Error(`No queue for carrier: ${carrier}`);
  return q;
}

export const CARRIER_RATE_LIMITS: Record<string, { max: number; duration: number }> = {
  FEDEX:  { max: 200, duration: 60000 },
  XPO:    { max: 60,  duration: 60000 },
  TST:    { max: 10,  duration: 60000 },
  TFORCE: { max: 30,  duration: 60000 },
  MINIMAX:{ max: 20,  duration: 60000 },
};

export const CARRIER_CONCURRENCY: Record<string, number> = {
  FEDEX:  15,
  XPO:    5,
  TST:    2,
  TFORCE: 3,
  MINIMAX: 2,
};