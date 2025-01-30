import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {
  }

  @SkipThrottle()
  @Post('login')
  async validate(@Body() payload: any) {
    return await this.authService.login();
  }
}
