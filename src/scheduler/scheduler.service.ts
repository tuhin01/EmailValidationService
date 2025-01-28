import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class SchedulerService {

  private readonly logger = new Logger(SchedulerService.name);
// * * * * * *
// | | | | | |
// | | | | | day of week
// | | | | months
// | | | day of month
// | | hours
// | minutes
// seconds (optional)
  @Cron('1 * * * * *')
  testSchedule() {
    this.logger.debug('Called when the current second is 45');

  }
}
