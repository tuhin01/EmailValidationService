import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { EmailRolesService } from './email-roles.service';
import { CreateEmailRoleDto } from './dto/create-email-role.dto';
import { UpdateEmailRoleDto } from './dto/update-email-role.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { DisposableDomain } from '../disposable-domains/entities/disposable-domain.entity';

@Controller('email-roles')
export class EmailRolesController {
  constructor(private readonly emailRolesService: EmailRolesService) {}

  @SkipThrottle()
  @Post('')
  async createMany(@Body() createEmailRoleDtos: CreateEmailRoleDto[]) {
    return await this.emailRolesService.createMany(createEmailRoleDtos);
  }

  @Get(':role')
  findOne(@Param('role') role: string) {
    return this.emailRolesService.findOne(role);
  }
}
