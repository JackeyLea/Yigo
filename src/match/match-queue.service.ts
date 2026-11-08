import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { MatchEngineService, QueuedPlayer, MatchedPlayer, MatchCriteria } from './match-engine.service';
import { RoomService } from '../room/room.service';
import { UserService } from '../user/user.service';
import { EventBus } from '../plugin/event-bus';
import { LeaderboardEntry } from '../common/entities/leaderboard-entry.entity';

/**
 * 匹配票状态
 */
export type MatchTicketStatus =
  | 'queued'
  | 'matched'
  | 'accepted'
  | 'rejected'
  | 'timeout'
  | 'cancelled';

/**
 * 匹配状态响应
 */
export interface MatchStatus {
  ticketId: string;
  status: MatchTicketStatus;
  matchedPlayers?: MatchedPlayer[];
  roomId?: string;
  elapsedTime: number;
  estimatedWait: number;
}

/**
 * Redis键前缀常量
 */
const REDIS_KEY = {
  // 匹配队列 Sorted Set: score=ELO评分, member=ticketId
  QUEUE: (pluginId: string) => `match:queue:${pluginId}`,
  // 匹配票 Hash: 存储完整的匹配票信息
  TICKET: (ticketId: string) => `match:ticket:${ticketId}`,
  // 匹配状态 Key-Value: TTL 120秒
  STATUS: (ticketId: string) => `match:status:${ticketId}`,
  // 用户当前匹配票
  USER_TICKET: (userId: number) => `match:user:${userId}`,
  // 匹配结果（房间ID）
  RESULT: (ticketId: string) => `match:result:${ticketId}`,
  // 已接受的匹配
  ACCEPTED: (ticketId: string) => `match:accepted:${ticketId}`,
};

/**
 * 匹配票在Redis中的存储结构
 */
interface MatchTicketData {
  userId: string;
  ticketId: string;
  pluginId: string;
  rating: string;
  joinTime: string;
  criteria: string; // JSON序列化的MatchCriteria
  status: MatchTicketStatus;
}

/**
 * MatchQueueService - 匹配队列核心服务
 *
 * 基于Redis Sorted Set实现的ELO匹配队列：
 * - 队列: Redis Sorted Set (score=ELO评分, member=ticketId)
 * - 匹配票: Redis Hash (包含用户ID、ELO、加入时间、条件等)
 * - 匹配状态: Redis Key-Value (TTL 120秒)
 */
@Injectable()
export class MatchQueueService {
  private readonly logger = new Logger(MatchQueueService.name);
  private readonly redis: Redis;

  // 默认最大等待时间（毫秒）
  private readonly DEFAULT_MAX_WAIT_TIME_MS = 60 * 1000;
  // 匹配状态TTL（秒）
  private readonly STATUS_TTL_SECONDS = 120;
  // 匹配结果TTL（秒）
  private readonly RESULT_TTL_SECONDS = 300;

  constructor(
    private readonly configService: ConfigService,
    private readonly matchEngine: MatchEngineService,
    private readonly roomService: RoomService,
    private readonly userService: UserService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(LeaderboardEntry)
    private readonly leaderboardRepository: Repository<LeaderboardEntry>,
    private readonly eventBus: EventBus,
  ) {
    const redisConfig = this.configService.get('redis');
    this.redis = new Redis({
      host: redisConfig?.host || 'localhost',
      port: redisConfig?.port || 6379,
      password: redisConfig?.password || undefined,
      db: redisConfig?.db || 0,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error:', err.message);
    });
  }

  // ==================== 加入队列 ====================

  /**
   * 加入匹配队列
   * @param userId 用户ID
   * @param pluginId 游戏插件ID
   * @param criteria 匹配条件
   * @returns 匹配票ID
   */
  async enqueue(
    userId: number,
    pluginId: string,
    criteria: MatchCriteria,
  ): Promise<string> {
    // 检查用户是否已在队列中
    const existingTicket = await this.redis.get(REDIS_KEY.USER_TICKET(userId));
    if (existingTicket) {
      const existingStatus = await this.getMatchStatus(existingTicket);
      if (existingStatus && existingStatus.status === 'queued') {
        throw new ConflictException('用户已在匹配队列中');
      }
      if (existingStatus && existingStatus.status === 'matched') {
        throw new ConflictException('用户已匹配成功，等待接受');
      }
    }

    // 获取用户ELO评分
    const rating = await this.getUserRating(userId, pluginId);

    // 生成票号
    const ticketId = `TKT-${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`;
    const joinTime = Date.now();

    // 构建匹配票数据
    const ticketData: MatchTicketData = {
      userId: String(userId),
      ticketId,
      pluginId,
      rating: String(rating),
      joinTime: String(joinTime),
      criteria: JSON.stringify(criteria),
      status: 'queued',
    };

    // 将匹配票存入Hash
    await this.redis.hmset(REDIS_KEY.TICKET(ticketId), ticketData as any);

    // 将用户加入Sorted Set队列（score=ELO评分）
    await this.redis.zadd(REDIS_KEY.QUEUE(pluginId), rating, ticketId);

    // 记录用户当前匹配票
    await this.redis.setex(
      REDIS_KEY.USER_TICKET(userId),
      (criteria.maxWaitTime || 60) + this.STATUS_TTL_SECONDS,
      ticketId,
    );

    this.logger.log(
      `User ${userId} enqueued for plugin ${pluginId} with rating ${rating}, ticket=${ticketId}`,
    );

    return ticketId;
  }

  // ==================== 取消匹配 ====================

  /**
   * 取消匹配（从队列中移除）
   * @param userId 用户ID
   * @param ticketId 匹配票ID
   */
  async dequeue(userId: number, ticketId: string): Promise<void> {
    const ticketKey = REDIS_KEY.TICKET(ticketId);
    const ticketData = await this.redis.hgetall(ticketKey);

    if (!ticketData || !ticketData.userId) {
      throw new NotFoundException('匹配票不存在');
    }

    if (Number(ticketData.userId) !== userId) {
      throw new BadRequestException('无权取消他人的匹配');
    }

    const status = ticketData.status as MatchTicketStatus;

    // 如果已匹配但未接受，释放其他玩家的匹配
    if (status === 'matched') {
      await this.releaseMatchedPlayers(ticketId);
    }

    // 如果已接受，不能取消
    if (status === 'accepted') {
      throw new BadRequestException('匹配已接受，无法取消');
    }

    // 从队列中移除
    await this.redis.zrem(REDIS_KEY.QUEUE(ticketData.pluginId), ticketId);

    // 更新票状态为已取消
    await this.redis.hset(ticketKey, 'status', 'cancelled');
    await this.redis.expire(ticketKey, this.STATUS_TTL_SECONDS);

    // 清除用户票记录
    await this.redis.del(REDIS_KEY.USER_TICKET(userId));

    // 发布状态更新
    await this.publishStatusUpdate(ticketId, 'cancelled');

    this.logger.log(`User ${userId} cancelled match ${ticketId}`);
  }

  // ==================== 匹配状态查询 ====================

  /**
   * 获取匹配状态
   * @param ticketId 匹配票ID
   * @returns 匹配状态
   */
  async getMatchStatus(ticketId: string): Promise<MatchStatus | null> {
    // 先尝试从状态Key获取
    const statusJson = await this.redis.get(REDIS_KEY.STATUS(ticketId));
    if (statusJson) {
      return JSON.parse(statusJson) as MatchStatus;
    }

    // 回退到票Hash
    const ticketKey = REDIS_KEY.TICKET(ticketId);
    const ticketData = await this.redis.hgetall(ticketKey);

    if (!ticketData || !ticketData.userId) {
      return null;
    }

    const joinTime = Number(ticketData.joinTime);
    const elapsedTime = Date.now() - joinTime;
    const criteria: MatchCriteria = JSON.parse(ticketData.criteria || '{}');

    // 估算等待时间
    const estimatedWait = await this.estimateWaitTime(
      Number(ticketData.rating),
      ticketData.pluginId,
      criteria,
    );

    const status: MatchStatus = {
      ticketId,
      status: ticketData.status as MatchTicketStatus,
      elapsedTime: Math.floor(elapsedTime / 1000),
      estimatedWait,
    };

    // 如果已匹配，获取匹配结果
    if (ticketData.status === 'matched' || ticketData.status === 'accepted') {
      const resultJson = await this.redis.get(REDIS_KEY.RESULT(ticketId));
      if (resultJson) {
        const result = JSON.parse(resultJson);
        status.matchedPlayers = result.matchedPlayers;
        status.roomId = result.roomId;
      }
    }

    return status;
  }

  // ==================== 执行匹配 ====================

  /**
   * 执行匹配（定时任务触发）
   * 按pluginId分别处理匹配
   * @param pluginId 游戏插件ID
   */
  async processMatch(pluginId: string): Promise<void> {
    const queueKey = REDIS_KEY.QUEUE(pluginId);

    // 获取队列中所有等待的玩家（按ELO排序）
    const ticketIds = await this.redis.zrange(queueKey, 0, -1);

    if (ticketIds.length === 0) {
      return;
    }

    this.logger.debug(`Processing match for ${pluginId}, ${ticketIds.length} players in queue`);

    // 获取所有匹配票详情
    const players: QueuedPlayer[] = [];
    for (const ticketId of ticketIds) {
      const ticketData = await this.redis.hgetall(REDIS_KEY.TICKET(ticketId));
      if (!ticketData || !ticketData.userId) {
        // 清理无效票
        await this.redis.zrem(queueKey, ticketId);
        continue;
      }

      // 跳过已匹配或已取消的票
      if (ticketData.status !== 'queued') {
        continue;
      }

      players.push({
        userId: Number(ticketData.userId),
        ticketId,
        rating: Number(ticketData.rating),
        joinTime: Number(ticketData.joinTime),
        criteria: JSON.parse(ticketData.criteria || '{}'),
        pluginId: ticketData.pluginId,
      });
    }

    if (players.length < 2) {
      return;
    }

    // 确定组大小（默认为2）
    const groupSize = this.matchEngine.getRecommendedGroupSize(players[0].criteria);

    // 执行贪心匹配
    const matchedGroups = this.matchEngine.greedyMatch(players, groupSize);

    for (const group of matchedGroups) {
      await this.handleMatchedGroup(group);
    }

    this.logger.log(
      `Match processed for ${pluginId}: ${matchedGroups.length} groups matched from ${players.length} players`,
    );
  }

  // ==================== 接受/拒绝匹配 ====================

  /**
   * 接受匹配
   * @param ticketId 匹配票ID
   */
  async acceptMatch(ticketId: string): Promise<void> {
    const ticketKey = REDIS_KEY.TICKET(ticketId);
    const ticketData = await this.redis.hgetall(ticketKey);

    if (!ticketData || !ticketData.userId) {
      throw new NotFoundException('匹配票不存在');
    }

    if (ticketData.status !== 'matched') {
      throw new BadRequestException(`当前状态为 ${ticketData.status}，无法接受匹配`);
    }

    // 更新状态为已接受
    await this.redis.hset(ticketKey, 'status', 'accepted');

    // 记录接受
    const acceptedKey = REDIS_KEY.ACCEPTED(ticketId);
    await this.redis.setex(acceptedKey, this.STATUS_TTL_SECONDS, '1');

    // 检查所有玩家是否都已接受
    const resultJson = await this.redis.get(REDIS_KEY.RESULT(ticketId));
    if (resultJson) {
      const result = JSON.parse(resultJson);
      const allAccepted = await this.checkAllPlayersAccepted(
        result.matchedPlayers.map((p: MatchedPlayer) => p.ticketId),
      );

      if (allAccepted) {
        // 所有玩家已接受，创建房间
        await this.createRoomForMatch(result.matchedPlayers, ticketData.pluginId);
      }
    }

    await this.publishStatusUpdate(ticketId, 'accepted');
    this.logger.log(`Match ${ticketId} accepted by user ${ticketData.userId}`);
  }

  /**
   * 拒绝匹配
   * @param ticketId 匹配票ID
   */
  async rejectMatch(ticketId: string): Promise<void> {
    const ticketKey = REDIS_KEY.TICKET(ticketId);
    const ticketData = await this.redis.hgetall(ticketKey);

    if (!ticketData || !ticketData.userId) {
      throw new NotFoundException('匹配票不存在');
    }

    if (ticketData.status !== 'matched') {
      throw new BadRequestException(`当前状态为 ${ticketData.status}，无法拒绝匹配`);
    }

    const userId = Number(ticketData.userId);

    // 释放其他匹配玩家
    await this.releaseMatchedPlayers(ticketId);

    // 更新状态为已拒绝
    await this.redis.hset(ticketKey, 'status', 'rejected');
    await this.redis.expire(ticketKey, this.STATUS_TTL_SECONDS);

    // 从队列中移除
    await this.redis.zrem(REDIS_KEY.QUEUE(ticketData.pluginId), ticketId);

    // 清除用户票记录
    await this.redis.del(REDIS_KEY.USER_TICKET(userId));

    await this.publishStatusUpdate(ticketId, 'rejected');
    this.logger.log(`Match ${ticketId} rejected by user ${userId}`);
  }

  // ==================== 超时处理 ====================

  /**
   * 处理超时匹配票
   * @param pluginId 游戏插件ID
   */
  async handleTimeouts(pluginId: string): Promise<void> {
    const queueKey = REDIS_KEY.QUEUE(pluginId);
    const ticketIds = await this.redis.zrange(queueKey, 0, -1);
    const now = Date.now();

    for (const ticketId of ticketIds) {
      const ticketData = await this.redis.hgetall(REDIS_KEY.TICKET(ticketId));
      if (!ticketData || !ticketData.userId) {
        await this.redis.zrem(queueKey, ticketId);
        continue;
      }

      const criteria: MatchCriteria = JSON.parse(ticketData.criteria || '{}');
      const maxWaitTime = (criteria.maxWaitTime || 60) * 1000; // 转换为毫秒
      const joinTime = Number(ticketData.joinTime);
      const waitTime = now - joinTime;

      // 如果还在排队且已超时
      if (ticketData.status === 'queued' && waitTime >= maxWaitTime) {
        const userId = Number(ticketData.userId);

        if (criteria.allowAI) {
          // 为超时的单人匹配填充AI
          await this.fillWithAI(ticketData as unknown as MatchTicketData, criteria);
        } else {
          // 不允许AI，标记为超时
          await this.redis.hset(REDIS_KEY.TICKET(ticketId), 'status', 'timeout');
          await this.redis.expire(REDIS_KEY.TICKET(ticketId), this.STATUS_TTL_SECONDS);
          await this.redis.zrem(queueKey, ticketId);
          await this.redis.del(REDIS_KEY.USER_TICKET(userId));
          await this.publishStatusUpdate(ticketId, 'timeout');

          this.logger.log(`Match ${ticketId} timed out for user ${userId}`);
        }
      }
    }
  }

  /**
   * 清理已取消的匹配票
   */
  async cleanupCancelledTickets(): Promise<void> {
    // 扫描所有匹配票（使用SCAN避免阻塞）
    const stream = this.redis.scanStream({
      match: 'match:ticket:*',
      count: 100,
    });

    stream.on('data', async (keys: string[]) => {
      for (const key of keys) {
        const ticketData = await this.redis.hgetall(key);
        if (ticketData.status === 'cancelled' || ticketData.status === 'rejected') {
          // 检查是否已过期（状态保留STATUS_TTL_SECONDS秒）
          const ttl = await this.redis.ttl(key);
          if (ttl < 0) {
            // 没有TTL，设置一个短的过期时间
            await this.redis.expire(key, 60);
          }
        }
      }
    });
  }

  // ==================== 内部方法 ====================

  /**
   * 获取用户ELO评分
   * @param userId 用户ID
   * @param pluginId 游戏插件ID
   * @returns ELO评分
   */
  private async getUserRating(userId: number, pluginId: string): Promise<number> {
    try {
      // 从排行榜表查询评分
      const entry = await this.leaderboardRepository.findOne({
        where: {
          user_id: String(userId),
          plugin_id: pluginId,
          season_id: 'all_time',
        },
      });

      if (entry) {
        return entry.rating_score;
      }

      // 如果没有记录，返回默认评分1000
      return 1000;
    } catch (error) {
      this.logger.warn(`Failed to get rating for user ${userId}: ${error.message}`);
      return 1000;
    }
  }

  /**
   * 处理匹配成功的分组
   * @param group 匹配分组
   */
  private async handleMatchedGroup(group: {
    players: MatchedPlayer[];
    matchScore: number;
    pluginId: string;
    mode: string;
  }): Promise<void> {
    const { players, pluginId, mode } = group;

    // 更新每个玩家的票状态为已匹配
    for (const player of players) {
      const ticketKey = REDIS_KEY.TICKET(player.ticketId);

      // 更新状态
      await this.redis.hset(ticketKey, 'status', 'matched');

      // 从队列中移除
      await this.redis.zrem(REDIS_KEY.QUEUE(pluginId), player.ticketId);

      // 存储匹配结果
      const result = {
        matchedPlayers: players,
        roomId: null, // 房间ID等所有玩家接受后创建
        pluginId,
        mode,
      };
      await this.redis.setex(
        REDIS_KEY.RESULT(player.ticketId),
        this.RESULT_TTL_SECONDS,
        JSON.stringify(result),
      );

      // 发布状态更新
      await this.publishStatusUpdate(player.ticketId, 'matched', {
        matchedPlayers: players,
        pluginId,
        mode,
      });

      // 通知玩家
      this.eventBus.publishToPlayer(String(player.userId), 'match.found', {
        ticketId: player.ticketId,
        matchedPlayers: players.map((p) => ({
          userId: p.userId,
          rating: p.rating,
          isAI: p.isAI || false,
        })),
        pluginId,
        mode,
      });
    }

    this.logger.log(
      `Group matched: ${players.map((p) => `${p.userId}(ELO:${p.rating})`).join(', ')} ` +
      `for plugin ${pluginId}`,
    );
  }

  /**
   * 检查所有匹配玩家是否都已接受
   * @param ticketIds 所有玩家的票ID
   * @returns 是否全部接受
   */
  private async checkAllPlayersAccepted(ticketIds: string[]): Promise<boolean> {
    for (const ticketId of ticketIds) {
      const accepted = await this.redis.get(REDIS_KEY.ACCEPTED(ticketId));
      if (!accepted) {
        return false;
      }
    }
    return true;
  }

  /**
   * 为匹配成功的玩家创建房间
   * @param players 匹配的玩家
   * @param pluginId 游戏插件ID
   */
  private async createRoomForMatch(
    players: MatchedPlayer[],
    pluginId: string,
  ): Promise<void> {
    try {
      // 取第一个真人玩家作为房主
      const hostPlayer = players.find((p) => !p.isAI);
      if (!hostPlayer) {
        this.logger.error('Cannot create room with only AI players');
        return;
      }

      // 创建房间
      const room = await this.roomService.createRoom(hostPlayer.userId, {
        pluginId,
        maxPlayers: players.length,
        mode: 'normal',
      });

      // 其他玩家加入房间
      for (const player of players) {
        if (player.userId !== hostPlayer.userId && !player.isAI) {
          await this.roomService.joinRoom(player.userId, {
            roomId: room.roomId,
          });
        }
      }

      // 更新所有玩家的匹配结果为包含房间ID
      for (const player of players) {
        const resultKey = REDIS_KEY.RESULT(player.ticketId);
        const resultJson = await this.redis.get(resultKey);
        if (resultJson) {
          const result = JSON.parse(resultJson);
          result.roomId = room.roomId;
          await this.redis.setex(resultKey, this.RESULT_TTL_SECONDS, JSON.stringify(result));
        }

        // 更新票状态并设置过期时间
        await this.redis.hset(REDIS_KEY.TICKET(player.ticketId), 'status', 'accepted');
        await this.redis.expire(REDIS_KEY.TICKET(player.ticketId), this.STATUS_TTL_SECONDS);

        // 清除用户票记录
        await this.redis.del(REDIS_KEY.USER_TICKET(player.userId));

        // 通知玩家
        this.eventBus.publishToPlayer(String(player.userId), 'match.room_ready', {
          ticketId: player.ticketId,
          roomId: room.roomId,
          pluginId,
        });
      }

      this.logger.log(`Room ${room.roomId} created for matched players`);
    } catch (error) {
      this.logger.error(`Failed to create room for match: ${error.message}`);
    }
  }

  /**
   * 释放匹配中的其他玩家
   * @param ticketId 当前玩家的票ID
   */
  private async releaseMatchedPlayers(ticketId: string): Promise<void> {
    const resultJson = await this.redis.get(REDIS_KEY.RESULT(ticketId));
    if (!resultJson) {
      return;
    }

    const result = JSON.parse(resultJson);
    const matchedPlayers: MatchedPlayer[] = result.matchedPlayers || [];

    for (const player of matchedPlayers) {
      if (player.ticketId === ticketId) {
        continue;
      }

      // 将其他玩家重新放回队列
      const playerTicket = await this.redis.hgetall(REDIS_KEY.TICKET(player.ticketId));
      if (playerTicket && playerTicket.status === 'matched') {
        // 恢复为排队状态
        await this.redis.hset(REDIS_KEY.TICKET(player.ticketId), 'status', 'queued');

        // 重新加入队列
        const rating = Number(playerTicket.rating);
        await this.redis.zadd(REDIS_KEY.QUEUE(playerTicket.pluginId), rating, player.ticketId);

        // 清除匹配结果
        await this.redis.del(REDIS_KEY.RESULT(player.ticketId));
        await this.redis.del(REDIS_KEY.ACCEPTED(player.ticketId));

        // 通知玩家匹配被取消
        this.eventBus.publishToPlayer(String(player.userId), 'match.cancelled', {
          ticketId: player.ticketId,
          reason: '对手拒绝了匹配',
        });

        this.logger.debug(`Player ${player.userId} re-queued after match rejection`);
      }
    }
  }

  /**
   * 为超时的单人匹配填充AI
   * @param ticketData 匹配票数据
   * @param criteria 匹配条件
   */
  private async fillWithAI(
    ticketData: MatchTicketData,
    criteria: MatchCriteria,
  ): Promise<void> {
    const { userId, ticketId, pluginId, rating } = ticketData;

    const aiDifficulty = criteria.aiDifficulty || 'medium';
    const maxPlayers = criteria.maxPlayers || 2;
    const aiCount = maxPlayers - 1;

    // 创建AI玩家
    const aiPlayers = this.matchEngine.createAIPlayers(
      Number(rating),
      ticketId,
      aiDifficulty,
      aiCount,
    );

    const humanPlayer: MatchedPlayer = {
      userId: Number(userId),
      ticketId,
      rating: Number(rating),
      isAI: false,
    };

    const allPlayers = [humanPlayer, ...aiPlayers];

    // 更新状态为已匹配（AI自动接受）
    await this.redis.hset(REDIS_KEY.TICKET(ticketId), 'status', 'matched');

    // 存储匹配结果
    const result = {
      matchedPlayers: allPlayers,
      roomId: null,
      pluginId,
      mode: criteria.mode || 'normal',
    };
    await this.redis.setex(
      REDIS_KEY.RESULT(ticketId),
      this.RESULT_TTL_SECONDS,
      JSON.stringify(result),
    );

    // AI自动接受
    await this.redis.setex(REDIS_KEY.ACCEPTED(ticketId), this.STATUS_TTL_SECONDS, '1');
    for (const ai of aiPlayers) {
      await this.redis.setex(
        REDIS_KEY.ACCEPTED(ai.ticketId),
        this.STATUS_TTL_SECONDS,
        '1',
      );
    }

    // 直接创建房间（因为AI自动接受）
    await this.createRoomForMatch(allPlayers, pluginId);

    // 发布状态更新
    await this.publishStatusUpdate(ticketId, 'matched', {
      matchedPlayers: allPlayers,
      pluginId,
      mode: criteria.mode || 'normal',
    });

    this.logger.log(
      `Match ${ticketId} filled with ${aiCount} AI (difficulty: ${aiDifficulty})`,
    );
  }

  /**
   * 发布状态更新
   * @param ticketId 票ID
   * @param status 新状态
   * @param extra 额外数据
   */
  private async publishStatusUpdate(
    ticketId: string,
    status: MatchTicketStatus,
    extra?: Record<string, any>,
  ): Promise<void> {
    const ticketData = await this.redis.hgetall(REDIS_KEY.TICKET(ticketId));
    if (!ticketData || !ticketData.joinTime) {
      return;
    }

    const joinTime = Number(ticketData.joinTime);
    const elapsedTime = Math.floor((Date.now() - joinTime) / 1000);
    const criteria: MatchCriteria = JSON.parse(ticketData.criteria || '{}');

    const matchStatus: MatchStatus = {
      ticketId,
      status,
      elapsedTime,
      estimatedWait: await this.estimateWaitTime(
        Number(ticketData.rating),
        ticketData.pluginId,
        criteria,
      ),
      ...extra,
    };

    await this.redis.setex(
      REDIS_KEY.STATUS(ticketId),
      this.STATUS_TTL_SECONDS,
      JSON.stringify(matchStatus),
    );
  }

  /**
   * 估算等待时间
   * @param rating ELO评分
   * @param pluginId 游戏插件ID
   * @param criteria 匹配条件
   * @returns 估算等待时间（秒）
   */
  private async estimateWaitTime(
    rating: number,
    pluginId: string,
    criteria: MatchCriteria,
  ): Promise<number> {
    try {
      const queueKey = REDIS_KEY.QUEUE(pluginId);
      const queueSize = await this.redis.zcard(queueKey);

      if (queueSize === 0) {
        return 30; // 默认估算
      }

      const ratingRange = criteria.ratingRange || 200;

      // 计算在评分范围内的玩家数
      const nearbyCount = await this.redis.zcount(
        queueKey,
        rating - ratingRange,
        rating + ratingRange,
      );

      if (nearbyCount >= 2) {
        return 10; // 附近有玩家，预计很快匹配
      } else if (nearbyCount === 1) {
        return 30; // 附近有一名玩家
      } else {
        return 60; // 附近没有玩家，可能需要等待较长时间
      }
    } catch {
      return 30;
    }
  }

  /**
   * 获取队列长度
   * @param pluginId 游戏插件ID
   * @returns 队列中玩家数
   */
  async getQueueLength(pluginId: string): Promise<number> {
    return this.redis.zcard(REDIS_KEY.QUEUE(pluginId));
  }

  /**
   * 获取队列中所有玩家
   * @param pluginId 游戏插件ID
   * @returns 排队玩家列表
   */
  async getQueuePlayers(pluginId: string): Promise<QueuedPlayer[]> {
    const ticketIds = await this.redis.zrange(REDIS_KEY.QUEUE(pluginId), 0, -1, 'WITHSCORES');
    const players: QueuedPlayer[] = [];

    for (let i = 0; i < ticketIds.length; i += 2) {
      const ticketId = ticketIds[i];
      const rating = Number(ticketIds[i + 1]);
      const ticketData = await this.redis.hgetall(REDIS_KEY.TICKET(ticketId));

      if (ticketData && ticketData.userId) {
        players.push({
          userId: Number(ticketData.userId),
          ticketId,
          rating,
          joinTime: Number(ticketData.joinTime),
          criteria: JSON.parse(ticketData.criteria || '{}'),
          pluginId: ticketData.pluginId,
        });
      }
    }

    return players;
  }

  /**
   * 从队列中移除过期的票（内部清理用）
   * @param pluginId 游戏插件ID
   */
  async removeExpiredTickets(pluginId: string): Promise<number> {
    const queueKey = REDIS_KEY.QUEUE(pluginId);
    const ticketIds = await this.redis.zrange(queueKey, 0, -1);
    let removed = 0;

    for (const ticketId of ticketIds) {
      const ticketData = await this.redis.hgetall(REDIS_KEY.TICKET(ticketId));
      if (!ticketData || !ticketData.userId) {
        await this.redis.zrem(queueKey, ticketId);
        removed++;
      }
    }

    return removed;
  }
}
