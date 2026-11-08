/**
 * PenaltyService - 逃跑惩罚服务
 *
 * 管理玩家逃跑行为记录和惩罚体系：
 * - 记录逃跑行为
 * - 信誉分计算（初始100分，逃跑扣10分，完成对局+5分）
 * - 多级惩罚体系
 * - 逃跑历史查询
 * - Redis（24小时TTL）+ PostgreSQL（持久化）双写
 */
import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';

import { EscapeRecord } from './entities/escape-record.entity';

/** 惩罚等级定义 */
export type PenaltyLevel = 0 | 1 | 2 | 3 | 4;

/** 惩罚状态 */
export interface PenaltyStatus {
  canPlay: boolean;
  cooldownSeconds: number;
  reputationScore: number;
  penaltyLevel: PenaltyLevel;
  nextLevelAt: number;       // 下一等级边界分数
  recoverAt: Date | null;    // 恢复时间
  escapeCount24h: number;    // 24小时内逃跑次数
  message: string;
}

/** 惩罚规则配置 */
export interface PenaltyRule {
  minScore: number;
  maxScore: number;
  level: PenaltyLevel;
  label: string;
  matchWaitBonusSeconds: number;  // 匹配等待额外时间
  banDurationSeconds: number;     // 禁止匹配时长
  description: string;
}

/** Redis键前缀 */
const REDIS_KEY = {
  REPUTATION: (userId: number) => `penalty:reputation:${userId}`,
  ESCAPE_COUNT_24H: (userId: number) => `penalty:escape_count:${userId}`,
  BAN_UNTIL: (userId: number, gameType: string) => `penalty:ban:${userId}:${gameType}`,
  MATCH_WAIT_BONUS: (userId: number) => `penalty:wait_bonus:${userId}`,
  ESCAPE_LOCK: (userId: number, roomId: string) => `penalty:lock:${userId}:${roomId}`,
};

/** 惩罚规则表（分数范围与惩罚等级映射） */
const PENALTY_RULES: PenaltyRule[] = [
  {
    minScore: 90, maxScore: 100, level: 0,
    label: '正常', matchWaitBonusSeconds: 0, banDurationSeconds: 0,
    description: '信誉良好，无惩罚',
  },
  {
    minScore: 70, maxScore: 89, level: 1,
    label: '轻度违规', matchWaitBonusSeconds: 30, banDurationSeconds: 0,
    description: '匹配等待时间+30秒',
  },
  {
    minScore: 50, maxScore: 69, level: 2,
    label: '中度违规', matchWaitBonusSeconds: 30, banDurationSeconds: 300,
    description: '5分钟内禁止匹配',
  },
  {
    minScore: 30, maxScore: 49, level: 3,
    label: '重度违规', matchWaitBonusSeconds: 30, banDurationSeconds: 1800,
    description: '30分钟内禁止匹配',
  },
  {
    minScore: 0, maxScore: 29, level: 4,
    label: '严重违规', matchWaitBonusSeconds: 0, banDurationSeconds: 86400,
    description: '24小时内禁止匹配',
  },
];

/** 默认信誉分 */
const DEFAULT_REPUTATION_SCORE = 100;
/** 每次逃跑扣分 */
const ESCAPE_SCORE_DEDUCT = 10;
/** 完成对局加分 */
const COMPLETE_SCORE_RECOVER = 5;
/** 最大信誉分 */
const MAX_REPUTATION_SCORE = 100;
/** Redis逃跑记录TTL（秒）- 24小时 */
const ESCAPE_REDIS_TTL_SECONDS = 86400;

@Injectable()
export class PenaltyService {
  private readonly logger = new Logger(PenaltyService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(EscapeRecord)
    private readonly escapeRecordRepository: Repository<EscapeRecord>,
    private readonly configService: ConfigService,
  ) {
    // 初始化Redis连接
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

  // ==================== 核心方法 ====================

  /**
   * 记录逃跑行为
   * - 写入PostgreSQL持久化
   * - 更新Redis信誉分（带TTL）
   * - 更新24小时逃跑计数
   */
  async recordEscape(
    userId: number,
    roomId: string,
    gameType: string,
  ): Promise<void> {
    // 防重复：检查是否已经记录过该房间的逃跑
    const lockKey = REDIS_KEY.ESCAPE_LOCK(userId, roomId);
    const alreadyRecorded = await this.redis.set(
      lockKey, '1', 'EX', 3600, 'NX',
    );
    if (alreadyRecorded === null) {
      this.logger.warn(`Escape already recorded for user ${userId} room ${roomId}`);
      return;
    }

    try {
      // 1. 持久化到PostgreSQL
      const record = this.escapeRecordRepository.create({
        user_id: String(userId),
        room_id: roomId,
        game_type: gameType,
        score_deducted: ESCAPE_SCORE_DEDUCT,
        status: 'active',
        note: null,
      });
      await this.escapeRecordRepository.save(record);

      // 2. 更新Redis信誉分
      const currentScore = await this.getReputationScore(userId);
      const newScore = Math.max(0, currentScore - ESCAPE_SCORE_DEDUCT);
      await this.setReputationScore(userId, newScore);

      // 3. 更新24小时逃跑计数
      await this.incrementEscapeCount24h(userId);

      // 4. 应用惩罚
      await this.applyPenalty(userId, gameType);

      this.logger.warn(
        `Escape recorded: user=${userId}, room=${roomId}, game=${gameType}, ` +
        `score=${currentScore}->${newScore}`,
      );
    } catch (error) {
      this.logger.error(`Failed to record escape for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查惩罚状态
   * - 计算当前信誉分
   * - 确定惩罚等级
   * - 检查是否处于冷却期
   */
  async checkPenalty(userId: number): Promise<PenaltyStatus> {
    const score = await this.getReputationScore(userId);
    const rule = this.getPenaltyRule(score);
    const escapeCount24h = await this.getEscapeCount24h(userId);

    // 检查是否有活跃的禁止匹配记录
    let canPlay = true;
    let cooldownSeconds = 0;
    let recoverAt: Date | null = null;

    if (rule.banDurationSeconds > 0) {
      const banKey = REDIS_KEY.BAN_UNTIL(userId, 'all');
      const now = Math.floor(Date.now() / 1000);
      const banUntilStr = await this.redis.get(banKey);

      if (banUntilStr) {
        const banUntil = parseInt(banUntilStr, 10);
        if (banUntil > now) {
          canPlay = false;
          cooldownSeconds = banUntil - now;
          recoverAt = new Date(banUntil * 1000);
        }
      }

      // 如果没有活跃禁止但信誉分低，应用新的禁止
      if (canPlay && rule.level >= 2) {
        const newBanUntil = now + rule.banDurationSeconds;
        await this.redis.setex(
          banKey,
          rule.banDurationSeconds,
          String(newBanUntil),
        );
        canPlay = false;
        cooldownSeconds = rule.banDurationSeconds;
        recoverAt = new Date(newBanUntil * 1000);
      }
    }

    // 计算下一等级边界
    const nextLevelAt = rule.minScore;

    return {
      canPlay,
      cooldownSeconds,
      reputationScore: score,
      penaltyLevel: rule.level,
      nextLevelAt,
      recoverAt,
      escapeCount24h,
      message: rule.description,
    };
  }

  /**
   * 应用惩罚
   * - 设置匹配等待时间加成
   * - 设置禁止匹配时间（如适用）
   */
  async applyPenalty(userId: number, gameType: string): Promise<void> {
    const score = await this.getReputationScore(userId);
    const rule = this.getPenaltyRule(score);

    // 设置匹配等待加成
    if (rule.matchWaitBonusSeconds > 0) {
      await this.redis.setex(
        REDIS_KEY.MATCH_WAIT_BONUS(userId),
        ESCAPE_REDIS_TTL_SECONDS,
        String(rule.matchWaitBonusSeconds),
      );
    }

    // 设置禁止匹配
    if (rule.banDurationSeconds > 0) {
      const banUntil = Math.floor(Date.now() / 1000) + rule.banDurationSeconds;
      await this.redis.setex(
        REDIS_KEY.BAN_UNTIL(userId, gameType),
        rule.banDurationSeconds,
        String(banUntil),
      );
      await this.redis.setex(
        REDIS_KEY.BAN_UNTIL(userId, 'all'),
        rule.banDurationSeconds,
        String(banUntil),
      );
    }

    this.logger.log(
      `Penalty applied: user=${userId}, game=${gameType}, ` +
      `level=${rule.level}, score=${score}, description=${rule.description}`,
    );
  }

  /**
   * 记录正常完成对局
   * - 恢复信誉分（最多到100）
   * - 清除相关惩罚
   */
  async recordGameComplete(userId: number, gameType: string): Promise<void> {
    const currentScore = await this.getReputationScore(userId);
    const newScore = Math.min(MAX_REPUTATION_SCORE, currentScore + COMPLETE_SCORE_RECOVER);

    if (newScore > currentScore) {
      await this.setReputationScore(userId, newScore);
      this.logger.log(`Score recovered: user=${userId}, ${currentScore} -> ${newScore}`);
    }

    // 如果信誉分恢复到90以上，清除匹配等待加成
    if (newScore >= 90) {
      await this.redis.del(REDIS_KEY.MATCH_WAIT_BONUS(userId));
    }
  }

  /**
   * 获取逃跑历史
   */
  async getEscapeHistory(userId: number): Promise<EscapeRecord[]> {
    return this.escapeRecordRepository.find({
      where: { user_id: String(userId) },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  /**
   * 获取匹配等待加成时间（秒）
   */
  async getMatchWaitBonus(userId: number): Promise<number> {
    const bonusStr = await this.redis.get(REDIS_KEY.MATCH_WAIT_BONUS(userId));
    return bonusStr ? parseInt(bonusStr, 10) : 0;
  }

  /**
   * 获取24小时内逃跑次数
   */
  async getEscapeCount24h(userId: number): Promise<number> {
    const countStr = await this.redis.get(REDIS_KEY.ESCAPE_COUNT_24H(userId));
    return countStr ? parseInt(countStr, 10) : 0;
  }

  // ==================== 管理接口 ====================

  /**
   * 宽恕逃跑记录（管理员）
   * - 恢复扣分
   * - 标记记录为已宽恕
   */
  async forgiveEscape(recordId: number): Promise<void> {
    const record = await this.escapeRecordRepository.findOne({
      where: { id: recordId },
    });

    if (!record) {
      throw new Error(`Escape record ${recordId} not found`);
    }

    if (record.status !== 'active') {
      throw new Error(`Escape record ${recordId} is not active`);
    }

    // 恢复信誉分
    const userId = parseInt(record.user_id, 10);
    const currentScore = await this.getReputationScore(userId);
    const newScore = Math.min(MAX_REPUTATION_SCORE, currentScore + record.score_deducted);
    await this.setReputationScore(userId, newScore);

    // 标记记录为已宽恕
    record.status = 'forgiven';
    record.note = record.note ? `${record.note}; 已宽恕恢复${record.score_deducted}分` : `已宽恕恢复${record.score_deducted}分`;
    await this.escapeRecordRepository.save(record);

    this.logger.log(`Escape record ${recordId} forgiven, score recovered: ${currentScore} -> ${newScore}`);
  }

  /**
   * 获取所有逃跑记录（管理员）
   */
  async getAllEscapes(
    page: number = 1,
    pageSize: number = 50,
    gameType?: string,
  ): Promise<{ items: EscapeRecord[]; total: number; page: number; pageSize: number }> {
    const where: any = {};
    if (gameType) {
      where.game_type = gameType;
    }

    const [items, total] = await this.escapeRecordRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  // ==================== 定时任务 ====================

  /**
   * 每日清理过期记录
   * - 清理7天前的活跃逃跑记录的Redis计数
   * - 注意：PostgreSQL记录保留用于审计
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async dailyCleanup(): Promise<void> {
    this.logger.log('Running daily penalty cleanup...');

    // 清理超过7天的逃跑记录状态
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.escapeRecordRepository.update(
      { created_at: LessThan(sevenDaysAgo), status: 'active' },
      { status: 'expired' },
    );

    this.logger.log(`Penalty cleanup completed: ${result.affected} records expired`);
  }

  // ==================== 私有方法 ====================

  /**
   * 获取信誉分
   */
  private async getReputationScore(userId: number): Promise<number> {
    const scoreStr = await this.redis.get(REDIS_KEY.REPUTATION(userId));
    if (scoreStr === null) {
      // 无记录时返回默认值并初始化
      await this.redis.setex(
        REDIS_KEY.REPUTATION(userId),
        ESCAPE_REDIS_TTL_SECONDS,
        String(DEFAULT_REPUTATION_SCORE),
      );
      return DEFAULT_REPUTATION_SCORE;
    }
    return parseInt(scoreStr, 10);
  }

  /**
   * 设置信誉分
   */
  private async setReputationScore(userId: number, score: number): Promise<void> {
    await this.redis.setex(
      REDIS_KEY.REPUTATION(userId),
      ESCAPE_REDIS_TTL_SECONDS,
      String(score),
    );
  }

  /**
   * 增加24小时逃跑计数
   */
  private async incrementEscapeCount24h(userId: number): Promise<void> {
    const key = REDIS_KEY.ESCAPE_COUNT_24H(userId);
    const exists = await this.redis.exists(key);
    if (exists) {
      await this.redis.incr(key);
    } else {
      await this.redis.setex(key, ESCAPE_REDIS_TTL_SECONDS, '1');
    }
  }

  /**
   * 根据信誉分获取惩罚规则
   */
  private getPenaltyRule(score: number): PenaltyRule {
    for (const rule of PENALTY_RULES) {
      if (score >= rule.minScore && score <= rule.maxScore) {
        return rule;
      }
    }
    // 默认返回最严格的规则
    return PENALTY_RULES[PENALTY_RULES.length - 1];
  }

  /**
   * 服务销毁时清理
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('PenaltyService destroyed');
  }
}
