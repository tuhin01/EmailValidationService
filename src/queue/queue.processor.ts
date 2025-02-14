import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { PROCESS_EMAIL_SEND_QUEUE, PROCESS_QUEUE, TASK_QUEUE } from '@/common/utility/constant';
import { QueueService } from '@/queue/queue.service';
import { MailerService } from '@/mailer/mailer.service';

@Processor(TASK_QUEUE)
export class QueueProcessor {
  constructor(
    private readonly queueService: QueueService,
  ) {
  }

  @Process(PROCESS_QUEUE)
  async handleQueueTask(job: Job<{ to: string; subject: string; template: string; context: any }>) {
    console.log('Processing email:', job.data);
    // return this.queueService.sendEmail(job.data);
  }

  @Process(PROCESS_EMAIL_SEND_QUEUE)
  async handleSendEmail(job: Job<{ to: string; subject: string; template: string; context: any }>) {
    console.log('Email Sending...');
    return this.queueService.processEmailQueue(job.data);
  }

}
