import * as fs from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { parse } from 'csv-parse';

import { BulkFilesService } from '@/bulk-files/bulk-files.service';
import { UpdateBulkFileDto } from '@/bulk-files/dto/update-bulk-file.dto';
import { BulkFile, BulkFileStatus } from '@/bulk-files/entities/bulk-file.entity';
import { EmailReason, EmailStatus, EmailValidationResponseType } from '@/common/utility/email-status-type';
import { DomainService } from '@/domains/services/domain.service';
import { WinstonLoggerService } from '@/logger/winston-logger.service';
import Bottleneck from 'bottleneck';
import { UsersService } from '@/users/users.service';
import { User } from '@/users/entities/user.entity';
import * as process from 'node:process';
import * as path from 'path';
import { ProcessedEmail } from '@/domains/entities/processed_email.entity';
import { TimeService } from '@/time/time.service';
import { LEAD_WRAP } from '@/common/utility/constant';
import { QueueService } from '@/queue/queue.service';
import { Attachment } from 'nodemailer/lib/mailer';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private bulkFilesService: BulkFilesService,
    private domainService: DomainService,
    private userService: UsersService,
    private timeService: TimeService,
    private queueService: QueueService,
    private winstonLoggerService: WinstonLoggerService,
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
      console.log(temporary_blocked);
      const bulkFileUpdateData: UpdateBulkFileDto = {
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
        bulkFileUpdateData,
      );

      // Send email notification if the file status is complete
      if (bulkFileUpdateData.file_status === BulkFileStatus.COMPLETE) {
        await this.__sendEmailNotification(user, csvSavePath);
      }

      console.log('File Status updated to - COMPLETE');

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

    const processedEmails: ProcessedEmail[] = await this.domainService.getGrayListedProcessedEmail(firstGrayListFile.id);
    console.log(processedEmails.length);
    if (processedEmails.length) {
      console.log('GrayList is in progress...');
      return;
    }
    // Generate all csv and update DB with updated counts.
    await this.generateBulkFileResultCsv(firstGrayListFile.id);

    let completeStatus = {
      file_status: BulkFileStatus.COMPLETE,
    };
    await this.bulkFilesService.updateBulkFile(
      firstGrayListFile.id,
      completeStatus,
    );

    await this.__sendEmailNotification(user, firstGrayListFile.validation_file_path);
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


  private async __sendEmailNotification(user: User, csvSavePath: string) {
    const to = `${user.first_name} ${user.last_name} <${user.email_address}>`;
    const attachments: Attachment[] = [];
    // Get all csv files from the 'csvSavePath to send as email attachment
    const csvFiles = await this.bulkFilesService.__getAllFilesInFolder(csvSavePath);
    if (csvFiles.length) {
      csvFiles.forEach(file => {
        attachments.push({
          path: file,
        });
      });
    }
    const emailData = {
      to,
      subject: 'Email validation is complete',
      template: 'welcome',
      context: { 'name': `${user.first_name}` },
      attachments,
    };
    await this.queueService.addEmailToQueue(emailData);
  }

  private async __saveValidationResultsInCsv(results: EmailValidationResponseType[], folderName: string) {
    let invalid_email_count = 0;
    let do_not_mail_count = 0;
    let unknown_count = 0;
    let temporary_blocked = 0;
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
        email.email_status === EmailStatus.UNKNOWN
      ) {
        unknown_count++;
      } else if (email.email_status === EmailStatus.DO_NOT_MAIL) {
        do_not_mail_count++;
      } else if (
        email.email_sub_status === EmailReason.IP_BLOCKED
      ) {
        temporary_blocked++;
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
      temporary_blocked,
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
          // Add emails to GraList check
          if (
            validationResponse.email_sub_status === EmailReason.IP_BLOCKED ||
            validationResponse.email_sub_status === EmailReason.MAILBOX_NOT_FOUND
          ) {
            await this.queueService.addGraListEmailToQueue(validationResponse);
          }
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
