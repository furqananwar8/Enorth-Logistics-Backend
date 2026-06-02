import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateClaimDto } from './create-claim.dto';

export class UpdateClaimDTO extends PartialType(
  OmitType(CreateClaimDto, ['status', 'shipmentId'] as const)
) {}