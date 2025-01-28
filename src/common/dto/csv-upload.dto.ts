import { IsEmail, IsString } from 'class-validator';

export class CsvUploadDto {
  @IsString({ message: `Email is required!` })
  email: string;


}
