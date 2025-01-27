import { IsString } from 'class-validator';

export class CsvUploadDto {
  @IsString({ message: `File is required!` })
  file: string;


}
