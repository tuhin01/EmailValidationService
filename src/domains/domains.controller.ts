import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { minutes, Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '@/auth/guards/jwt.guard';
import { EmailDto } from '@/domains/dto/email.dto';
import { DomainService } from '@/domains/services/domain.service';

@Controller('email')
export class DomainsController {
  constructor(private readonly domainService: DomainService) {}

  @Throttle({
    default: { limit: 50000, ttl: minutes(1), blockDuration: minutes(1) },
  })
  @Post('validate')
  @UseGuards(JwtAuthGuard)
  async validate(@Req() req: any, @Body() emailDto: EmailDto) {
    const { email } = emailDto;
    const user = req.user;
    return await this.domainService.smtpValidation(email, user);
  }
}
