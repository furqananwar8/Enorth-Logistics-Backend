import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReminderWorker } from 'src/modules/worker/reminder.worker';
import { ReminderModule } from '../reminder/reminder.module';
import { NotificationsModule } from '../notification/notification.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from 'src/shared/redis/redis.module';
import { REDIS_CLIENT } from 'src/shared/redis/redis.module';
import Redis from 'ioredis';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ClaimDocumentWorkerModule } from '../claim/claim-document-worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    MikroOrmModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: (redisClient: Redis) => ({
        connection: redisClient,
      }),
      inject: [REDIS_CLIENT],
    }),
    ReminderModule,
    NotificationsModule,
    ClaimDocumentWorkerModule,
  ],
  providers: [ReminderWorker],
})
export class WorkerModule {}