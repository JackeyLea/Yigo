import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { BankruptcyService, ReliefStatus, ReliefResult } from './bankruptcy.service';

class ClaimReliefDto {
  userId: number;
}

@Controller('economy/bankruptcy')
export class BankruptcyController {
  constructor(private readonly bankruptcyService: BankruptcyService) {}

  /**
   * 查询破产补助状态
   * GET /economy/bankruptcy/status/:userId
   */
  @Get('status/:userId')
  async getStatus(@Param('userId') userId: string): Promise<ReliefStatus> {
    return this.bankruptcyService.canClaimRelief(Number(userId));
  }

  /**
   * 领取破产补助
   * POST /economy/bankruptcy/claim
   */
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  async claimRelief(@Body() dto: ClaimReliefDto): Promise<ReliefResult> {
    return this.bankruptcyService.claimRelief(dto.userId);
  }

  /**
   * 获取今日已领取次数
   * GET /economy/bankruptcy/claims/:userId
   */
  @Get('claims/:userId')
  async getTodayClaims(@Param('userId') userId: string): Promise<{ count: number }> {
    const count = await this.bankruptcyService.getTodayClaimCount(Number(userId));
    return { count };
  }
}
