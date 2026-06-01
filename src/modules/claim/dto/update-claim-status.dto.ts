import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ClaimStatus } from 'src/common/enum/claims';

export class UpdateClaimStatusDto {
  @IsEnum(ClaimStatus)
  status!: ClaimStatus;

  @IsOptional()
  @IsString()
  adminNotes?: string;
}