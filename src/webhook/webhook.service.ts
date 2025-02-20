import { Injectable } from '@nestjs/common';
import { SnsNotificationDto } from '@/webhook/dto/sns-notification.dto';
import { DomainService } from '@/domains/services/domain.service';
import {
  EmailReason,
  EmailStatus,
  EmailStatusType,
  EmailValidationResponseType,
} from '@/common/utility/email-status-type';
import { RetryStatus } from '@/domains/entities/processed_email.entity';

@Injectable()
export class WebhookService {
  constructor(
    private domainService: DomainService,
  ) {
  }

  public async handleSnsNotification(notification: SnsNotificationDto) {
    let email: string = '';
    let emailStatus: EmailValidationResponseType;
    switch (notification.eventType) {
      case 'Send':
        break;
      case 'Delivery':
        email = notification.delivery.recipients[0];
        const verifyPlusResponse: EmailStatusType = this.domainService.parseEmailResponseData(notification.delivery.smtpResponse, email);
        emailStatus = {
          email_address: email,
          verify_plus: true,
          email_status: verifyPlusResponse.status,
          email_sub_status: verifyPlusResponse.reason,
          retry: RetryStatus.COMPLETE,
        };
        await this.domainService.updateProcessedEmailByEmail(email, emailStatus);

        return notification.delivery;
      case 'Bounce':
        email = notification.bounce.bouncedRecipients[0].emailAddress;
        emailStatus = {
          email_address: email,
          verify_plus: true,
          email_status: EmailStatus.INVALID,
          email_sub_status: EmailReason.MAILBOX_NOT_FOUND,
          retry: RetryStatus.COMPLETE,
        };
        await this.domainService.updateProcessedEmailByEmail(email, emailStatus);

        break;
      case 'Complaint':
        break;

    }

    return { status: 'Notification Processed' };
  }
}
