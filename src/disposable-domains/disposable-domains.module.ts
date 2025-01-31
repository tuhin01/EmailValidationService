import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DisposableDomainsController } from './disposable-domains.controller';
import { DisposableDomainsService } from './disposable-domains.service';
import { DisposableDomain } from './entities/disposable-domain.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DisposableDomain])],
  controllers: [DisposableDomainsController],
  providers: [DisposableDomainsService],
  exports: [DisposableDomainsService],
})
export class DisposableDomainsModule {}
