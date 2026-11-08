import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { GiftpackService, GiftPack, PurchaseResult } from './giftpack.service';

class PurchasePackDto {
  userId: number;
  packId: string;
}

class ClaimFreePackDto {
  userId: number;
  packId: string;
}

@Controller('economy/giftpack')
export class GiftpackController {
  constructor(private readonly giftpackService: GiftpackService) {}

  /**
   * 获取可购买的礼包列表
   * GET /economy/giftpack/list/:userId
   */
  @Get('list/:userId')
  async getAvailablePacks(@Param('userId') userId: string): Promise<GiftPack[]> {
    return this.giftpackService.getAvailablePacks(Number(userId));
  }

  /**
   * 购买礼包
   * POST /economy/giftpack/purchase
   */
  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  async purchasePack(@Body() dto: PurchasePackDto): Promise<PurchaseResult> {
    return this.giftpackService.purchasePack(dto.userId, dto.packId);
  }

  /**
   * 领取免费礼包
   * POST /economy/giftpack/claim-free
   */
  @Post('claim-free')
  @HttpCode(HttpStatus.OK)
  async claimFreePack(@Body() dto: ClaimFreePackDto): Promise<PurchaseResult> {
    return this.giftpackService.claimFreePack(dto.userId, dto.packId);
  }

  /**
   * 检查礼包是否可购买
   * GET /economy/giftpack/check/:userId/:packId
   */
  @Get('check/:userId/:packId')
  async checkPurchaseable(
    @Param('userId') userId: string,
    @Param('packId') packId: string,
  ): Promise<{ purchaseable: boolean }> {
    const purchaseable = await this.giftpackService.checkPurchaseable(Number(userId), packId);
    return { purchaseable };
  }
}
