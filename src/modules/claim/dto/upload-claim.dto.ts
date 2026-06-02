import { IsEnum, IsNotEmpty } from 'class-validator';
import { ClaimDocumentType } from 'src/common/enum/claims';

export class UploadClaimDocumentDTO {
  @IsEnum(ClaimDocumentType)
  @IsNotEmpty()
  documentType!: ClaimDocumentType;
}