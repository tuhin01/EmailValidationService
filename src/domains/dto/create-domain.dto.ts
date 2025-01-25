import { IsArray, IsBoolean, IsJSON, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDomainDto {
  @IsString()
  domain: string;

  @IsString()
  @IsOptional()
  readonly domain_ip: string;

  @IsNumber()
  readonly domain_age_days: number;

  @IsJSON()
  readonly domain_error: {};

  @IsString()
  readonly mx_record_host: string;
}
