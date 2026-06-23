import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AntiAddictionService, PlayTimeStatus } from './anti-addiction.service';
import { RealNameVerification } from './anti-addiction.entity';

class VerifyRealNameDto {
  realName: string;
  idCard: string;
}

class RecordPlayTimeDto {
  duration: number;
}

@Controller('anti-addiction')
export class AntiAddictionController {
  constructor(
    private readonly antiAddictionService: AntiAddictionService,
  ) {}

  /**
   * 检查游戏时长状态
   */
  @Get('status/:userId')
  async checkPlayTime(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PlayTimeStatus> {
    return this.antiAddictionService.checkPlayTime(userId);
  }

  /**
   * 记录游戏时长
   */
  @Post('record/:userId')
  @HttpCode(HttpStatus.OK)
  async recordPlayTime(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: RecordPlayTimeDto,
  ): Promise<void> {
    return this.antiAddictionService.recordPlayTime(userId, dto.duration);
  }

  /**
   * 获取当日游戏时长
   */
  @Get('daily/:userId')
  async getDailyPlayTime(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ minutes: number }> {
    const minutes = await this.antiAddictionService.getDailyPlayTime(userId);
    return { minutes };
  }

  /**
   * 是否受限
   */
  @Get('restricted/:userId')
  async isRestricted(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ restricted: boolean }> {
    const restricted = await this.antiAddictionService.isRestricted(userId);
    return { restricted };
  }

  /**
   * 当前是否可以游戏
   */
  @Get('can-play/:userId')
  async canPlayNow(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    return this.antiAddictionService.canPlayNow(userId);
  }

  /**
   * 实名认证
   */
  @Post('verify/:userId')
  async verifyRealName(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: VerifyRealNameDto,
  ): Promise<RealNameVerification> {
    return this.antiAddictionService.verifyRealName(
      userId,
      dto.realName,
      dto.idCard,
    );
  }

  /**
   * 获取实名信息
   */
  @Get('verification/:userId')
  async getVerification(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<RealNameVerification | null> {
    return this.antiAddictionService.getVerification(userId);
  }

  /**
   * 开始游戏会话
   */
  @Post('session/start/:userId')
  @HttpCode(HttpStatus.OK)
  async startSession(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<void> {
    return this.antiAddictionService.startSession(userId);
  }

  /**
   * 结束游戏会话
   */
  @Post('session/end/:userId')
  @HttpCode(HttpStatus.OK)
  async endSession(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<void> {
    return this.antiAddictionService.endSession(userId);
  }
}
