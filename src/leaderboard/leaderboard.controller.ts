/**
 * LeaderboardController - 排行榜 REST API 控制器
 *
 * 提供排行榜查询、赛季管理、评分更新等HTTP接口
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { LeaderboardService, LeaderboardEntryItem, UserGameStats, Season } from './leaderboard.service';
import { EloCalculator, RatingUpdateResult } from './elo-calculator';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { CreateSeasonDto } from './dto/create-season.dto';
import { UpdateRatingDto } from './dto/update-rating.dto';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

/**
 * 排行榜查询参数 (用于URL路径参数方式)
 */
interface LeaderboardParams {
  gameType: string;
  seasonId?: string;
  scope?: 'global' | 'regional' | 'friends';
  period?: 'daily' | 'weekly' | 'monthly' | 'all_time';
  page?: number;
  pageSize?: number;
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly leaderboardService: LeaderboardService,
    private readonly eloCalculator: EloCalculator,
  ) {}

  // ============================================================
  // 排行榜查询
  // ============================================================

  /**
   * 获取排行榜 (Query参数方式)
   * GET /leaderboard?gameType=chess&seasonId=all_time&scope=global&period=all_time&page=1&pageSize=50
   */
  @Get()
  async getLeaderboard(
    @Query() query: LeaderboardQueryDto,
  ): Promise<PaginatedResult<LeaderboardEntryItem>> {
    return this.leaderboardService.getLeaderboard(
      query.gameType,
      query.seasonId,
      query.scope,
      query.period,
      query.page,
      query.pageSize,
    );
  }

  /**
   * 获取排行榜 (RESTful路径方式)
   * GET /leaderboard/:gameType
   */
  @Get(':gameType')
  async getLeaderboardByGameType(
    @Param('gameType') gameType: string,
    @Query('seasonId') seasonId: string = 'all_time',
    @Query('scope') scope: 'global' | 'regional' | 'friends' = 'global',
    @Query('period') period: 'daily' | 'weekly' | 'monthly' | 'all_time' = 'all_time',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
  ): Promise<PaginatedResult<LeaderboardEntryItem>> {
    return this.leaderboardService.getLeaderboard(
      gameType,
      seasonId,
      scope,
      period,
      page,
      Math.min(pageSize, 100),
    );
  }

  /**
   * 获取用户排名
   * GET /leaderboard/:gameType/rank/:userId
   */
  @Get(':gameType/rank/:userId')
  async getUserRank(
    @Param('gameType') gameType: string,
    @Param('userId', ParseIntPipe) userId: number,
    @Query('seasonId') seasonId: string = 'all_time',
  ): Promise<{ userId: number; rank: number; gameType: string; seasonId: string }> {
    const rank = await this.leaderboardService.getUserRank(userId, gameType, seasonId);
    return { userId, rank, gameType, seasonId };
  }

  /**
   * 获取好友排行榜
   * GET /leaderboard/:gameType/friends/:userId
   */
  @Get(':gameType/friends/:userId')
  async getFriendsLeaderboard(
    @Param('gameType') gameType: string,
    @Param('userId', ParseIntPipe) userId: number,
    @Query('friendIds') friendIdsStr: string,
    @Query('seasonId') seasonId: string = 'all_time',
  ): Promise<{ items: LeaderboardEntryItem[]; userId: number; gameType: string }> {
    const friendIds = friendIdsStr
      ? friendIdsStr.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id))
      : [];

    const items = await this.leaderboardService.getFriendsLeaderboard(
      userId,
      gameType,
      seasonId,
      friendIds,
    );

    return { items, userId, gameType };
  }

  // ============================================================
  // 个人战绩
  // ============================================================

  /**
   * 获取个人战绩统计
   * GET /leaderboard/stats/:userId?gameType=chess
   */
  @Get('stats/:userId')
  async getUserStats(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('gameType') gameType?: string,
  ): Promise<UserGameStats> {
    return this.leaderboardService.getUserStats(userId, gameType);
  }

  /**
   * 获取个人战绩 (路径参数方式)
   * GET /leaderboard/:gameType/stats/:userId
   */
  @Get(':gameType/stats/:userId')
  async getUserStatsByGameType(
    @Param('gameType') gameType: string,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<UserGameStats> {
    return this.leaderboardService.getUserStats(userId, gameType);
  }

  // ============================================================
  // 赛季管理
  // ============================================================

  /**
   * 获取赛季列表
   * GET /leaderboard/seasons/:gameType
   */
  @Get('seasons/:gameType')
  async getSeasons(
    @Param('gameType') gameType: string,
  ): Promise<{ seasons: Season[]; gameType: string }> {
    const seasons = await this.leaderboardService.getSeasons(gameType);
    return { seasons, gameType };
  }

  /**
   * 创建新赛季
   * POST /leaderboard/seasons
   */
  @Post('seasons')
  @HttpCode(HttpStatus.CREATED)
  async createSeason(
    @Body() dto: CreateSeasonDto,
  ): Promise<{ season: Season; message: string }> {
    const season = await this.leaderboardService.createSeason(
      dto.name,
      new Date(dto.startDate),
      new Date(dto.endDate),
      dto.gameType,
    );
    return { season, message: 'Season created successfully' };
  }

  /**
   * 结束赛季
   * PUT /leaderboard/seasons/:seasonId/end
   */
  @Put('seasons/:seasonId/end')
  async endSeason(
    @Param('seasonId') seasonId: string,
  ): Promise<{ seasonId: string; message: string }> {
    await this.leaderboardService.endSeason(seasonId);
    return { seasonId, message: 'Season ended successfully' };
  }

  // ============================================================
  // 评分更新
  // ============================================================

  /**
   * 更新评分（对局结束后调用）
   * POST /leaderboard/rating/update
   */
  @Post('rating/update')
  @HttpCode(HttpStatus.OK)
  async updateRating(
    @Body() dto: UpdateRatingDto,
  ): Promise<{ updates: RatingUpdateResult[]; message: string }> {
    const updates = await this.leaderboardService.updateRating(
      dto.gameType,
      dto.playerResults,
    );
    return { updates, message: 'Rating updated successfully' };
  }

  // ============================================================
  // ELO 计算工具
  // ============================================================

  /**
   * 计算双人ELO变化（预览，不实际更新）
   * POST /leaderboard/elo/calculate/duel
   */
  @Post('elo/calculate/duel')
  async calculateDuelElo(
    @Body()
    body: {
      playerA: { userId: number; rating: number; gamesPlayed: number; score: number };
      playerB: { userId: number; rating: number; gamesPlayed: number; score: number };
    },
  ): Promise<{ result: [RatingUpdateResult, RatingUpdateResult] }> {
    const result = this.eloCalculator.calculateDuelRating(
      body.playerA,
      body.playerB,
    );
    return { result };
  }

  /**
   * 计算多人ELO变化（预览，不实际更新）
   * POST /leaderboard/elo/calculate/multiplayer
   */
  @Post('elo/calculate/multiplayer')
  async calculateMultiplayerElo(
    @Body()
    body: {
      players: { userId: number; rating: number; gamesPlayed: number; rank: number }[];
    },
  ): Promise<{ results: RatingUpdateResult[] }> {
    const results = this.eloCalculator.calculateMultiplayerRating(body.players);
    return { results };
  }

  // ============================================================
  // 防刷分检测
  // ============================================================

  /**
   * 检测用户是否存在刷分行为
   * GET /leaderboard/cheat/:gameType/:userId
   */
  @Get('cheat/:gameType/:userId')
  async detectCheating(
    @Param('gameType') gameType: string,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ userId: number; gameType: string; isCheating: boolean }> {
    const isCheating = await this.leaderboardService.detectCheating(userId, gameType);
    return { userId, gameType, isCheating };
  }

  // ============================================================
  // 管理接口
  // ============================================================

  /**
   * 重建排行榜（数据恢复）
   * POST /leaderboard/admin/rebuild/:gameType
   */
  @Post('admin/rebuild/:gameType')
  async rebuildLeaderboard(
    @Param('gameType') gameType: string,
    @Query('seasonId') seasonId: string = 'all_time',
  ): Promise<{ gameType: string; seasonId: string; message: string }> {
    await this.leaderboardService.rebuildLeaderboard(gameType, seasonId);
    return { gameType, seasonId, message: 'Leaderboard rebuilt successfully' };
  }
}
