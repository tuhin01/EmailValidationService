import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller';
import { DomainService } from './services/domain.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Domain } from './entities/domain.entity';
import { DisposableDomainsService } from '../disposable-domains/disposable-domains.service';
import { DisposableDomainsModule } from '../disposable-domains/disposable-domains.module';
import { EmailRolesModule } from '../email-roles/email-roles.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Domain]),
    DisposableDomainsModule,
    EmailRolesModule,
  ],
  controllers: [DomainsController],
  providers: [DomainService],
})
export class DomainsModule {}
