import { MailerService } from './mailer.service';

// @Processor(BULK_EMAIL_QUEUE)
export class MailProcessor {
  constructor() {
  }

  // @Process(PROCESS_EMAIL_SEND_QUEUE)
  // async handleSendEmail(job: Job<{ to: string; subject: string; template: string; context: any }>) {
  //   console.log('Processing email:', job.data);
  //   return this.mailerService.sendEmail(job.data);
  // }
}
