import { Injectable } from '@nestjs/common';
import { differenceInMinutes } from 'date-fns';
import { BulkFile } from '@/bulk-files/entities/bulk-file.entity';
import { GRAY_LIST_MINUTE_GAP } from '@/common/utility/constant';

@Injectable()
export class TimeService {
  public getTimeDifferenceInMin(date1: Date, date2: Date) {
    return differenceInMinutes(date1, date2);
  }

  public shouldRunGrayListCheck(file: BulkFile): boolean {
    const updatedAt: Date = file.updated_at;
    const now = new Date();

    const minutesPassed = this.getTimeDifferenceInMin(
      now, updatedAt,
    );
    return minutesPassed >= GRAY_LIST_MINUTE_GAP;
  }

}
