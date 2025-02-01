import { Module } from '@nestjs/common';
import { MailerService } from '@/mailer/mailer.service';
import { BullModule } from '@nestjs/bull';
import { MailProcessor } from '@/mailer/mailer.processor';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: 'localhost', // Update if Redis is running remotely
        port: 6379,
      },
      prefix: 'email_service:', // Use a unique prefix
    }),
    BullModule.registerQueue({
      name: 'emailQueue',
    }),
  ],
  providers: [MailerService, MailProcessor],
  exports: [MailerService, BullModule],
})
export class MailerModule {
}
