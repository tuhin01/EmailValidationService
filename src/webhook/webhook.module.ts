import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { WinstonLoggerModule } from '@/logger/winston-logger.module';

@Module({
  imports: [WinstonLoggerModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
