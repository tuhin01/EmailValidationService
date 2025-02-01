import * as fs from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { Cron } from '@nestjs/schedule';
import { parse } from 'csv-parse';

import { BulkFilesService } from '@/bulk-files/bulk-files.service';
import { UpdateBulkFileDto } from '@/bulk-files/dto/update-bulk-file.dto';
import { BulkFileStatus } from '@/bulk-files/entities/bulk-file.entity';
import {
  EmailStatus,
  EmailValidationResponseType,
} from '@/common/utility/email-status-type';
import { DomainService } from '@/domains/services/domain.service';
import { MailerService } from '@/mailer/mailer.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private bulkFilesService: BulkFilesService,
    private domainService: DomainService,
    private mailerService: MailerService,
  ) {
  }

  @Cron('1 * * * * *')
  public async runFileEmailValidation() {
    this.logger.debug('Called every min');
    const pendingFiles = await this.bulkFilesService.getPendingBulkFile();
    console.log({ pendingFiles });
    if (!pendingFiles.length) {
      return;
    }
    const firstPendingFIle = pendingFiles[0];
    try {
      const processingStatus: UpdateBulkFileDto = {
        file_status: BulkFileStatus.PROCESSING,
      };
      await this.bulkFilesService.updateBulkFile(
        firstPendingFIle.id,
        processingStatus,
      );

      const results = await this.__bulkValidate(firstPendingFIle.file_path);

      const fileName = firstPendingFIle.id + randomStringGenerator() + '.csv';
      const savedPath = await this.bulkFilesService.generateCsv(
        results,
        fileName,
      );

      const {
        valid_email_count,
        invalid_email_count,
        unknown_count,
        catch_all_count,
        do_not_mail_count,
        spam_trap_count,
      } = this.__prepareValidationResult(results);
      const completeStatus: UpdateBulkFileDto = {
        file_status: BulkFileStatus.COMPLETE,
        validation_file_path: savedPath,
        valid_email_count,
        invalid_email_count,
        unknown_count,
        catch_all_count,
        do_not_mail_count,
        spam_trap_count,
      };
      await this.bulkFilesService.updateBulkFile(
        firstPendingFIle.id,
        completeStatus,
      );
      console.log('File Status updated to - COMPLETE');
      console.log('Done');

      await this.mailerService.sendEmail(
        `Tuhin Pathan <tuhin.world@gmail.com>`,
        'Email validation is complete',
        'welcome',
        { 'name': 'John Doe' },
      );

    } catch (e) {
      console.log(e);
    }
  }

  private __prepareValidationResult(emails: EmailValidationResponseType[]) {
    const result = {
      valid_email_count: 0,
      invalid_email_count: 0,
      spam_trap_count: 0,
      unknown_count: 0,
      catch_all_count: 0,
      do_not_mail_count: 0,
    };

    emails.forEach((email: EmailValidationResponseType) => {
      if (email.email_status === EmailStatus.VALID) {
        result.valid_email_count++;
      }
      if (
        email.email_status === EmailStatus.INVALID ||
        email.email_status === EmailStatus.INVALID_DOMAIN
      ) {
        result.invalid_email_count++;
      }
      if (email.email_status === EmailStatus.CATCH_ALL) {
        result.catch_all_count++;
      }
      if (email.email_status === EmailStatus.UNKNOWN) {
        result.unknown_count++;
      }
      if (email.email_status === EmailStatus.SPAMTRAP) {
        result.spam_trap_count++;
      }
      if (email.email_status === EmailStatus.DO_NOT_MAIL) {
        result.do_not_mail_count++;
      }
    });

    return result;
  }

  private async __bulkValidate(csvPath: string): Promise<any[]> {
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
        parse(
          data,
          {
            columns: true, // Convert rows to objects using the first row as keys
            skip_empty_lines: true, // Ignore empty lines
            trim: true, // Trim spaces from values
          },
          async (err, records) => {
            if (err) {
              reject(err);
              return;
            }
            for (const record of records) {
              const emailResult = await this.domainService.smtpValidation(
                record.Email,
              );
              console.log({ emailResult });
              results.push(emailResult);
            }
            resolve(results);
          },
        );
      });
    });
  }
}
