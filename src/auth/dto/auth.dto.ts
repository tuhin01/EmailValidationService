import { IsEmail, IsString } from 'class-validator';

export class AuthPayloadDto {
  @IsEmail()
  @IsString()
  username: string;

  @IsString()
  password: string;
}
