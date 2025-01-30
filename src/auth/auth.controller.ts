import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { EmailDto } from '../domains/dto/email.dto';

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
