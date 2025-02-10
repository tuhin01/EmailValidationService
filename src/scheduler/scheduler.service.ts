import * as fs from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { Cron } from '@nestjs/schedule';
import { parse } from 'csv-parse';
import { Queue } from 'bull';

import { BulkFilesService } from '@/bulk-files/bulk-files.service';
import { UpdateBulkFileDto } from '@/bulk-files/dto/update-bulk-file.dto';
import { BulkFileStatus } from '@/bulk-files/entities/bulk-file.entity';
import {
  EmailReason,
  EmailStatus,
  EmailValidationResponseType,
} from '@/common/utility/email-status-type';
import { DomainService } from '@/domains/services/domain.service';
import { InjectQueue } from '@nestjs/bull';
import { BULK_EMAIL_SEND } from '@/common/utility/constant';
import { WinstonLoggerService } from '@/logger/winston-logger.service';
import Bottleneck from 'bottleneck';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private bulkFilesService: BulkFilesService,
    private domainService: DomainService,
    private winstonLoggerService: WinstonLoggerService,
    @InjectQueue('emailQueue') private emailQueue: Queue,
  ) {
  }

  @Cron('1 * * * * *')
  public async runFileEmailValidation() {
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
      let invalid_email_count = 0;
      let do_not_mail_count = 0;
      let unknown_count = 0;
      const fileWithStatusTypes = {
        [EmailReason.ROLE_BASED]: [],
        [EmailReason.UNVERIFIABLE_EMAIL]: [],
        [EmailReason.DISPOSABLE_DOMAIN]: [],
        [EmailReason.MAILBOX_NOT_FOUND]: [],
        [EmailReason.DOMAIN_NOT_FOUND]: [],
        [EmailReason.SMTP_TIMEOUT]: [],
        [EmailReason.IP_BLOCKED]: [],
        [EmailStatus.CATCH_ALL]: [],
        [EmailStatus.SPAMTRAP]: [],
        [EmailStatus.VALID]: [],
      };
      results.forEach((email: EmailValidationResponseType) => {
        if (email.email_status === EmailStatus.VALID) {
          fileWithStatusTypes[EmailStatus.VALID].push(email);
        } else if (email.email_status === EmailStatus.CATCH_ALL) {
          fileWithStatusTypes[EmailStatus.CATCH_ALL].push(email);
        } else if (email.email_status === EmailStatus.SPAMTRAP) {
          fileWithStatusTypes[EmailStatus.SPAMTRAP].push(email);
        } else if (email.email_sub_status === EmailReason.ROLE_BASED) {
          fileWithStatusTypes[EmailReason.ROLE_BASED].push(email);
        } else if (email.email_sub_status === EmailReason.UNVERIFIABLE_EMAIL) {
          fileWithStatusTypes[EmailReason.UNVERIFIABLE_EMAIL].push(email);
        } else if (email.email_sub_status === EmailReason.DISPOSABLE_DOMAIN) {
          fileWithStatusTypes[EmailReason.DISPOSABLE_DOMAIN].push(email);
        } else if (email.email_sub_status === EmailReason.MAILBOX_NOT_FOUND) {
          fileWithStatusTypes[EmailReason.MAILBOX_NOT_FOUND].push(email);
        } else if (email.email_sub_status === EmailReason.DOMAIN_NOT_FOUND) {
          fileWithStatusTypes[EmailReason.DOMAIN_NOT_FOUND].push(email);
        } else if (email.email_sub_status === EmailReason.SMTP_TIMEOUT) {
          fileWithStatusTypes[EmailReason.SMTP_TIMEOUT].push(email);
        } else if (email.email_sub_status === EmailReason.IP_BLOCKED) {
          fileWithStatusTypes[EmailReason.IP_BLOCKED].push(email);
        }

        if (
          email.email_status === EmailStatus.INVALID ||
          email.email_status === EmailStatus.INVALID_DOMAIN
        ) {
          invalid_email_count++;
        } else if (
          email.email_status === EmailStatus.UNKNOWN ||
          email.email_sub_status === EmailReason.IP_BLOCKED
        ) {
          unknown_count++;
        } else if (email.email_status === EmailStatus.DO_NOT_MAIL) {
          do_not_mail_count++;
        }
      });

      const folderName = firstPendingFIle.file_path.split('/').at(-1).replace('.csv', '');

      for (const fileType of Object.keys(fileWithStatusTypes)) {
        const fileName = folderName + '/' + fileType + '.csv';
        const csvData: [] = fileWithStatusTypes[fileType];
        if (csvData.length) {
          await this.bulkFilesService.generateCsv(
            csvData,
            fileName,
          );
          console.log(`${fileName} created`);
        }
      }

      // All data in one file.
      await this.bulkFilesService.generateCsv(
        results,
        folderName + '/combined.csv',
      );
      console.log(`combined.csv created`);

      const completeStatus: UpdateBulkFileDto = {
        file_status: BulkFileStatus.COMPLETE,
        validation_file_path: './uploads/csv/validated/' + folderName,
        valid_email_count: fileWithStatusTypes[EmailStatus.VALID].length,
        invalid_email_count,
        unknown_count,
        catch_all_count: fileWithStatusTypes[EmailStatus.CATCH_ALL].length,
        do_not_mail_count,
        spam_trap_count: fileWithStatusTypes[EmailStatus.SPAMTRAP].length,
      };
      await this.bulkFilesService.updateBulkFile(
        firstPendingFIle.id,
        completeStatus,
      );
      console.log('File Status updated to - COMPLETE');
      console.log('Done');

      // const emailData = {
      //   to: `Tuhin Pathan <tuhin.world@gmail.com>`,
      //   subject: 'Email validation is complete',
      //   template: 'welcome',
      //   context: { 'name': 'John Doe' },
      // };
      // await this.emailQueue.add(BULK_EMAIL_SEND, emailData, {
      //   attempts: 3, // Retry 3 times if failed
      // });

    } catch (e) {
      this.winstonLoggerService.error('Bulk File Error', e.trace);
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
    if (!csvPath) {
      throw new Error('No file path provided');
    }
    let csvHeaders = [];
    // Bottleneck for rate limiting (CommonJS compatible)
    const limiter = new Bottleneck({
      maxConcurrent: 4, // Adjust based on your testing
      minTime: 250, // 200ms delay between requests (adjustable)
    });

    try {
      // Read the CSV file
      const data = await fs.promises.readFile(csvPath, 'utf8');

      // Parse the CSV content
      const records = await new Promise<any[]>((resolve, reject) => {
        parse(
          data,
          {
            columns: true, // Convert rows to objects using the first row as keys
            skip_empty_lines: true, // Ignore empty lines
            trim: true, // Trim spaces from values
          },
          (err, records) => {
            if (err) {
              reject(err);
            } else {
              csvHeaders = records[0];
              resolve(records);
            }
          },
        );
      });

      // Validate emails in parallel
      const validationPromises: Promise<any>[] = records.map((record) => limiter.schedule(async () => {
        if (!record.Email) {
          console.warn('Missing Email field in record:', record);
          return null; // Skip records without an Email field
        }
        console.log(`Verify ${record.Email} started`);
        const validationResponse: EmailValidationResponseType = await this.domainService.smtpValidation(record.Email);
        console.log(`email_status: ${validationResponse.email_status} email_sub_status:${validationResponse.email_sub_status}`);
        return {
          ...record,
          ...validationResponse,
        };
      }));

      // Wait for all validations to complete
      const results = await Promise.allSettled(validationPromises);
      return results
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<any>).value);
    } catch (err) {
      console.error('Error during bulk validation:', err);
      throw err;
    }
  }

}
