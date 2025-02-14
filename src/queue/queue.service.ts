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

  async addTaskToQueue(data: any, jobOption: JobOptions) {
    await this.queue.add(PROCESS_QUEUE, data, jobOption);
  }

  async addEmailToQueue(data: any, jobOption: JobOptions) {
    await this.queue.add(PROCESS_EMAIL_SEND_QUEUE, data, jobOption);
  }

  async processEmailQueue(emailData) {
    return this.mailerService.sendEmail(emailData);
  }
}
