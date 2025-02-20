import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { JobOptions, Queue } from 'bull';
import { GREY_LIST_QUEUE, PROCESS_EMAIL_SEND_QUEUE, PROCESS_GREY_LIST_QUEUE } from '@/common/utility/constant';
import { MailerService } from '@/mailer/mailer.service';
import {
  EmailReason,
  EmailStatus,
  EmailStatusType,
  EmailValidationResponseType, SendMailOptions,
} from '@/common/utility/email-status-type';
import Bottleneck from 'bottleneck';
import { Domain, MXRecord } from '@/domains/entities/domain.entity';
import { DomainService } from '@/domains/services/domain.service';
import { RetryStatus } from '@/domains/entities/processed_email.entity';
import { WinstonLoggerService } from '@/logger/winston-logger.service';

@Injectable()
export class QueueService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly domainService: DomainService,
    private readonly winstonLoggerService: WinstonLoggerService,
    @InjectQueue(GREY_LIST_QUEUE) private readonly queue: Queue,
  ) {
  }

  // Bottleneck for rate limiting (CommonJS compatible)
  public limiter = new Bottleneck({
    maxConcurrent: 1, // Adjust based on your testing
    minTime: 300, // 200ms delay between requests (adjustable)
  });


  async addGreyListEmailToQueue(emailSmtpResponse: EmailValidationResponseType) {
    const jobOptions: JobOptions = {
      attempts: 1, // Retry 3 times if failed
      delay: 15 * 60 * 1000, // delay for 15 minutes
      removeOnComplete: true, // Automatically delete job after processing
    };
    await this.queue.add(PROCESS_GREY_LIST_QUEUE, emailSmtpResponse, jobOptions);
  }

  async addEmailToQueue(data: any) {
    const jobOptions: JobOptions = {
      attempts: 3, // Retry 3 times if failed
      delay: 0,
      removeOnComplete: true, // Automatically delete job after processing
    };
    await this.queue.add(PROCESS_EMAIL_SEND_QUEUE, data, jobOptions);
  }

  async processEmailQueue(emailData: SendMailOptions) {
    return this.mailerService.sendEmail(emailData);
  }

  async runGrayListCheck(emailQueueData: any) {
    // Bottleneck for rate limiting (CommonJS compatible)
    const limiter = this.limiter;

    const emails = [emailQueueData];
    console.log(emails);

    const validationPromises: Promise<any>[] = emails.map((emailResponse: EmailValidationResponseType) => limiter.schedule(async () => {
      console.log(`Gray Verify ${emailResponse.email_address} started`);
      const domain: Domain = await this.domainService.findOne(emailResponse.domain);
      let emailStatus: EmailStatusType;
      try {
        const allMxRecordHost: MXRecord[] = JSON.parse(domain.mx_record_hosts);
        const index = Math.floor(Math.random() * allMxRecordHost.length);
        const mxRecordHost = allMxRecordHost[index].exchange;

        emailStatus = await this.domainService.verifySmtp(emailResponse.email_address, mxRecordHost);
      } catch (e) {
        emailStatus = { ...e };
        this.winstonLoggerService.error('Gray List Error', e);
      }
      // If email status is still GREY_LISTED then mark it invalid.
      if(emailStatus.reason === EmailReason.GREY_LISTED) {
        emailStatus.status = EmailStatus.INVALID;
        emailStatus.reason = EmailReason.MAILBOX_NOT_FOUND
      } else {
        emailResponse.email_status = emailStatus.status;
        emailResponse.email_sub_status = emailStatus.reason;
      }
      emailResponse.retry = RetryStatus.COMPLETE;
      await this.domainService.updateProcessedEmailByEmail(emailResponse.email_address, emailResponse);

      return emailStatus;
    }));

    // Wait for all validations to complete
    await Promise.allSettled(validationPromises);

  }

}
