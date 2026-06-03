// dto/update-company-rates.dto.ts
import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCompanyRatesDTO {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ltlAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ftlAmount?: number;
}