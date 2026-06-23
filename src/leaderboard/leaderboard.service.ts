/**
 * LeaderboardService - 排行榜核心服务
 *
 * 基于 Redis Sorted Set 实现高性能排行榜：
 * - 排行榜数据: Redis Sorted Set (score=rating, member=userId)
 * - 赛季数据: Redis Hash + PostgreSQL 持久化
 * - 用户统计: Redis Hash 缓存 + 数据库
 * - 防刷分: Redis 计数器 + 行为分析
 *
 * Redis Key 设计:
 * - leaderboard:{gameType}:{seasonId}       → Sorted Set (score=rating, member=userId)
 * - leaderboard:{gameType}:{period}          → Sorted Set (日/周/月榜)
 * - leaderboard:stats:{userId}:{gameType}    → Hash (用户统计)
 * - leaderboard:streak:{userId}:{gameType}   → String (当前连胜)
 * - leaderboard:cheat:{userId}:{gameType}    → Hash (防刷分检测数据)
 * - leaderboard:seasons:{gameType}           → List (赛季列表)
 * - leaderboard:season:{seasonId}            → Hash (赛季详情)
 * - leaderboard:highest:{userId}:{gameType}  → String (最高评分)
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';

import { LeaderboardEntry } from '../common/entities/leaderboard-entry.entity';
import { User } from '../common/entities/user.entity';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { EloCalculator, RatingUpdateResult, SeasonConfig } from './elo-calculator';

// ============================================================
// 接口定义
// ============================================================

export interface LeaderboardEntryItem {
  rank: number;
  userId: number;
  username: string;
  avatarUrl: string;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  bestStreak: number;
}

export interface UserGameStats {
  gameType: string;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  winRate: number;
  currentRating: number;
  highestRating: number;
  bestStreak: number;
  currentStreak: number;
  totalPlayTime: number; // 秒
}

export interface Season {
  seasonId: string;
  name: string;
  gameType: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface RatingUpdateParams {
  userId: number;
  rank: number;
  oldRating: number;
  gamesPlayed?: number;
  gameDuration?: number; // 对局时长(秒)
}

// ============================================================
// Redis Key 常量
// ============================================================

const REDIS_KEY = {
  // 排行榜 Sorted Set: score=rating, member=userId
  LEADERBOARD: (gameType: string, seasonId: string) =>
    `leaderboard:${gameType}:${seasonId}`,

  // 周期排行榜 (daily/weekly/monthly)
  PERIOD_BOARD: (gameType: string, period: string) =>
    `leaderboard:${gameType}:period:${period}`,

  // 用户统计 Hash
  USER_STATS: (userId: number, gameType: string) =>
    `leaderboard:stats:${userId}:${gameType}`,

  // 用户连胜计数器
  USER_STREAK: (userId: number, gameType: string) =>
    `leaderboard:streak:${userId}:${gameType}`,

  // 用户最高评分
  USER_HIGHEST: (userId: number, gameType: string) =>
    `leaderboard:highest:${userId}:${gameType}`,

  // 防刷分检测数据
  CHEAT_CHECK: (userId: number, gameType: string) =>
    `leaderboard:cheat:${userId}:${gameType}`,

  // 赛季列表
  SEASONS: (gameType: string) => `leaderboard:seasons:${gameType}`,

  // 赛季详情 Hash
  SEASON_DETAIL: (seasonId: string) => `leaderboard:season:${seasonId}`,

  // 区域排行榜 (预留)
  REGIONAL_BOARD: (gameType: string, seasonId: string, region: string) =>
    `leaderboard:${gameType}:${seasonId}:region:${region}`,
};

// ============================================================
// 防刷分常量
// ============================================================

const CHEAT_CONFIG = {
  // 短时间内对局数阈值 (5分钟内超过5局视为异常)
  TIME_WINDOW_MS: 5 * 60 * 1000, // 5分钟
  GAMES_THRESHOLD: 5,

  // 胜率异常阈值 (连续10局胜率100%且对手评分异常低)
  SUSPICIOUS_WIN_RATE: 1.0,
  MIN_GAMES_FOR_CHECK: 10,

  // 对局时长异常 (平均对局时长小于30秒视为异常)
  MIN_AVG_DURATION_SEC: 30,

  // 评分异常波动阈值 (单局评分变化超过200视为异常)
  MAX_RATING_CHANGE_PER_GAME: 200,
};

// ============================================================
// 服务实现
// ============================================================

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private readonly redis: Redis;

  constructor(
    private readonly configService: ConfigService,
    private readonly eloCalculator: EloCalculator,
    @InjectRepository(LeaderboardEntry)
    private readonly leaderboardRepo: Repository<LeaderboardEntry>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    const redisConfig = this.configService.get('redis');
    this.redis = new Redis({
      host: redisConfig?.host || 'localhost',
      port: redisConfig?.port || 6379,
      password: redisConfig?.password || undefined,
      db: redisConfig?.db || 0,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error:', err.message);
    });
  }

  // ============================================================
  // 排行榜查询
  // ============================================================

  /**
   * 获取排行榜
   * @param gameType 游戏类型
   * @param seasonId 赛季ID (默认 all_time)
   * @param scope 范围: global/regional/friends
   * @param period 周期: daily/weekly/monthly/all_time
   * @param page 页码
   * @param pageSize 每页数量
   */
  async getLeaderboard(
    gameType: string,
    seasonId: string = 'all_time',
    scope: 'global' | 'regional' | 'friends' = 'global',
    period: 'daily' | 'weekly' | 'monthly' | 'all_time' = 'all_time',
    page: number = 1,
    pageSize: number = 50,
  ): Promise<PaginatedResult<LeaderboardEntryItem>> {
    const start = Date.now();

    // 确定Redis key
    const redisKey = this.resolveLeaderboardKey(gameType, seasonId, period);

    // 获取总数
    const total = await this.redis.zcard(redisKey);

    // 计算分页范围 (Redis排名从0开始)
    const startRank = (page - 1) * pageSize;
    const endRank = startRank + pageSize - 1;

    // 从Sorted Set获取排名数据 (从高分到低分)
    const results = await this.redis.zrevrange(
      redisKey,
      startRank,
      endRank,
      'WITHSCORES',
    );

    // 构建排行榜条目
    const items: LeaderboardEntryItem[] = [];
    for (let i = 0; i < results.length; i += 2) {
      const userId = parseInt(results[i], 10);
      const rating = parseInt(results[i + 1], 10);
      const rank = startRank + Math.floor(i / 2) + 1;

      // 获取用户信息和统计
      const userInfo = await this.getUserInfo(userId);
      const stats = await this.getUserStatsFromRedis(userId, gameType);

      items.push({
        rank,
        userId,
        username: userInfo?.username || `Player#${userId}`,
        avatarUrl: userInfo?.avatar_url || '',
        rating,
        gamesPlayed: stats?.gamesPlayed || 0,
        gamesWon: stats?.gamesWon || 0,
        winRate: stats?.winRate || 0,
        bestStreak: stats?.bestStreak || 0,
      });
    }

    const totalPages = Math.ceil(total / pageSize);

    this.logger.debug(
      `getLeaderboard(${gameType}, ${seasonId}, ${scope}, ${period}) ` +
        `page=${page}, total=${total}, took=${Date.now() - start}ms`,
    );

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * 获取用户在排行榜中的排名
   * @param userId 用户ID
   * @param gameType 游戏类型
   * @param seasonId 赛季ID (可选，默认all_time)
   * @returns 排名 (1-based, 0表示未上榜)
   */
  async getUserRank(
    userId: number,
    gameType: string,
    seasonId: string = 'all_time',
  ): Promise<number> {
    const redisKey = REDIS_KEY.LEADERBOARD(gameType, seasonId);

    // zrevrank 返回从0开始的排名，null表示member不存在
    const rank = await this.redis.zrevrank(redisKey, String(userId));

    if (rank === null) {
      return 0; // 用户未上榜
    }

    return rank + 1; // 转换为1-based排名
  }

  /**
   * 获取用户评分
   * @param userId 用户ID
   * @param gameType 游戏类型
   * @param seasonId 赛季ID
   */
  async getUserRating(
    userId: number,
    gameType: string,
    seasonId: string = 'all_time',
  ): Promise<number> {
    const redisKey = REDIS_KEY.LEADERBOARD(gameType, seasonId);
    const score = await this.redis.zscore(redisKey, String(userId));
    return score === null ? 1000 : parseInt(score, 10); // 默认1000分
  }

  // ============================================================
  // 评分更新 (对局结束后调用)
  // ============================================================

  /**
   * 更新ELO评分（对局结束后调用）
   * @param gameType 游戏类型
   * @param playerResults 玩家结果数组
   */
  async updateRating(
    gameType: string,
    playerResults: RatingUpdateParams[],
  ): Promise<RatingUpdateResult[]> {
    if (!playerResults || playerResults.length < 2) {
      throw new BadRequestException('At least 2 players are required');
    }

    const seasonId = await this.getActiveSeasonId(gameType);

    // 1. 获取玩家当前统计信息
    const playersWithStats = await Promise.all(
      playerResults.map(async (p) => {
        const stats = await this.getUserStatsFromRedis(p.userId, gameType);
        const currentRating =
          p.oldRating || (await this.getUserRating(p.userId, gameType, seasonId));
        return {
          ...p,
          rating: currentRating,
          gamesPlayed: stats?.gamesPlayed || 0,
        };
      }),
    );

    // 2. 计算ELO更新
    const eloPlayers = playersWithStats.map((p) => ({
      userId: p.userId,
      rating: p.rating,
      gamesPlayed: p.gamesPlayed,
      rank: p.rank,
      score: p.rank === 1 ? 1 : p.rank === 2 ? 0.5 : 0, // 简化处理
    }));

    const updates = this.eloCalculator.calculateRatingUpdates(eloPlayers);

    // 3. 并行更新Redis和数据库
    await Promise.all(
      updates.map((update, idx) =>
        this.applyRatingUpdate(
          gameType,
          seasonId,
          update,
          playersWithStats[idx].rank === 1, // 是否获胜
          playerResults[idx].gameDuration || 0,
        ),
      ),
    );

    // 4. 更新周期排行榜 (daily/weekly/monthly)
    await this.updatePeriodBoards(gameType, updates);

    this.logger.log(
      `Rating updated for ${updates.length} players in ${gameType}: ` +
        updates.map((u) => `${u.userId}:${u.oldRating}->${u.newRating}`).join(', '),
    );

    return updates;
  }

  /**
   * 应用单个玩家的评分更新
   */
  private async applyRatingUpdate(
    gameType: string,
    seasonId: string,
    update: RatingUpdateResult,
    isWin: boolean,
    gameDuration: number,
  ): Promise<void> {
    const userId = update.userId;
    const pipeline = this.redis.pipeline();

    // 1. 更新排行榜Sorted Set
    const leaderboardKey = REDIS_KEY.LEADERBOARD(gameType, seasonId);
    pipeline.zadd(leaderboardKey, update.newRating, String(userId));

    // 2. 更新用户统计Hash
    const statsKey = REDIS_KEY.USER_STATS(userId, gameType);
    pipeline.hincrby(statsKey, 'gamesPlayed', 1);
    if (isWin) {
      pipeline.hincrby(statsKey, 'gamesWon', 1);
    }
    pipeline.hset(statsKey, 'currentRating', String(update.newRating));
    pipeline.hincrby(statsKey, 'totalPlayTime', gameDuration);

    // 3. 更新连胜记录
    const streakKey = REDIS_KEY.USER_STREAK(userId, gameType);
    if (isWin) {
      pipeline.incr(streakKey);
    } else {
      pipeline.del(streakKey);
    }

    // 4. 检查并更新最高评分
    const highestKey = REDIS_KEY.USER_HIGHEST(userId, gameType);
    const currentHighest = await this.redis.get(highestKey);
    if (!currentHighest || update.newRating > parseInt(currentHighest, 10)) {
      pipeline.set(highestKey, String(update.newRating));
    }

    // 执行Redis管道
    await pipeline.exec();

    // 5. 更新最佳连胜和胜率 (需要重新计算)
    await this.updateDerivedStats(userId, gameType, isWin);

    // 6. 同步到数据库 (异步，不阻塞)
    this.syncToDatabase(userId, gameType, seasonId).catch((err) => {
      this.logger.error(`Failed to sync leaderboard to DB: ${err.message}`);
    });
  }

  /**
   * 更新派生统计数据（胜率、最佳连胜等）
   */
  private async updateDerivedStats(
    userId: number,
    gameType: string,
    isWin: boolean,
  ): Promise<void> {
    const statsKey = REDIS_KEY.USER_STATS(userId, gameType);
    const streakKey = REDIS_KEY.USER_STREAK(userId, gameType);

    const stats = await this.redis.hgetall(statsKey);
    const gamesPlayed = parseInt(stats.gamesPlayed || '0', 10);
    const gamesWon = parseInt(stats.gamesWon || '0', 10);
    const currentStreak = parseInt(
      (await this.redis.get(streakKey)) || '0',
      10,
    );
    const bestStreak = parseInt(stats.bestStreak || '0', 10);

    // 计算胜率
    const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 10000) / 10000 : 0;

    // 更新最佳连胜
    const newBestStreak = Math.max(bestStreak, currentStreak);

    // 更新派生统计
    await this.redis.hmset(statsKey, {
      winRate: String(winRate),
      bestStreak: String(newBestStreak),
      currentStreak: String(currentStreak),
    });
  }

  /**
   * 更新周期排行榜 (daily/weekly/monthly)
   */
  private async updatePeriodBoards(
    gameType: string,
    updates: RatingUpdateResult[],
  ): Promise<void> {
    const now = new Date();
    const periods = [
      { key: 'daily', suffix: this.formatDateKey(now) },
      {
        key: 'weekly',
        suffix: this.getWeekKey(now),
      },
      {
        key: 'monthly',
        suffix: this.formatMonthKey(now),
      },
    ];

    const pipeline = this.redis.pipeline();

    for (const update of updates) {
      for (const period of periods) {
        const key = REDIS_KEY.PERIOD_BOARD(gameType, `${period.key}:${period.suffix}`);
        pipeline.zadd(key, update.newRating, String(update.userId));
        // 设置过期时间 (日榜1天, 周榜7天, 月榜30天)
        const ttl =
          period.key === 'daily'
            ? 86400
            : period.key === 'weekly'
              ? 604800
              : 2592000;
        pipeline.expire(key, ttl);
      }
    }

    await pipeline.exec();
  }

  // ============================================================
  // 个人战绩统计
  // ============================================================

  /**
   * 获取个人战绩统计
   * @param userId 用户ID
   * @param gameType 游戏类型 (可选，不提供则返回默认类型)
   */
  async getUserStats(
    userId: number,
    gameType?: string,
  ): Promise<UserGameStats> {
    const resolvedGameType = gameType || 'default';

    // 从Redis获取统计
    const stats = await this.getUserStatsFromRedis(userId, resolvedGameType);

    if (!stats || stats.gamesPlayed === 0) {
      // 无缓存或数据为空，返回默认值
      return {
        gameType: resolvedGameType,
        gamesPlayed: 0,
        gamesWon: 0,
        gamesDrawn: 0,
        gamesLost: 0,
        winRate: 0,
        currentRating: 1000,
        highestRating: 1000,
        bestStreak: 0,
        currentStreak: 0,
        totalPlayTime: 0,
      };
    }

    // 从数据库补充平局数据 (Redis中不存储平局)
    const dbEntry = await this.leaderboardRepo.findOne({
      where: { game_type: resolvedGameType, user_id: String(userId) },
    });

    const gamesDrawn = dbEntry?.games_drawn || 0;
    const gamesPlayed = stats.gamesPlayed || 0;
    const gamesWon = stats.gamesWon || 0;
    const gamesLost = Math.max(0, gamesPlayed - gamesWon - gamesDrawn);

    return {
      gameType: resolvedGameType,
      gamesPlayed,
      gamesWon,
      gamesDrawn,
      gamesLost,
      winRate: stats.winRate || 0,
      currentRating: stats.currentRating || 1000,
      highestRating: stats.highestRating || 1000,
      bestStreak: stats.bestStreak || 0,
      currentStreak: stats.currentStreak || 0,
      totalPlayTime: stats.totalPlayTime || 0,
    };
  }

  // ============================================================
  // 赛季管理
  // ============================================================

  /**
   * 获取赛季列表
   * @param gameType 游戏类型
   */
  async getSeasons(gameType: string): Promise<Season[]> {
    const seasonsKey = REDIS_KEY.SEASONS(gameType);

    // 从Redis获取赛季ID列表
    const seasonIds = await this.redis.lrange(seasonsKey, 0, -1);

    if (!seasonIds || seasonIds.length === 0) {
      // 返回默认赛季
      return [
        {
          seasonId: 'all_time',
          name: 'All Time',
          gameType,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2099-12-31'),
          isActive: true,
        },
      ];
    }

    // 获取每个赛季的详情
    const seasons: Season[] = [];
    for (const seasonId of seasonIds) {
      const detail = await this.redis.hgetall(REDIS_KEY.SEASON_DETAIL(seasonId));
      if (detail && detail.name) {
        seasons.push({
          seasonId: detail.seasonId || seasonId,
          name: detail.name,
          gameType: detail.gameType || gameType,
          startDate: new Date(detail.startDate || Date.now()),
          endDate: new Date(detail.endDate || Date.now()),
          isActive: detail.isActive === 'true',
          createdAt: new Date(detail.createdAt || Date.now()),
        });
      }
    }

    // 按开始日期降序排列
    seasons.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

    return seasons;
  }

  /**
   * 创建新赛季（管理员功能）
   * @param name 赛季名称
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param gameType 游戏类型
   */
  async createSeason(
    name: string,
    startDate: Date,
    endDate: Date,
    gameType: string = 'default',
  ): Promise<Season> {
    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    const seasonId = `season_${Date.now()}`;
    const season: Season = {
      seasonId,
      name,
      gameType,
      startDate,
      endDate,
      isActive: true,
    };

    const pipeline = this.redis.pipeline();

    // 存储赛季详情
    const detailKey = REDIS_KEY.SEASON_DETAIL(seasonId);
    pipeline.hmset(detailKey, {
      seasonId: season.seasonId,
      name: season.name,
      gameType: season.gameType,
      startDate: season.startDate.toISOString(),
      endDate: season.endDate.toISOString(),
      isActive: 'true',
      createdAt: new Date().toISOString(),
    });

    // 添加到赛季列表
    const seasonsKey = REDIS_KEY.SEASONS(gameType);
    pipeline.lpush(seasonsKey, seasonId);

    await pipeline.exec();

    this.logger.log(`Season created: ${seasonId} (${name}) for ${gameType}`);

    return season;
  }

  /**
   * 结束赛季（管理员功能）
   * @param seasonId 赛季ID
   */
  async endSeason(seasonId: string): Promise<void> {
    const detailKey = REDIS_KEY.SEASON_DETAIL(seasonId);

    // 检查赛季是否存在
    const exists = await this.redis.exists(detailKey);
    if (!exists) {
      throw new NotFoundException(`Season ${seasonId} not found`);
    }

    // 将赛季标记为已结束
    await this.redis.hmset(detailKey, {
      isActive: 'false',
      endedAt: new Date().toISOString(),
    });

    this.logger.log(`Season ended: ${seasonId}`);
  }

  /**
   * 获取当前活跃赛季的ID
   */
  private async getActiveSeasonId(gameType: string): Promise<string> {
    const seasons = await this.getSeasons(gameType);
    const activeSeason = seasons.find((s) => s.isActive);
    return activeSeason?.seasonId || 'all_time';
  }

  // ============================================================
  // 防刷分检测
  // ============================================================

  /**
   * 检测用户是否存在刷分行为
   * @param userId 用户ID
   * @param gameType 游戏类型
   * @returns true=存在刷分嫌疑, false=正常
   */
  async detectCheating(userId: number, gameType: string): Promise<boolean> {
    const cheatKey = REDIS_KEY.CHEAT_CHECK(userId, gameType);

    // 获取近期对局数据
    const cheatData = await this.redis.hgetall(cheatKey);

    if (!cheatData || Object.keys(cheatData).length === 0) {
      return false;
    }

    const recentGames = parseInt(cheatData.recentGames || '0', 10);
    const avgDuration = parseFloat(cheatData.avgDuration || '0');
    const winStreak = parseInt(cheatData.winStreak || '0', 10);
    const maxRatingChange = parseFloat(cheatData.maxRatingChange || '0');

    // 检测规则1: 短时间内对局数过多
    if (recentGames >= CHEAT_CONFIG.GAMES_THRESHOLD) {
      this.logger.warn(
        `Cheat detect (freq): userId=${userId}, recentGames=${recentGames}`,
      );
      return true;
    }

    // 检测规则2: 连胜异常 (连续10局以上全胜)
    if (winStreak >= CHEAT_CONFIG.MIN_GAMES_FOR_CHECK) {
      this.logger.warn(
        `Cheat detect (streak): userId=${userId}, winStreak=${winStreak}`,
      );
      return true;
    }

    // 检测规则3: 对局时长异常 (平均时长过短)
    if (
      avgDuration > 0 &&
      avgDuration < CHEAT_CONFIG.MIN_AVG_DURATION_SEC
    ) {
      this.logger.warn(
        `Cheat detect (duration): userId=${userId}, avgDuration=${avgDuration}s`,
      );
      return true;
    }

    // 检测规则4: 评分波动异常
    if (maxRatingChange > CHEAT_CONFIG.MAX_RATING_CHANGE_PER_GAME) {
      this.logger.warn(
        `Cheat detect (rating): userId=${userId}, maxChange=${maxRatingChange}`,
      );
      return true;
    }

    return false;
  }

  /**
   * 记录对局数据用于防刷分检测
   * @param userId 用户ID
   * @param gameType 游戏类型
   * @param isWin 是否获胜
   * @param duration 对局时长(秒)
   * @param ratingChange 评分变化
   */
  async recordGameForCheatDetection(
    userId: number,
    gameType: string,
    isWin: boolean,
    duration: number,
    ratingChange: number,
  ): Promise<void> {
    const cheatKey = REDIS_KEY.CHEAT_CHECK(userId, gameType);

    const pipeline = this.redis.pipeline();

    // 增加近期对局计数 (带滑动窗口)
    pipeline.hincrby(cheatKey, 'recentGames', 1);
    pipeline.pexpire(cheatKey, CHEAT_CONFIG.TIME_WINDOW_MS);

    // 更新平均对局时长
    const currentAvg = await this.redis.hget(cheatKey, 'avgDuration');
    const newAvg = currentAvg
      ? (parseFloat(currentAvg) + duration) / 2
      : duration;
    pipeline.hset(cheatKey, 'avgDuration', String(newAvg));

    // 更新连胜计数
    if (isWin) {
      pipeline.hincrby(cheatKey, 'winStreak', 1);
    } else {
      pipeline.hset(cheatKey, 'winStreak', '0');
    }

    // 更新最大评分变化
    const currentMax = await this.redis.hget(cheatKey, 'maxRatingChange');
    if (!currentMax || Math.abs(ratingChange) > parseFloat(currentMax)) {
      pipeline.hset(cheatKey, 'maxRatingChange', String(Math.abs(ratingChange)));
    }

    await pipeline.exec();
  }

  // ============================================================
  // 数据库同步
  // ============================================================

  /**
   * 将排行榜数据同步到数据库
   */
  private async syncToDatabase(
    userId: number,
    gameType: string,
    seasonId: string,
  ): Promise<void> {
    const statsKey = REDIS_KEY.USER_STATS(userId, gameType);
    const stats = await this.redis.hgetall(statsKey);

    if (!stats || Object.keys(stats).length === 0) {
      return;
    }

    // 查找或创建数据库记录
    let entry = await this.leaderboardRepo.findOne({
      where: {
        game_type: gameType,
        season_id: seasonId,
        user_id: String(userId),
      },
    });

    if (!entry) {
      entry = this.leaderboardRepo.create({
        game_type: gameType,
        season_id: seasonId,
        plugin_id: gameType,
        user_id: String(userId),
      });
    }

    // 更新数据
    entry.rating_score = parseInt(stats.currentRating || '1000', 10);
    entry.games_played = parseInt(stats.gamesPlayed || '0', 10);
    entry.games_won = parseInt(stats.gamesWon || '0', 10);
    entry.best_streak = parseInt(stats.bestStreak || '0', 10);

    await this.leaderboardRepo.save(entry);
  }

  /**
   * 从数据库重建Redis排行榜（用于数据恢复或初始化）
   */
  async rebuildLeaderboard(
    gameType: string,
    seasonId: string = 'all_time',
  ): Promise<void> {
    const entries = await this.leaderboardRepo.find({
      where: { game_type: gameType, season_id: seasonId },
      order: { rating_score: 'DESC' },
    });

    if (entries.length === 0) {
      this.logger.warn(
        `No entries found for ${gameType}/${seasonId}, skip rebuild`,
      );
      return;
    }

    const redisKey = REDIS_KEY.LEADERBOARD(gameType, seasonId);

    // 清除旧数据
    await this.redis.del(redisKey);

    // 批量写入新数据
    const pipeline = this.redis.pipeline();
    for (const entry of entries) {
      pipeline.zadd(redisKey, entry.rating_score, entry.user_id);
    }
    await pipeline.exec();

    this.logger.log(
      `Leaderboard rebuilt: ${entries.length} entries for ${gameType}/${seasonId}`,
    );
  }

  // ============================================================
  // 好友排行榜
  // ============================================================

  /**
   * 获取好友排行榜
   * @param userId 用户ID
   * @param gameType 游戏类型
   * @param seasonId 赛季ID
   * @param friendIds 好友ID列表
   */
  async getFriendsLeaderboard(
    userId: number,
    gameType: string,
    seasonId: string,
    friendIds: number[],
  ): Promise<LeaderboardEntryItem[]> {
    const redisKey = REDIS_KEY.LEADERBOARD(gameType, seasonId);

    // 包含用户自己
    const allUserIds = [...new Set([userId, ...friendIds])];

    // 批量获取评分
    const results = await this.redis.zmscore(
      redisKey,
      allUserIds.map(String),
    );

    // 构建条目并排序
    const items: LeaderboardEntryItem[] = [];
    for (let i = 0; i < allUserIds.length; i++) {
      const uid = allUserIds[i];
      const rating = results[i] ? parseInt(String(results[i]), 10) : 1000;

      const userInfo = await this.getUserInfo(uid);
      const stats = await this.getUserStatsFromRedis(uid, gameType);

      items.push({
        rank: 0, // 稍后计算
        userId: uid,
        username: userInfo?.username || `Player#${uid}`,
        avatarUrl: userInfo?.avatar_url || '',
        rating,
        gamesPlayed: stats?.gamesPlayed || 0,
        gamesWon: stats?.gamesWon || 0,
        winRate: stats?.winRate || 0,
        bestStreak: stats?.bestStreak || 0,
      });
    }

    // 按评分降序排列并设置排名
    items.sort((a, b) => b.rating - a.rating);
    items.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    return items;
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /**
   * 解析排行榜Redis key
   */
  private resolveLeaderboardKey(
    gameType: string,
    seasonId: string,
    period: string,
  ): string {
    if (period === 'all_time') {
      return REDIS_KEY.LEADERBOARD(gameType, seasonId);
    }

    const now = new Date();
    if (period === 'daily') {
      return REDIS_KEY.PERIOD_BOARD(gameType, `daily:${this.formatDateKey(now)}`);
    }
    if (period === 'weekly') {
      return REDIS_KEY.PERIOD_BOARD(gameType, `weekly:${this.getWeekKey(now)}`);
    }
    if (period === 'monthly') {
      return REDIS_KEY.PERIOD_BOARD(gameType, `monthly:${this.formatMonthKey(now)}`);
    }

    return REDIS_KEY.LEADERBOARD(gameType, seasonId);
  }

  /**
   * 从Redis获取用户统计
   */
  private async getUserStatsFromRedis(
    userId: number,
    gameType: string,
  ): Promise<{
    gamesPlayed: number;
    gamesWon: number;
    winRate: number;
    currentRating: number;
    highestRating: number;
    bestStreak: number;
    currentStreak: number;
    totalPlayTime: number;
  } | null> {
    const statsKey = REDIS_KEY.USER_STATS(userId, gameType);
    const stats = await this.redis.hgetall(statsKey);

    if (!stats || Object.keys(stats).length === 0) {
      return null;
    }

    const highestKey = REDIS_KEY.USER_HIGHEST(userId, gameType);
    const highest = await this.redis.get(highestKey);

    const streakKey = REDIS_KEY.USER_STREAK(userId, gameType);
    const currentStreak = await this.redis.get(streakKey);

    return {
      gamesPlayed: parseInt(stats.gamesPlayed || '0', 10),
      gamesWon: parseInt(stats.gamesWon || '0', 10),
      winRate: parseFloat(stats.winRate || '0'),
      currentRating: parseInt(stats.currentRating || '1000', 10),
      highestRating: highest ? parseInt(highest, 10) : parseInt(stats.currentRating || '1000', 10),
      bestStreak: parseInt(stats.bestStreak || '0', 10),
      currentStreak: currentStreak ? parseInt(currentStreak, 10) : 0,
      totalPlayTime: parseInt(stats.totalPlayTime || '0', 10),
    };
  }

  /**
   * 获取用户信息
   */
  private async getUserInfo(userId: number): Promise<User | null> {
    try {
      const user = await this.userRepo.findOne({
        where: { user_id: String(userId) },
      });
      return user || null;
    } catch (err) {
      this.logger.error(`Failed to get user info: ${err.message}`);
      return null;
    }
  }

  /**
   * 格式化日期key (YYYY-MM-DD)
   */
  private formatDateKey(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * 格式化月份key (YYYY-MM)
   */
  private formatMonthKey(date: Date): string {
    return date.toISOString().slice(0, 7);
  }

  /**
   * 获取周key (YYYY-Wxx)
   */
  private getWeekKey(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  /**
   * 模块销毁时关闭Redis连接
   */
  onModuleDestroy(): void {
    if (this.redis) {
      this.redis.disconnect();
      this.logger.log('LeaderboardService Redis connection closed');
    }
  }
}
