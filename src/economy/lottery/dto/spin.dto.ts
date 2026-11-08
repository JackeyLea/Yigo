import { IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SpinDto {
  @ApiProperty({ description: '用户ID', example: 10001 })
  @IsInt()
  @Min(1)
  userId: number;
}

export class SpinWithCoinsDto {
  @ApiProperty({ description: '用户ID', example: 10001 })
  @IsInt()
  @Min(1)
  userId: number;

  @ApiProperty({ description: '消耗金币数（可选，默认100）', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  cost?: number;
}

export class WheelPrizeResponse {
  @ApiProperty({ description: '奖品ID' })
  id: string;

  @ApiProperty({ description: '奖品名称' })
  name: string;

  @ApiProperty({ description: '奖品类型' })
  type: 'coins' | 'item' | 'vip_day' | 'avatar_frame' | 'title';

  @ApiProperty({ description: '奖品数值' })
  value: number;

  @ApiProperty({ description: '权重' })
  weight: number;

  @ApiProperty({ description: '图标' })
  icon: string;
}

export class SpinResultResponse {
  @ApiProperty({ description: '抽中的奖品' })
  prize: WheelPrizeResponse;

  @ApiProperty({ description: '是否中大奖' })
  isJackpot: boolean;

  @ApiProperty({ description: '抽奖后余额' })
  balanceAfter: number;

  @ApiProperty({ description: '累计抽奖次数' })
  spinCount: number;

  @ApiProperty({ description: '是否免费抽奖' })
  isFreeSpin: boolean;
}

export class FreeSpinsResponse {
  @ApiProperty({ description: '剩余免费次数' })
  remaining: number;
}
