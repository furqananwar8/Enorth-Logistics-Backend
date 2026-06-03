// dto/account-review.dto.ts
import { IsEnum } from 'class-validator';
import { AccountReviewAction } from 'src/common/constants/user';

export class AccountReviewDto {
  @IsEnum(AccountReviewAction)
  action!: AccountReviewAction
}