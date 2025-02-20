import { Injectable } from '@nestjs/common';
import { SnsNotificationDto } from '@/webhook/dto/sns-notification.dto';

@Injectable()
export class WebhookService {
  public async handleSnsNotification(notification: SnsNotificationDto) {
    switch (notification.eventType) {
      case 'Send':
        console.log('Email messageId:', notification.mail.messageId);
        return notification.mail.messageId;
      case 'Delivery':
        console.log('Email messageId:', notification.mail.messageId);
        console.log('Email delivered:', notification.delivery);
        return notification.delivery;
      case 'Bounce':
        console.log('Email bounced:', notification.bounce);
        break;
      case 'Complaint':
        console.log('Email complaint:', notification.complaint);
        break;
      default:
        console.log('Unknown event type:', notification.eventType);
    }

    return { status: 'Notification Processed' };
  }
}
