import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { BullModule } from '@nestjs/bull';
import * as process from 'node:process';
import { config } from 'dotenv';

import { GRAY_LIST_QUEUE } from '@/common/utility/constant';
import { QueueProcessor } from '@/queue/queue.processor';
import { MailerModule } from '@/mailer/mailer.module';
import { DomainsModule } from '@/domains/domains.module';
import { WinstonLoggerModule } from '@/logger/winston-logger.module';

config(); // Load .env file into process.env

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_DB_HOST,
        port: parseInt(process.env.REDIS_DB_PORT),
      },
      prefix: 'queue_service:', // Use a unique prefix
    }),
    BullModule.registerQueue({
      name: GRAY_LIST_QUEUE,
    }),
    MailerModule,
    DomainsModule,
    WinstonLoggerModule
  ],
  providers: [QueueService, QueueProcessor],
  exports: [QueueService, BullModule],
})
export class QueueModule {
}
