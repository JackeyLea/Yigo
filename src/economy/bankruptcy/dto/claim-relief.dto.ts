import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClaimReliefDto {
  @ApiProperty({ description: '用户ID', example: 10001 })
  @IsInt()
  @Min(1)
  userId: number;
}

export class ReliefStatusResponse {
  @ApiProperty({ description: '是否可以领取' })
  canClaim: boolean;

  @ApiProperty({ description: '不能领取的原因', required: false })
  reason?: string;

  @ApiProperty({ description: '今日已领取次数' })
  claimCount: number;

  @ApiProperty({ description: '每日最大次数' })
  maxClaims: number;

  @ApiProperty({ description: '下次可领取时间', required: false })
  nextClaimTime?: Date;

  @ApiProperty({ description: '每日重置时间' })
  nextResetTime: Date;
}

export class ReliefResultResponse {
  @ApiProperty({ description: '补助金额' })
  amount: number;

  @ApiProperty({ description: '今日累计领取次数' })
  totalClaims: number;

  @ApiProperty({ description: '剩余次数' })
  remainingClaims: number;

  @ApiProperty({ description: '领取后余额' })
  balanceAfter: number;
}
