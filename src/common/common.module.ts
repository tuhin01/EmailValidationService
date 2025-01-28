import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ConfigModule } from '@nestjs/config';
import { LoggingMiddleware } from './middleware/logging.middleware';
import { DomainsModule } from '../domains/domains.module';
import { DisposableDomainsModule } from '../disposable-domains/disposable-domains.module';
import { EmailRolesModule } from '../email-roles/email-roles.module';

@Module({
  imports: [
    ConfigModule,
    DomainsModule,
    DisposableDomainsModule,
    EmailRolesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): any {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
