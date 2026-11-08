/**
 * AchievementController - 成就系统控制器
 *
 * 提供成就查询、进度追踪、奖励领取等API端点。
 * 所有响应通过全局TransformInterceptor统一包装为ApiResponse格式。
 *
 * @baseUrl /api/v1/achievements
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Req,
  Body,
} from '@nestjs/common';

import { AchievementService } from './achievement.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  Reward,
  AchievementProgress,
  UnlockedAchievement,
  GameEvent,
} from './interfaces';
import { Achievement } from '../common/entities/achievement.entity';
import { UserAchievement } from '../common/entities/user-achievement.entity';

/**
 * 用户请求对象接口
 */
interface RequestWithUser {
  user?: {
    userId: number;
    username: string;
    [key: string]: any;
  };
}

/**
 * 成就统计响应DTO
 */
interface AchievementStatsDto {
  totalAchievements: number;
  unlockedCount: number;
  claimedCount: number;
  totalRewards: number;
}

/**
 * 成就列表响应DTO
 */
interface AchievementListDto {
  achievements: Achievement[];
  userProgress?: Array<{
    achievementId: string;
    isUnlocked: boolean;
    isClaimed: boolean;
  }>;
}

/**
 * 检查成就请求DTO
 */
interface CheckAchievementDto {
  event: GameEvent;
}

@Controller('achievements')
export class AchievementController {
  constructor(private readonly achievementService: AchievementService) {}

  /**
   * 获取成就列表
   *
   * 返回所有可显示的成就。如果用户已登录，会额外返回每个成就的解锁状态。
   * 支持按游戏类型筛选。
   *
   * @query gameType - 游戏类型筛选（可选）
   * @returns 成就列表
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getAchievements(
    @Query('gameType') gameType?: string,
    @Req() req?: RequestWithUser,
  ): Promise<Achievement[]> {
    const userId = req?.user?.userId;
    return this.achievementService.getAchievements(userId, gameType);
  }

  /**
   * 获取用户已解锁的成就列表
   *
   * 返回当前登录用户所有已解锁和进行中的成就。
   *
   * @returns 用户成就列表
   */
  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyAchievements(
    @Req() req: RequestWithUser,
  ): Promise<UserAchievement[]> {
    const userId = req.user!.userId;
    return this.achievementService.getUserAchievements(userId);
  }

  /**
   * 获取成就统计
   *
   * 返回当前登录用户的成就统计信息。
   *
   * @returns 成就统计
   */
  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getAchievementStats(
    @Req() req: RequestWithUser,
  ): Promise<AchievementStatsDto> {
    const userId = req.user!.userId;
    return this.achievementService.getAchievementStats(userId);
  }

  /**
   * 获取成就详情与进度
   *
   * 返回指定成就的详细信息和当前用户的进度。
   *
   * @param achievementId - 成就ID
   * @returns 成就进度
   */
  @Get(':achievementId/progress')
  @UseGuards(JwtAuthGuard)
  async getProgress(
    @Param('achievementId', ParseIntPipe) achievementId: number,
    @Req() req: RequestWithUser,
  ): Promise<AchievementProgress> {
    const userId = req.user!.userId;
    return this.achievementService.getProgress(userId, achievementId);
  }

  /**
   * 领取成就奖励
   *
   * 用户解锁成就后，调用此接口领取对应的奖励。
   *
   * @param achievementId - 成就ID
   * @returns 领取的奖励信息
   */
  @Post(':achievementId/claim')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async claimReward(
    @Param('achievementId', ParseIntPipe) achievementId: number,
    @Req() req: RequestWithUser,
  ): Promise<Reward> {
    const userId = req.user!.userId;
    return this.achievementService.claimReward(userId, achievementId);
  }

  /**
   * 检查并解锁成就（手动触发）
   *
   * 用于测试或手动触发成就检查。正常情况下成就会自动检查。
   *
   * @param achievementId - 成就ID
   * @param body - 包含事件类型
   * @returns 新解锁的成就列表
   */
  @Post(':achievementId/check')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async checkAndUnlock(
    @Param('achievementId', ParseIntPipe) achievementId: number,
    @Body() body: CheckAchievementDto,
    @Req() req: RequestWithUser,
  ): Promise<UnlockedAchievement[]> {
    const userId = req.user!.userId;
    return this.achievementService.checkAndUnlock(userId, body.event);
  }

  /**
   * 获取未领取奖励的已解锁成就
   *
   * 返回用户已解锁但尚未领取奖励的成就列表。
   *
   * @returns 未领取的成就列表
   */
  @Get('unclaimed')
  @UseGuards(JwtAuthGuard)
  async getUnclaimedAchievements(
    @Req() req: RequestWithUser,
  ): Promise<UserAchievement[]> {
    const userId = req.user!.userId;
    return this.achievementService.getUnclaimedAchievements(userId);
  }
}
