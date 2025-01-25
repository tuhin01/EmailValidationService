import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { EmailRolesService } from './email-roles.service';
import { CreateEmailRoleDto } from './dto/create-email-role.dto';
import { UpdateEmailRoleDto } from './dto/update-email-role.dto';

@Controller('email-roles')
export class EmailRolesController {
  constructor(private readonly emailRolesService: EmailRolesService) {}

  @Post()
  create(@Body() createEmailRoleDto: CreateEmailRoleDto) {
    return this.emailRolesService.create(createEmailRoleDto);
  }

  @Get()
  findAll() {
    return this.emailRolesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.emailRolesService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateEmailRoleDto: UpdateEmailRoleDto) {
    return this.emailRolesService.update(+id, updateEmailRoleDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.emailRolesService.remove(+id);
  }
}
