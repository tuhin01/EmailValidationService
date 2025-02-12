import { Injectable } from '@nestjs/common';
import { differenceInMinutes } from 'date-fns';
import { BulkFile } from '@/bulk-files/entities/bulk-file.entity';
import { GRAY_LIST_MIN_GAP } from '@/common/utility/constant';

@Injectable()
export class TimeService {
  public getTimeDifferenceInMin(date1: Date, date2: Date) {
    return differenceInMinutes(date1, date2);
  }

  public shouldRunGrayListCheck(file: BulkFile): boolean {
    const bulkFileCreatedDate: Date = file.updated_at;
    const now = new Date();

    const minutesPassed = this.getTimeDifferenceInMin(
      now, bulkFileCreatedDate,
    );
    if (minutesPassed < GRAY_LIST_MIN_GAP) {
      return false;
    }

    return true;
  }

}
