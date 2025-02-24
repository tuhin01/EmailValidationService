import { Injectable } from '@nestjs/common';
import { CreateBulkFileEmailDto } from './dto/create-bulk-file-email.dto';
import { UpdateBulkFileEmailDto } from './dto/update-bulk-file-email.dto';
import { BulkFile } from '@/bulk-files/entities/bulk-file.entity';

@Injectable()
export class BulkFileEmailsService {
  async saveBulkFileEmails(bulkFile: BulkFile) {

  }
}
