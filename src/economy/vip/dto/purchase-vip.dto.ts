import { IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurchaseVipDto {
  @ApiProperty({ description: '用户ID', example: 10001 })
  @IsInt()
  @Min(1)
  userId: number;

  @ApiProperty({ description: 'VIP等级 1-6', example: 3 })
  @IsInt()
  @Min(1)
  level: number;

  @ApiProperty({ description: '购买天数（可选，默认30天）', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;
}

export class CheckPrivilegeDto {
  @ApiProperty({ description: '用户ID', example: 10001 })
  @IsInt()
  @Min(1)
  userId: number;

  @ApiProperty({ description: '特权ID', example: 'signin_2x' })
  privilege: string;
}

export class VipLevelResponse {
  @ApiProperty({ description: 'VIP等级 0-6' })
  level: number;

  @ApiProperty({ description: 'VIP名称' })
  name: string;

  @ApiProperty({ description: '过期时间', required: false })
  expireAt: Date | null;

  @ApiProperty({ description: '特权列表' })
  privileges: string[];
}

export class VipPurchaseResultResponse {
  @ApiProperty({ description: 'VIP等级' })
  level: number;

  @ApiProperty({ description: 'VIP名称' })
  name: string;

  @ApiProperty({ description: '过期时间' })
  expireAt: Date;

  @ApiProperty({ description: '价格（分）' })
  price: number;

  @ApiProperty({ description: '购买后余额' })
  balanceAfter: number;
}

export class VipPrivilegeResponse {
  @ApiProperty({ description: '特权ID' })
  id: string;

  @ApiProperty({ description: '特权名称' })
  name: string;

  @ApiProperty({ description: '特权描述' })
  description: string;

  @ApiProperty({ description: '图标' })
  icon: string;

  @ApiProperty({ description: '适用等级' })
  levels: number[];
}
