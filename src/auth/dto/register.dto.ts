import { IsEmail, IsString } from 'class-validator';

export class RegisterDto {
  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsString()
  @IsEmail()
  email_address: string;

  @IsString()
  password: string;
}
