import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Domain } from '../domains/entities/domain.entity';
import { DisposableDomainsService } from './disposable-domains.service';
import { CreateDisposableDomainDto } from './dto/create-disposable-domain.dto';
import { UpdateDisposableDomainDto } from './dto/update-disposable-domain.dto';
import { DisposableDomain } from './entities/disposable-domain.entity';

@Controller('disposable-domains')
export class DisposableDomainsController {
  constructor(
    private readonly disposableDomainsService: DisposableDomainsService,
  ) {}

  @SkipThrottle()
  @Post('/create-many')
  async createMany(@Body() disposableDomains: DisposableDomain[]) {
    return await this.disposableDomainsService.createMany(disposableDomains);
  }

  @Get(':domain')
  findOne(@Param('domain') domain: string) {
    return this.disposableDomainsService.findByDomain(domain);
  }
}
