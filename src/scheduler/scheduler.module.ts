import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { ScheduleModule } from '@nestjs/schedule';
import { BulkFilesModule } from '../bulk-files/bulk-files.module';
import { DomainsModule } from '../domains/domains.module';

@Module({
  providers: [SchedulerService],
  imports: [ScheduleModule.forRoot(), BulkFilesModule, DomainsModule],
})
export class SchedulerModule {}
