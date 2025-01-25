import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateEmailRoleDto } from './dto/create-email-role.dto';
import { UpdateEmailRoleDto } from './dto/update-email-role.dto';
import { Domain } from '../domains/entities/domain.entity';
import { EmailRole } from './entities/email-role.entity';
import { DisposableDomain } from '../disposable-domains/entities/disposable-domain.entity';
import { DataSource } from 'typeorm';

@Injectable()
export class EmailRolesService {
  constructor(private dataSource: DataSource) {
  }


  async createMany(createEmailRoleDtos: CreateEmailRoleDto[]) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.save(EmailRole, createEmailRoleDtos);
      await queryRunner.commitTransaction();
    } catch (err) {
      // since we have errors lets rollback the changes we made
      await queryRunner.rollbackTransaction();
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    } finally {
      // you need to release a queryRunner which was manually instantiated
      await queryRunner.release();
    }
  }


  async findOne(role: string) {
    const existingRole = await EmailRole.findOneBy({ role });

    return existingRole;
  }

}
