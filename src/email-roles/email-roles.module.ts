import { Module } from '@nestjs/common';
import { EmailRolesService } from './email-roles.service';
import { EmailRolesController } from './email-roles.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailRole } from './entities/email-role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EmailRole])],
  controllers: [EmailRolesController],
  providers: [EmailRolesService],
  exports: [EmailRolesService],
})
export class EmailRolesModule {}
