import { PartialType } from '@nestjs/mapped-types';

import { CreateEmailRoleDto } from './create-email-role.dto';

export class UpdateEmailRoleDto extends PartialType(CreateEmailRoleDto) {}
