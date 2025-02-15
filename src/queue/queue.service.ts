import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { JobOptions, Queue } from 'bull';
import { PROCESS_EMAIL_SEND_QUEUE, PROCESS_QUEUE, TASK_QUEUE } from '@/common/utility/constant';
import { MailerService } from '@/mailer/mailer.service';

@Injectable()
export class QueueService {
  constructor(
    private readonly mailerService: MailerService,
    @InjectQueue(TASK_QUEUE) private readonly queue: Queue
  ) {
  }

  async addTaskToQueue(data: any) {
    const jobOptions: JobOptions = {
      attempts: 1, // Retry 3 times if failed
      delay: 30 * 1000, // delay for 30 minutes
    };
    await this.queue.add(PROCESS_QUEUE, data, jobOptions);
  }

  async addEmailToQueue(data: any) {
    const jobOptions: JobOptions = {
      attempts: 3, // Retry 3 times if failed
      delay: 0,
    };
    await this.queue.add(PROCESS_EMAIL_SEND_QUEUE, data, jobOptions);
  }

  async processEmailQueue(emailData) {
    return this.mailerService.sendEmail(emailData);
  }
}
