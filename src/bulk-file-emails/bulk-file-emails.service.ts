import { Injectable } from '@nestjs/common';
import { CreateBulkFileEmailDto } from './dto/create-bulk-file-email.dto';
import { UpdateBulkFileEmailDto } from './dto/update-bulk-file-email.dto';

@Injectable()
export class BulkFileEmailsService {
  create(createBulkFileEmailDto: CreateBulkFileEmailDto) {
    return 'This action adds a new bulkFileEmail';
  }

  findAll() {
    return `This action returns all bulkFileEmails`;
  }

  findOne(id: number) {
    return `This action returns a #${id} bulkFileEmail`;
  }

  update(id: number, updateBulkFileEmailDto: UpdateBulkFileEmailDto) {
    return `This action updates a #${id} bulkFileEmail`;
  }

  remove(id: number) {
    return `This action removes a #${id} bulkFileEmail`;
  }
}
