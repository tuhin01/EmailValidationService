import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BulkFilesController } from '@/bulk-files/bulk-files.controller';
import { BulkFilesService } from '@/bulk-files/bulk-files.service';
import { BulkFile } from '@/bulk-files/entities/bulk-file.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BulkFile])],
  controllers: [BulkFilesController],
  providers: [BulkFilesService],
  exports: [BulkFilesService],
})
export class BulkFilesModule {}
