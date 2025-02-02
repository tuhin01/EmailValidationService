import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { BulkFilesModule } from '@/bulk-files/bulk-files.module';
import { DomainsModule } from '@/domains/domains.module';
import { SchedulerService } from '@/scheduler/scheduler.service';
import { MailerModule } from '@/mailer/mailer.module';
import { WinstonLoggerModule } from '@/logger/winston-logger.module';

@Module({
  providers: [SchedulerService],
  imports: [ScheduleModule.forRoot(), BulkFilesModule, DomainsModule, MailerModule, WinstonLoggerModule],
})
export class SchedulerModule {
}
