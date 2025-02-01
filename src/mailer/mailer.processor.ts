import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { MailerService } from './mailer.service';
import { BULK_EMAIL_QUEUE, BULK_EMAIL_SEND } from '@/common/utility/constant';

@Processor(BULK_EMAIL_QUEUE)
export class MailProcessor {
  constructor(private readonly mailerService: MailerService) {
  }

  @Process(BULK_EMAIL_SEND)
  async handleSendEmail(job: Job<{ to: string; subject: string; template: string; context: any }>) {
    console.log('Processing email:', job.data);
    return this.mailerService.sendEmail(job.data);
  }
}
