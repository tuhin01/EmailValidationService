import { PartialType } from '@nestjs/mapped-types';
import { CreateBulkFileDto } from './create-bulk-file.dto';

export class UpdateBulkFileDto extends PartialType(CreateBulkFileDto) {}
