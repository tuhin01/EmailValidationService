import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BulkFilesModule } from './bulk-files/bulk-files.module';
import { CommonModule } from './common/common.module';
import { ThrottlerConfigService } from './common/config/throttler.config';
import { SchedulerModule } from './scheduler/scheduler.module';
import { UsersModule } from './users/users.module';
import { MailerService } from './mailer/mailer.service';
import { MailerModule } from './mailer/mailer.module';
import { WinstonLoggerService } from './logger/winston-logger.service';
import { WinstonLoggerModule } from '@/logger/winston-logger.module';
import { GlobalExceptionFilter } from '@/common/exception-filter/global-exception.filter';
import { TimeService } from './time/time.service';
import { TimeModule } from './time/time.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useClass: ThrottlerConfigService,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT, 5432),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      autoLoadEntities: true,
      synchronize: true,
    }),
    CommonModule,
    SchedulerModule,
    BulkFilesModule,
    AuthModule,
    UsersModule,
    MailerModule,
    WinstonLoggerModule,
    TimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    MailerService,
    WinstonLoggerService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    TimeService,
  ],
})
export class AppModule {
}
