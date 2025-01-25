import { Injectable } from '@nestjs/common';
import { CreateEmailRoleDto } from './dto/create-email-role.dto';
import { UpdateEmailRoleDto } from './dto/update-email-role.dto';

@Injectable()
export class EmailRolesService {
  create(createEmailRoleDto: CreateEmailRoleDto) {
    return 'This action adds a new emailRole';
  }

  findAll() {
    return `This action returns all emailRoles`;
  }

  findOne(id: number) {
    return `This action returns a #${id} emailRole`;
  }

  update(id: number, updateEmailRoleDto: UpdateEmailRoleDto) {
    return `This action updates a #${id} emailRole`;
  }

  remove(id: number) {
    return `This action removes a #${id} emailRole`;
  }
}
