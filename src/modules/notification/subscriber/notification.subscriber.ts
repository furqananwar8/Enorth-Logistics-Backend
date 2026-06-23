import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { SSEService } from "src/modules/sse/service/sse.service";
import { REDIS_CLIENT } from "src/shared/redis/redis.module";
// In your module/provider
@Injectable()
export class NotificationSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly subscriber: Redis;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sseService: SSEService,
  ) {
    this.subscriber = new Redis({
      host: redis.options.host || '127.0.0.1',
      port: redis.options.port || 6380,
    });
  }

  onModuleInit() {
  
  this.subscriber.on('connect', () => {
    console.log('[NotificationSubscriber] Redis client connected');
  });
  
  this.subscriber.on('error', (err) => {
    console.error('[NotificationSubscriber] Redis client error:', err);
  });

  this.subscriber.subscribe('notification.created', (err, count) => {
    if (err) {
      console.error('[NotificationSubscriber] Subscribe failed:', err);
    } else {
      console.log(`[NotificationSubscriber] Subscribed to ${count} channel(s)`);
    }
  });

    this.subscriber.on('message', async (channel, message) => {
      try {
        const data = JSON.parse(message);
        for (const userId of data.recipients) {
          await this.sseService.sendToUser(userId, {
            id: data.notificationId,
            event: 'notification.new',
            data: data.payload,
          });
        }
      } catch (err) {
        console.error('[NotificationSubscriber] Failed to process message:', err);
      }
    });
  }

  onModuleDestroy() {
    this.subscriber.unsubscribe();
    this.subscriber.quit();
  }
}