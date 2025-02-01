import { Module } from '@nestjs/common';
import { MailerService } from '@/mailer/mailer.service';
import { BullModule } from '@nestjs/bull';
import { MailProcessor } from '@/mailer/mailer.processor';
import * as process from 'node:process';
import { config } from 'dotenv';
import { BULK_EMAIL_QUEUE } from '@/common/utility/constant';

config(); // Load .env file into process.env

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_DB_HOST,
        port: parseInt(process.env.REDIS_DB_PORT),
      },
      prefix: 'email_service:', // Use a unique prefix
    }),
    BullModule.registerQueue({
      name: BULK_EMAIL_QUEUE,
    }),
  ],
  providers: [MailerService, MailProcessor],
  exports: [MailerService, BullModule],
})
export class MailerModule {
}
