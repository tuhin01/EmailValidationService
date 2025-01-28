import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  providers: [SchedulerService],
  imports: [ScheduleModule.forRoot()],
})
export class SchedulerModule {
}
