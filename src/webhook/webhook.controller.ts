import { Body, Controller, Post, Req } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { Public } from '@/common/decorators/public.decorator';
import { SnsNotificationDto } from '@/webhook/dto/sns-notification.dto';
import { validate } from 'class-validator';
import { WinstonLoggerService } from '@/logger/winston-logger.service';

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly winstonLoggerService: WinstonLoggerService,
  ) {
  }

  @Post('sns-delivery-status')
  @Public()
  async receiveEmailDeliveryStatus(
    @Req() req: any,
    @Body() body: any
  ) {
    const headers = req.headers;
    const messageType = headers['x-amz-sns-message-type'];
    if(messageType === 'SubscriptionConfirmation') {
      return { status: 'Subscription Confirmed' };
    }

    // Validate the incoming payload
    const notification = new SnsNotificationDto();
    Object.assign(notification, body);

    const errors = await validate(notification);
    if (errors.length > 0) {
      // Log error in error log to debug
      const logData = {
        errors,
        payload: body,
      };
      this.winstonLoggerService.error('SNS-Delivery-Error', logData.toString());
      return;
    }

    return await this.webhookService.handleSnsNotification(notification);

  }
}
