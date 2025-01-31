import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailRolesController } from './email-roles.controller';
import { EmailRolesService } from './email-roles.service';
import { EmailRole } from './entities/email-role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EmailRole])],
  controllers: [EmailRolesController],
  providers: [EmailRolesService],
  exports: [EmailRolesService],
})
export class EmailRolesModule {}
