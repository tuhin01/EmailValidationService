import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller';
import { DomainService } from './services/domain.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Domain } from './entities/domain.entity';
import { DisposableDomainsModule } from '../disposable-domains/disposable-domains.module';
import { EmailRolesModule } from '../email-roles/email-roles.module';
import { ErrorDomain } from './entities/error_domain.entity';
import { ProcessedEmail } from './entities/processed_email.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Domain, ErrorDomain, ProcessedEmail]),
    DisposableDomainsModule,
    EmailRolesModule,
  ],
  controllers: [DomainsController],
  providers: [DomainService],
  exports: [DomainService],
})
export class DomainsModule {}
