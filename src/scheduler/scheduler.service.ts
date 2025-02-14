import * as fs from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { parse } from 'csv-parse';
import { Queue } from 'bull';

import { BulkFilesService } from '@/bulk-files/bulk-files.service';
import { UpdateBulkFileDto } from '@/bulk-files/dto/update-bulk-file.dto';
import { BulkFile, BulkFileStatus } from '@/bulk-files/entities/bulk-file.entity';
import {
  EmailReason,
  EmailStatus,
  EmailStatusType,
  EmailValidationResponseType,
} from '@/common/utility/email-status-type';
import { DomainService } from '@/domains/services/domain.service';
import { InjectQueue } from '@nestjs/bull';
import { WinstonLoggerService } from '@/logger/winston-logger.service';
import Bottleneck from 'bottleneck';
import { UsersService } from '@/users/users.service';
import { User } from '@/users/entities/user.entity';
import * as process from 'node:process';
import * as path from 'path';
import { ProcessedEmail, RetryStatus } from '@/domains/entities/processed_email.entity';
import { Domain, MXRecord } from '@/domains/entities/domain.entity';
import { TimeService } from '@/time/time.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private bulkFilesService: BulkFilesService,
    private domainService: DomainService,
    private userService: UsersService,
    private timeService: TimeService,
    private winstonLoggerService: WinstonLoggerService,
    @InjectQueue('emailQueue') private emailQueue: Queue,
  ) {
  }

  @Cron('1 * * * * *') // Runs every minutes
  public async runFileEmailValidation() {
    const pendingFiles: BulkFile[] = await this.bulkFilesService.getPendingBulkFile();
    console.log({ pendingFiles });
    if (!pendingFiles.length) {
      return;
    }
    const firstPendingFile: BulkFile = pendingFiles[0];
    const user: User = await this.userService.findOneById(firstPendingFile.user_id);
    if (!user) {
      this.winstonLoggerService.error('runFileEmailValidation()', `No user found for user_id: ${firstPendingFile.user_id}`);

      return;
    }
    try {
      const processingStatus: UpdateBulkFileDto = {
        file_status: BulkFileStatus.PROCESSING,
      };
      await this.bulkFilesService.updateBulkFile(
        firstPendingFile.id,
        processingStatus,
      );
      const results: any[] = await this.__bulkValidate(firstPendingFile, user);
      const folderName: string = firstPendingFile.file_path.split('/').at(-1).replace('.csv', '');
      const csvSavePath: string = path.join(process.cwd(), 'uploads', 'csv', 'validated', folderName);

      const {
        valid_email_count,
        invalid_email_count,
        unknown_count,
        temporary_blocked,
        catch_all_count,
        do_not_mail_count,
        spam_trap_count,
      } = await this.__saveValidationResultsInCsv(results, folderName);
      const updateData: UpdateBulkFileDto = {
        file_status: temporary_blocked > 0 ? BulkFileStatus.GRAY_LIST_CHECK : BulkFileStatus.COMPLETE,
        validation_file_path: csvSavePath,
        valid_email_count,
        invalid_email_count,
        unknown_count,
        catch_all_count,
        do_not_mail_count,
        spam_trap_count,
        updated_at: new Date(),
      };
      await this.bulkFilesService.updateBulkFile(
        firstPendingFile.id,
        updateData,
      );
      console.log('File Status updated to - COMPLETE');

      const to = `${user.first_name} ${user.last_name} <${user.email_address}>`;
      const emailData = {
        to,
        subject: 'Email validation is complete',
        template: 'welcome',
        context: { 'name': `${user.first_name}` },
      };
      // await this.emailQueue.add(BULK_EMAIL_SEND, emailData, {
      //   attempts: 3, // Retry 3 times if failed
      // });

      console.log('Email Sent');

    } catch (e) {
      this.winstonLoggerService.error('Bulk File Error', e.trace);
      console.log(e);
    }
  }

  @Cron('1 * * * * *') // Runs every minutes
  public async runGrayListEmailValidation() {
    const grayListFile = await this.bulkFilesService.getGrayListCheckBulkFile();
    console.log({ grayListFile });
    if (!grayListFile.length) {
      return;
    }
    const firstGrayListFile: BulkFile = grayListFile[0];
    const user: User = await this.userService.findOneById(firstGrayListFile.user_id);
    if (!user) {
      this.winstonLoggerService.error('runGrayListEmailValidation()', `No user found for user_id: ${firstGrayListFile.user_id}`);

      return;
    }

    // Check if we should run the gray list check or not at this time.
    const shouldRun: boolean = this.timeService.shouldRunGrayListCheck(firstGrayListFile);
    console.log({ shouldRun });
    if (!shouldRun) {
      return;
    }

    const processedEmails: ProcessedEmail[] = await this.domainService.getGrayListedProcessedEmail(firstGrayListFile.id);
    console.log(processedEmails.length);
    if (!processedEmails.length) {
      return;
    }
    await this.__bulkGrayListValidate(processedEmails);

    // Generate all csv and update DB with updated counts.
    await this.generateBulkFileResultCsv(firstGrayListFile.id);

    const completeStatus: UpdateBulkFileDto = {
      file_status: BulkFileStatus.COMPLETE,
    };
    await this.bulkFilesService.updateBulkFile(
      firstGrayListFile.id,
      completeStatus,
    );
  }

  public async generateBulkFileResultCsv(fileId: number) {
    const bulkFile: BulkFile = await this.bulkFilesService.getBulkFile(fileId);
    const processedEmails: ProcessedEmail[] = await this.domainService.findProcessedEmailsByFileId(bulkFile.id);
    const results = await this.__readSCsvAndMergeValidationResults(bulkFile.file_path, processedEmails);
    const folderName: string = bulkFile.file_path.split('/').at(-1).replace('.csv', '');
    const {
      valid_email_count,
      invalid_email_count,
      unknown_count,
      temporary_blocked,
      catch_all_count,
      do_not_mail_count,
      spam_trap_count,
    } = await this.__saveValidationResultsInCsv(results, folderName);
    const updateData: UpdateBulkFileDto = {
      valid_email_count,
      invalid_email_count,
      unknown_count,
      catch_all_count,
      do_not_mail_count,
      spam_trap_count,
      updated_at: new Date(),
    };
    await this.bulkFilesService.updateBulkFile(
      fileId,
      updateData,
    );
  }

  private async __bulkGrayListValidate(emails: ProcessedEmail[]) {
    // Bottleneck for rate limiting (CommonJS compatible)
    const limiter = new Bottleneck({
      maxConcurrent: 1, // Adjust based on your testing
      minTime: 300, // 200ms delay between requests (adjustable)
    });

    const validationPromises: Promise<any>[] = emails.map((processedEmail: ProcessedEmail) => limiter.schedule(async () => {
      console.log(`Gray Verify ${processedEmail.email_address} started`);
      // Update retry and email status in DB
      let updateData: any = {
        retry: RetryStatus.IN_PROGRESS,
      };
      await this.domainService.updateProcessedEmail(processedEmail.id, updateData);

      const domain: Domain = await this.domainService.findOne(processedEmail.domain);
      let emailStatus: EmailStatusType;
      try {
        const allMxRecordHost: MXRecord[] = JSON.parse(domain.mx_record_hosts);
        const index = Math.floor(Math.random() * allMxRecordHost.length);
        const mxRecordHost = allMxRecordHost[index].exchange;

        emailStatus = await this.domainService.verifySmtp(processedEmail.email_address, mxRecordHost);
      } catch (e) {
        emailStatus = { ...e };
        this.winstonLoggerService.error('Gray List Error', e);
      }
      updateData = {
        retry: RetryStatus.COMPLETE,
      };
      // Only update email_status in DB when retry finds it as valid.
      // We need to do this to make sure
      if (emailStatus.status === EmailStatus.VALID) {
        updateData = {
          email_status: emailStatus.status,
          retry: RetryStatus.COMPLETE,
        };
      }
      await this.domainService.updateProcessedEmail(processedEmail.id, updateData);
      return emailStatus;
    }));

    // Wait for all validations to complete
    const results = await Promise.allSettled(validationPromises);
    return results
      .filter(result => result.status === 'fulfilled')
      .map(result => (result as PromiseFulfilledResult<any>).value);

  }

  private async __saveValidationResultsInCsv(results: EmailValidationResponseType[], folderName: string) {
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
      [EmailReason.DOES_NOT_ACCEPT_MAIL]: [],
      [EmailReason.IP_BLOCKED]: [],
      [EmailStatus.CATCH_ALL]: [],
      [EmailStatus.TEMPORARILY_UNAVAILABLE]: [],
      [EmailStatus.SPAMTRAP]: [],
      [EmailStatus.VALID]: [],
    };
    results.forEach((email: EmailValidationResponseType) => {
      if (email.email_status === EmailStatus.VALID) {
        fileWithStatusTypes[EmailStatus.VALID].push(email);
      } else if (email.email_status === EmailStatus.CATCH_ALL) {
        fileWithStatusTypes[EmailStatus.CATCH_ALL].push(email);
      } else if (email.email_status === EmailStatus.TEMPORARILY_UNAVAILABLE) {
        fileWithStatusTypes[EmailStatus.TEMPORARILY_UNAVAILABLE].push(email);
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
      } else if (email.email_sub_status === EmailReason.DOES_NOT_ACCEPT_MAIL) {
        fileWithStatusTypes[EmailReason.DOES_NOT_ACCEPT_MAIL].push(email);
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

    return {
      valid_email_count: fileWithStatusTypes[EmailStatus.VALID].length,
      invalid_email_count,
      unknown_count,
      temporary_blocked: fileWithStatusTypes[EmailStatus.TEMPORARILY_UNAVAILABLE].length,
      catch_all_count: fileWithStatusTypes[EmailStatus.CATCH_ALL].length,
      do_not_mail_count,
      spam_trap_count: fileWithStatusTypes[EmailStatus.SPAMTRAP].length,
    };
  }

  private async __bulkValidate(bulkFile: BulkFile, user: User): Promise<any[]> {
    const csvPath = bulkFile.file_path;
    if (!csvPath) {
      throw new Error('No file path provided');
    }
    let csvHeaders = [];
    // Bottleneck for rate limiting (CommonJS compatible)
    const limiter = new Bottleneck({
      maxConcurrent: 3, // Adjust based on your testing
      minTime: 300, // 300ms delay between requests (adjustable)
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
            return null; // Skip records without an Email field
          }
          const validationResponse: EmailValidationResponseType = await this.domainService.smtpValidation(
            record.Email,
            user,
            bulkFile.id,
          );
          // console.log(validationResponse.email_status);
          return {
            ...record,
            ...validationResponse,
          };
        }),
      );
      console.log('CC');
      // Wait for all validations to complete
      const results = await Promise.allSettled(validationPromises);
      console.log('DD');

      return results
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<any>).value);
    } catch (err) {
      console.error('Error during bulk validation:', err);
      throw err;
    }
  }

  private async __readSCsvAndMergeValidationResults(csvPath: string, emailValidationData: ProcessedEmail[]) {
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
              resolve(records);
            }
          },
        );
      });

      for (let record of records) {
        const validationResponse: EmailValidationResponseType = emailValidationData.find(e => {
          return e.email_address === record.Email;
        });
        Object.assign(record, validationResponse); // Merges source into target (modifies target)
      }

      return records;
    } catch (err) {
      console.error('Error during bulk validation:', err);
      throw err;
    }
  }

}
