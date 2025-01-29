import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateBulkFileDto {
  @IsString()
  @IsNotEmpty()
  readonly file_path: string;

  @IsNumber()
  @IsNotEmpty()
  total_email_count: number

}
