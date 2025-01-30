import {
  Body,
  Controller,
  Post, UseGuards,
} from '@nestjs/common';
import { DomainService } from './services/domain.service';
import { SkipThrottle } from '@nestjs/throttler';
import { EmailDto } from './dto/email.dto';
import * as fs from 'node:fs';
import { parse } from 'csv-parse';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';


@Controller('email')
export class DomainsController {
  constructor(
    private readonly domainService: DomainService,
  ) {
  }


  // @Throttle({
  //   default: { limit: 5, ttl: seconds(5), blockDuration: seconds(1) },
  // })
  @SkipThrottle()
  @Post('validate')
  @UseGuards(JwtAuthGuard)
  async validate(@Body() emailDto: EmailDto) {
    const { email } = emailDto;
    return await this.domainService.smtpValidation(email);
  }


}
