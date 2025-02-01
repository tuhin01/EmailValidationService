import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { MailerService } from './mailer.service';

@Processor('emailQueue')
export class MailProcessor {
  constructor(private readonly mailerService: MailerService) {
  }

  @Process('sendEmail')
  async handleSendEmail(job: Job<{ to: string; subject: string; template: string; context: any }>) {
    console.log('Processing email:', job.data);
    return this.mailerService.sendEmail(job.data);
  }
}
