import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateClaimCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;
}