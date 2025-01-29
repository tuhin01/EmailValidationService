import { Module } from '@nestjs/common';
import { BulkFilesService } from './bulk-files.service';
import { BulkFilesController } from './bulk-files.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BulkFile } from './entities/bulk-file.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BulkFile])],
  controllers: [BulkFilesController],
  providers: [BulkFilesService],
})
export class BulkFilesModule {
}
