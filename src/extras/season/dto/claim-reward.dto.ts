import { IsInt, IsNotEmpty } from 'class-validator';

export class ClaimRewardDto {
  @IsInt()
  @IsNotEmpty()
  rewardId: number;
}
