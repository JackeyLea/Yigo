import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { VipService, VipLevel, VipPurchaseResult, VipPrivilege } from './vip.service';

class PurchaseVipDto {
  userId: number;
  level: number;
  durationDays?: number;
}

class CheckPrivilegeDto {
  userId: number;
  privilege: string;
}

@Controller('economy/vip')
export class VipController {
  constructor(private readonly vipService: VipService) {}

  /**
   * 查询VIP等级
   * GET /economy/vip/level/:userId
   */
  @Get('level/:userId')
  async getVipLevel(@Param('userId') userId: string): Promise<VipLevel> {
    return this.vipService.getVipLevel(Number(userId));
  }

  /**
   * 购买VIP
   * POST /economy/vip/purchase
   */
  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  async purchaseVip(@Body() dto: PurchaseVipDto): Promise<VipPurchaseResult> {
    return this.vipService.purchaseVip(dto.userId, dto.level, dto.durationDays);
  }

  /**
   * 检查VIP特权
   * POST /economy/vip/check-privilege
   */
  @Post('check-privilege')
  @HttpCode(HttpStatus.OK)
  async checkPrivilege(@Body() dto: CheckPrivilegeDto): Promise<{ hasPrivilege: boolean }> {
    const hasPrivilege = await this.vipService.checkPrivilege(dto.userId, dto.privilege);
    return { hasPrivilege };
  }

  /**
   * 获取所有VIP特权说明
   * GET /economy/vip/privileges
   */
  @Get('privileges')
  getVipPrivileges(): VipPrivilege[] {
    return this.vipService.getVipPrivileges();
  }
}
