import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { LotteryService, WheelConfig, SpinResult } from './lottery.service';

class SpinDto {
  userId: number;
}

class SpinWithCoinsDto {
  userId: number;
  cost?: number;
}

@Controller('economy/lottery')
export class LotteryController {
  constructor(private readonly lotteryService: LotteryService) {}

  /**
   * 获取转盘配置
   * GET /economy/lottery/config
   */
  @Get('config')
  async getWheelConfig(): Promise<WheelConfig> {
    return this.lotteryService.getWheelConfig();
  }

  /**
   * 抽奖（自动使用免费次数或金币）
   * POST /economy/lottery/spin
   */
  @Post('spin')
  @HttpCode(HttpStatus.OK)
  async spin(@Body() dto: SpinDto): Promise<SpinResult> {
    return this.lotteryService.spin(dto.userId);
  }

  /**
   * 使用金币抽奖
   * POST /economy/lottery/spin-coins
   */
  @Post('spin-coins')
  @HttpCode(HttpStatus.OK)
  async spinWithCoins(@Body() dto: SpinWithCoinsDto): Promise<SpinResult> {
    return this.lotteryService.spinWithCoins(dto.userId, dto.cost);
  }

  /**
   * 获取今日剩余免费次数
   * GET /economy/lottery/free-spins/:userId
   */
  @Get('free-spins/:userId')
  async getFreeSpins(@Param('userId') userId: string): Promise<{ remaining: number }> {
    const remaining = await this.lotteryService.getFreeSpins(Number(userId));
    return { remaining };
  }
}
