import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BulkFilesService } from '../bulk-files/bulk-files.service';
import { DomainService } from '../domains/services/domain.service';
import * as fs from 'node:fs';
import { parse } from 'csv-parse';
import { UpdateBulkFileDto } from '../bulk-files/dto/update-bulk-file.dto';
import { BulkFileStatus } from '../bulk-files/entities/bulk-file.entity';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';

@Injectable()
export class SchedulerService {

  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private bulkFilesService: BulkFilesService,
    private domainService: DomainService,
  ) {
  }

  @Cron('1 * * * * *')
  async runFileEmailValidation() {
    this.logger.debug('Called every min');
    const pendingFiles = await this.bulkFilesService.getPendingBulkFile();
    console.log({ pendingFiles });
    if (!pendingFiles.length) {
      return;
    }
    const firstPendingFIle = pendingFiles[0];
    try {
      console.log('Start');
      const processingStatus: UpdateBulkFileDto = {
        file_status: BulkFileStatus.PROCESSING,
      };
      await this.bulkFilesService.updateBulkFile(firstPendingFIle.id, processingStatus);
      console.log('File Status updated to - PROCESSING');

      const results = await this.bulkValidate((firstPendingFIle.file_path));
      console.log(results);
      const fileName = firstPendingFIle.id + randomStringGenerator() + '.csv';
      const savedPath = await this.bulkFilesService.generateCsv(results, fileName);
      console.log(savedPath);
      const completeStatus: UpdateBulkFileDto = {
        file_status: BulkFileStatus.COMPLETE,
        validation_file_path: savedPath,
      };
      await this.bulkFilesService.updateBulkFile(firstPendingFIle.id, completeStatus);
      console.log('File Status updated to - COMPLETE');
      console.log('Done');
    } catch (e) {
      console.log(e);
    }

  }

  async bulkValidate(csvPath: string): Promise<any[]> {
    const results: any[] = [];
    return new Promise((resolve, reject) => {
      if (!csvPath) {
        reject('No file');
        return;
      }
      // Read the CSV file
      fs.readFile(csvPath, 'utf8', (err, data) => {
        if (err) {
          reject(err);
          return;
        }

        // Parse the CSV content
        parse(data, {
          columns: true,  // Convert rows to objects using the first row as keys
          skip_empty_lines: true,  // Ignore empty lines
          trim: true,  // Trim spaces from values
        }, async (err, records) => {
          if (err) {
            reject(err);
            return;
          }
          for (const record of records) {
            const emailResult = await this.domainService.smtpValidation(record.Email);
            console.log({ emailResult });
            results.push(emailResult);
          }
          resolve(results);
        });
      });
    });
  }

}
