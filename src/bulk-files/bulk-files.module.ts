import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BulkFilesController } from '@/bulk-files/bulk-files.controller';
import { BulkFilesService } from '@/bulk-files/bulk-files.service';
import { BulkFile } from '@/bulk-files/entities/bulk-file.entity';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BulkFile]),
    QueueModule,
  ],
  controllers: [BulkFilesController],
  providers: [BulkFilesService],
  exports: [BulkFilesService],
})
export class BulkFilesModule {
}
