import * as fs from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { parse } from 'csv-parse';

import { BulkFilesService } from '@/bulk-files/bulk-files.service';
import { UpdateBulkFileDto } from '@/bulk-files/dto/update-bulk-file.dto';
import { BulkFile, BulkFileStatus } from '@/bulk-files/entities/bulk-file.entity';
import {
  EmailReason,
  EmailStatus,
  EmailValidationResponseType,
  SendMailOptions,
} from '@/common/utility/email-status-type';
import { DomainService } from '@/domains/services/domain.service';
import { WinstonLoggerService } from '@/logger/winston-logger.service';
import Bottleneck from 'bottleneck';
import { UsersService } from '@/users/users.service';
import { User } from '@/users/entities/user.entity';
import * as process from 'node:process';
import * as path from 'path';
import { ProcessedEmail } from '@/domains/entities/processed_email.entity';
import { QueueService } from '@/queue/queue.service';
import { Attachment } from 'nodemailer/lib/mailer';

@Injectable()
export class SchedulerService {

  constructor(
    private bulkFilesService: BulkFilesService,
    private domainService: DomainService,
    private userService: UsersService,
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
        grey_listed,
        catch_all_count,
        do_not_mail_count,
        spam_trap_count,
      } = await this.__saveValidationResultsInCsv(results, folderName);
      const bulkFileUpdateData: UpdateBulkFileDto = {
        file_status: grey_listed > 0 ? BulkFileStatus.GREY_LIST_CHECK : BulkFileStatus.COMPLETE,
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
        await this.__sendEmailNotification(user, firstPendingFile.id);
      }

      console.log('File Status updated to - COMPLETE');

    } catch (e) {
      this.winstonLoggerService.error('Bulk File Error', e.trace);
      console.log(e);
    }
  }

  @Cron('1 * * * * *') // Runs every minutes
  public async runGreyListEmailValidation() {
    const greyListFile = await this.bulkFilesService.getGreyListCheckBulkFile();
    console.log({ grayListFile: greyListFile });
    if (!greyListFile.length) {
      return;
    }
    const firstGreyListFile: BulkFile = greyListFile[0];
    const user: User = await this.userService.findOneById(firstGreyListFile.user_id);
    if (!user) {
      this.winstonLoggerService.error('runGrayListEmailValidation()', `No user found for user_id: ${firstGreyListFile.user_id}`);

      return;
    }

    const processedEmails: ProcessedEmail[] = await this.domainService.getGreyListedProcessedEmail(firstGreyListFile.id);
    if (processedEmails.length) {
      return;
    }
    console.log('GreyList is in progress...');
    // Generate all csv and update DB with updated counts.
    await this.generateBulkFileResultCsv(firstGreyListFile.id);

    let completeStatus = {
      file_status: BulkFileStatus.COMPLETE,
    };
    await this.bulkFilesService.updateBulkFile(
      firstGreyListFile.id,
      completeStatus,
    );

    await this.__sendEmailNotification(user, firstGreyListFile.id);
  }

  public async generateBulkFileResultCsv(fileId: number) {
    const bulkFile: BulkFile = await this.bulkFilesService.getBulkFile(fileId);
    const results = await this.__readSCsvAndMergeValidationResults(bulkFile.file_path);
    const folderName: string = bulkFile.file_path.split('/').at(-1).replace('.csv', '');
    const {
      valid_email_count,
      invalid_email_count,
      unknown_count,
      grey_listed,
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


  private async __sendEmailNotification(user: User, bulkFileId: number) {
    const bulkFile: BulkFile = await this.bulkFilesService.getBulkFile(bulkFileId);
    const to = `${user.first_name} ${user.last_name} <${user.email_address}>`;
    const attachments: Attachment[] = [];
    // Get all csv files from the 'csvSavePath to send as email attachment
    const csvFiles = await this.bulkFilesService.__getAllFilesInFolder(bulkFile.validation_file_path);
    if (csvFiles.length) {
      csvFiles.forEach(file => {
        attachments.push({
          path: file,
        });
      });
    }
    const emailDynamicData = {
      user,
      bulkFile,
      downloadLink: 'https://leadwrap.com/downlaod/',
      unsubscribeLink: 'https://leadwrap.com/unsubscribe/',
    };
    const emailData: SendMailOptions = {
      to,
      subject: 'LearWrap Email Verification is Complete',
      template: 'email_verification_complete',
      context: emailDynamicData,
      attachments,
    };
    await this.queueService.addEmailToQueue(emailData);
  }

  private async __saveValidationResultsInCsv(results: EmailValidationResponseType[], folderName: string) {
    let invalid_email_count = 0;
    let do_not_mail_count = 0;
    let unknown_count = 0;
    let grey_listed = 0;
    const fileWithStatusTypes = {
      [EmailReason.ROLE_BASED]: [],
      [EmailReason.UNVERIFIABLE_EMAIL]: [],
      [EmailReason.DISPOSABLE_DOMAIN]: [],
      [EmailReason.MAILBOX_NOT_FOUND]: [],
      [EmailReason.DOMAIN_NOT_FOUND]: [],
      [EmailReason.SMTP_TIMEOUT]: [],
      [EmailReason.DOES_NOT_ACCEPT_MAIL]: [],
      [EmailReason.IP_BLOCKED]: [],
      [EmailReason.GREY_LISTED]: [],
      [EmailStatus.CATCH_ALL]: [],
      [EmailStatus.SPAMTRAP]: [],
      [EmailStatus.VALID]: [],
    };

    results.forEach((email: EmailValidationResponseType) => {
      if (email.email_status === EmailStatus.VALID) {
        fileWithStatusTypes[EmailStatus.VALID].push(email);
      } else if (email.email_status === EmailStatus.CATCH_ALL) {
        fileWithStatusTypes[EmailStatus.CATCH_ALL].push(email);
      } else if (email.email_sub_status === EmailReason.GREY_LISTED) {
        fileWithStatusTypes[EmailReason.GREY_LISTED].push(email);
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
        // Count 'IP_BLOCKED', 'UNVERIFIABLE_EMAIL' & 'SMTP_TIMEOUT' as unknown to report to user properly.
        (email.email_status === EmailStatus.UNKNOWN && email.email_sub_status === EmailReason.UNVERIFIABLE_EMAIL) ||
        (email.email_status === EmailStatus.UNKNOWN && email.email_sub_status === EmailReason.SMTP_TIMEOUT) ||
        (email.email_status === EmailStatus.SERVICE_UNAVAILABLE && email.email_sub_status === EmailReason.IP_BLOCKED)
      ) {
        unknown_count++;
      } else if (email.email_status === EmailStatus.DO_NOT_MAIL) {
        do_not_mail_count++;
      } else if (
        email.email_status === EmailStatus.UNKNOWN && email.email_sub_status === EmailReason.GREY_LISTED
      ) {
        grey_listed++;
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
    console.log({ grey_listed });
    return {
      valid_email_count: fileWithStatusTypes[EmailStatus.VALID].length,
      invalid_email_count,
      unknown_count,
      grey_listed,
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

      const results = [];
      for (const record of records) {
        console.log(`Validation started: ${record.Email}`);
        const validationResponse: EmailValidationResponseType = await this.domainService.smtpValidation(
          record.Email,
          user,
          bulkFile.id,
        );
        // console.log(`Validation done: ${validationResponse.email_address}`);
        // Add emails to GreyList check
        if (
          validationResponse.email_sub_status === EmailReason.GREY_LISTED
        ) {
          await this.queueService.addGreyListEmailToQueue(validationResponse);
        }
        const res = {
          ...record,
          ...validationResponse,
        };
        results.push(res);
      }
      return results;


      // Validate emails in parallel
      // const validationPromises: Promise<any>[] = records.map((record) => limiter.schedule(async () => {
      //     console.log(`Validation started: ${record.Email}`);
      //     const validationResponse: EmailValidationResponseType = await this.domainService.smtpValidation(
      //       record.Email,
      //       user,
      //       bulkFile.id,
      //     );
      //
      //     // Add emails to GreyList check
      //     if (validationResponse.email_sub_status === EmailReason.GREY_LISTED) {
      //       await this.queueService.addGreyListEmailToQueue(validationResponse);
      //     }
      //     console.log(`Complete ${validationResponse.email_address}`);
      //     return {
      //       ...record,
      //       ...validationResponse,
      //     };
      //   }),
      // );
      // Wait for all validations to complete
      // const results = await Promise.allSettled(validationPromises);
      // return results
      //   .filter(result => result.status === 'fulfilled')
      //   .map(result => (result as PromiseFulfilledResult<any>).value);
    } catch (err) {
      console.error('Error during bulk validation:', err);
      throw err;
    }
  }

  private async __readSCsvAndMergeValidationResults(csvPath: string) {
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
        const processedEmail: ProcessedEmail = await this.domainService.getProcessedEmail(record.Email);
        if (!processedEmail) {
          continue;
        }
        // Delete these property so these are not included in the final response.
        delete processedEmail.id;
        delete processedEmail.user_id;
        delete processedEmail.bulk_file_id;
        delete processedEmail.created_at;
        delete processedEmail.retry;
        record = Object.assign(record, processedEmail); // Merges source into target (modifies target)
      }

      return records;
    } catch (err) {
      console.error('Error during bulk validation:', err);
      throw err;
    }
  }

}
