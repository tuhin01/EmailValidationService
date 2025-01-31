import {
  Body,
  Controller,
  Post, UseGuards,
} from '@nestjs/common';
import { DomainService } from './services/domain.service';
import { hours, minutes, seconds, SkipThrottle, Throttle } from '@nestjs/throttler';
import { EmailDto } from './dto/email.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';


@Controller('email')
export class DomainsController {
  constructor(
    private readonly domainService: DomainService,
  ) {
  }


  @Throttle({
    default: { limit: 50000, ttl: minutes(1), blockDuration: minutes(1) },
  })
  @Post('validate')
  @UseGuards(JwtAuthGuard)
  async validate(@Body() emailDto: EmailDto) {
    const { email } = emailDto;
    return await this.domainService.smtpValidation(email);
  }


}
