import { IsInt, Min, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurchasePackDto {
  @ApiProperty({ description: '用户ID', example: 10001 })
  @IsInt()
  @Min(1)
  userId: number;

  @ApiProperty({ description: '礼包ID', example: 'daily_pack' })
  @IsString()
  packId: string;
}

export class ClaimFreePackDto {
  @ApiProperty({ description: '用户ID', example: 10001 })
  @IsInt()
  @Min(1)
  userId: number;

  @ApiProperty({ description: '礼包ID', example: 'newbie_pack' })
  @IsString()
  packId: string;
}

export class PackContentResponse {
  @ApiProperty({ description: '内容类型' })
  type: 'coins' | 'item' | 'vip_day';

  @ApiProperty({ description: '道具ID', required: false })
  itemId?: string;

  @ApiProperty({ description: '数量' })
  quantity: number;
}

export class GiftPackResponse {
  @ApiProperty({ description: '礼包ID' })
  id: string;

  @ApiProperty({ description: '礼包名称' })
  name: string;

  @ApiProperty({ description: '礼包描述' })
  description: string;

  @ApiProperty({ description: '礼包类型' })
  type: 'daily' | 'weekly' | 'newbie' | 'limited' | 'event';

  @ApiProperty({ description: '价格（人民币分）' })
  price: number;

  @ApiProperty({ description: '原价' })
  originalPrice: number;

  @ApiProperty({ description: '礼包内容' })
  contents: PackContentResponse[];

  @ApiProperty({ description: '每人限购次数', required: false })
  limitPerUser?: number;

  @ApiProperty({ description: '开始时间', required: false })
  availableFrom?: Date;

  @ApiProperty({ description: '结束时间', required: false })
  availableUntil?: Date;

  @ApiProperty({ description: '横幅图片' })
  bannerImage: string;
}

export class PurchaseResultResponse {
  @ApiProperty({ description: '礼包ID' })
  packId: string;

  @ApiProperty({ description: '礼包名称' })
  packName: string;

  @ApiProperty({ description: '价格' })
  price: number;

  @ApiProperty({ description: '礼包内容' })
  contents: PackContentResponse[];

  @ApiProperty({ description: '购买后余额' })
  balanceAfter: number;

  @ApiProperty({ description: '是否免费' })
  isFree: boolean;

  @ApiProperty({ description: '购买次数' })
  purchaseCount: number;
}
