import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class SchedulerService {

  private readonly logger = new Logger(SchedulerService.name);
  @Cron('0 * * * * *')
  testSchedule() {
    this.logger.debug('Called when the current second is 45');

  }
}
