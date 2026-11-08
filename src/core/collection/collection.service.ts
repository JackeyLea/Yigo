/**
 * CollectionService - 牌谱/棋谱收藏服务
 *
 * 功能包括：
 * - 收藏/取消收藏对局
 * - 收藏列表查询（支持分页和筛选）
 * - 添加/修改备注
 * - 标签管理
 * - 分享功能（生成分享链接）
 * - 查看次数统计
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { CollectedGame } from './entities/collected-game.entity';

/** 分页结果接口 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 收藏对局完整信息（包含对局元数据） */
export interface CollectedGameDetail {
  id: number;
  userId: number;
  recordId: number;
  gameType: string;
  note: string | null;
  tags: string[];
  shareToken: string | null;
  viewCount: number;
  collectedAt: Date;
  // 对局元数据（从关联表获取，此处用可选字段表示）
  gameMeta?: {
    players: string[];
    result: string;
    duration: number;
    playedAt: Date;
  };
}

/** Redis键前缀 */
const REDIS_KEY = {
  SHARE_TOKEN: (token: string) => `collection:share:${token}`,
  COLLECTION_COUNT: (userId: number) => `collection:count:${userId}`,
  POPULAR_TAGS: (gameType: string) => `collection:tags:${gameType}`,
};

/** 默认分页大小 */
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);
  private readonly redis: Redis;
  private readonly shareBaseUrl: string;

  constructor(
    @InjectRepository(CollectedGame)
    private readonly collectedGameRepository: Repository<CollectedGame>,
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

    this.shareBaseUrl = this.configService.get<string>(
      'SHARE_BASE_URL',
      'https://chess.example.com/share',
    );
  }

  // ==================== 核心CRUD ====================

  /**
   * 收藏一局对局
   * - 检查是否已收藏
   * - 创建收藏记录
   * - 更新缓存计数
   */
  async collectGame(
    userId: number,
    recordId: number,
    tags?: string[],
  ): Promise<void> {
    const uid = String(userId);

    // 检查是否已收藏
    const existing = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (existing) {
      throw new ConflictException('该对局已被收藏');
    }

    // 获取游戏类型（实际应该从对局记录表中查询）
    const gameType = await this.getGameTypeFromRecord(recordId);

    const collected = this.collectedGameRepository.create({
      user_id: uid,
      record_id: recordId,
      game_type: gameType,
      note: null,
      tags: tags || [],
      share_token: null,
      view_count: 0,
    });

    await this.collectedGameRepository.save(collected);

    // 清除缓存计数
    await this.redis.del(REDIS_KEY.COLLECTION_COUNT(userId));

    // 更新热门标签
    if (tags && tags.length > 0) {
      await this.updatePopularTags(gameType, tags);
    }

    this.logger.log(`Game collected: user=${userId}, record=${recordId}`);
  }

  /**
   * 取消收藏
   */
  async uncollectGame(userId: number, recordId: number): Promise<void> {
    const uid = String(userId);

    const existing = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (!existing) {
      throw new NotFoundException('收藏记录不存在');
    }

    await this.collectedGameRepository.remove(existing);

    // 清除缓存计数
    await this.redis.del(REDIS_KEY.COLLECTION_COUNT(userId));

    this.logger.log(`Game uncollected: user=${userId}, record=${recordId}`);
  }

  /**
   * 获取收藏列表
   * - 支持分页
   * - 支持按游戏类型筛选
   * - 支持按标签筛选
   */
  async getCollections(
    userId: number,
    page: number = 1,
    pageSize: number = DEFAULT_PAGE_SIZE,
    gameType?: string,
    tags?: string[],
  ): Promise<PaginatedResult<CollectedGameDetail>> {
    const uid = String(userId);

    const where: any = { user_id: uid };

    if (gameType) {
      where.game_type = gameType;
    }

    // 如果指定了标签，使用IN查询
    if (tags && tags.length > 0) {
      // TypeORM的simple-json标签需要特殊处理
      // 这里简化处理：查询后过滤
    }

    const [items, total] = await this.collectedGameRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 转换并过滤
    let details: CollectedGameDetail[] = items.map((item) => this.toDetail(item));

    // 标签过滤（内存中）
    if (tags && tags.length > 0) {
      details = details.filter((d) =>
        d.tags && tags.some((t) => d.tags!.includes(t)),
      );
    }

    return {
      items: details,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取单个收藏详情
   */
  async getCollectionDetail(
    userId: number,
    recordId: number,
  ): Promise<CollectedGameDetail> {
    const uid = String(userId);

    const collected = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (!collected) {
      throw new NotFoundException('收藏记录不存在');
    }

    // 增加查看次数
    collected.view_count += 1;
    await this.collectedGameRepository.save(collected);

    return this.toDetail(collected);
  }

  // ==================== 备注与标签 ====================

  /**
   * 添加/修改备注
   */
  async addNote(
    userId: number,
    recordId: number,
    note: string,
  ): Promise<void> {
    const uid = String(userId);

    const collected = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (!collected) {
      throw new NotFoundException('收藏记录不存在');
    }

    collected.note = note;
    await this.collectedGameRepository.save(collected);

    this.logger.log(`Note added: user=${userId}, record=${recordId}`);
  }

  /**
   * 添加标签
   */
  async addTags(
    userId: number,
    recordId: number,
    tags: string[],
  ): Promise<void> {
    const uid = String(userId);

    const collected = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (!collected) {
      throw new NotFoundException('收藏记录不存在');
    }

    const currentTags = collected.tags || [];
    const newTags = [...new Set([...currentTags, ...tags])];
    collected.tags = newTags;

    await this.collectedGameRepository.save(collected);
    await this.updatePopularTags(collected.game_type, tags);

    this.logger.log(`Tags added: user=${userId}, record=${recordId}, tags=${tags.join(',')}`);
  }

  /**
   * 移除标签
   */
  async removeTags(
    userId: number,
    recordId: number,
    tags: string[],
  ): Promise<void> {
    const uid = String(userId);

    const collected = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (!collected || !collected.tags) {
      throw new NotFoundException('收藏记录不存在或无标签');
    }

    collected.tags = collected.tags.filter((t) => !tags.includes(t));
    await this.collectedGameRepository.save(collected);

    this.logger.log(`Tags removed: user=${userId}, record=${recordId}, tags=${tags.join(',')}`);
  }

  // ==================== 分享功能 ====================

  /**
   * 分享收藏（生成分享链接）
   * - 生成唯一分享token
     * - 存储到Redis（带TTL）
   * - 返回分享链接
   */
  async shareCollection(
    userId: number,
    recordId: number,
  ): Promise<string> {
    const uid = String(userId);

    const collected = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (!collected) {
      throw new NotFoundException('收藏记录不存在');
    }

    // 如果已有分享token，直接返回
    if (collected.share_token) {
      return `${this.shareBaseUrl}/${collected.share_token}`;
    }

    // 生成新的分享token
    const token = this.generateShareToken(userId, recordId);
    collected.share_token = token;
    await this.collectedGameRepository.save(collected);

    // 存储到Redis（7天有效）
    const shareData = {
      userId,
      recordId,
      gameType: collected.game_type,
      createdAt: Date.now(),
    };
    await this.redis.setex(
      REDIS_KEY.SHARE_TOKEN(token),
      7 * 86400,
      JSON.stringify(shareData),
    );

    const shareUrl = `${this.shareBaseUrl}/${token}`;
    this.logger.log(`Share link created: user=${userId}, record=${recordId}, token=${token}`);

    return shareUrl;
  }

  /**
   * 通过分享token获取收藏内容
   */
  async getCollectionByShareToken(token: string): Promise<CollectedGameDetail | null> {
    const shareDataRaw = await this.redis.get(REDIS_KEY.SHARE_TOKEN(token));
    if (!shareDataRaw) {
      return null;
    }

    const shareData = JSON.parse(shareDataRaw);
    return this.getCollectionDetail(shareData.userId, shareData.recordId);
  }

  /**
   * 取消分享
   */
  async revokeShare(userId: number, recordId: number): Promise<void> {
    const uid = String(userId);

    const collected = await this.collectedGameRepository.findOne({
      where: { user_id: uid, record_id: recordId },
    });

    if (!collected || !collected.share_token) {
      return;
    }

    // 删除Redis中的分享数据
    await this.redis.del(REDIS_KEY.SHARE_TOKEN(collected.share_token));

    // 清除token
    collected.share_token = null;
    await this.collectedGameRepository.save(collected);

    this.logger.log(`Share revoked: user=${userId}, record=${recordId}`);
  }

  // ==================== 统计功能 ====================

  /**
   * 获取用户收藏总数
   */
  async getCollectionCount(userId: number): Promise<number> {
    // 先查缓存
    const cached = await this.redis.get(REDIS_KEY.COLLECTION_COUNT(userId));
    if (cached) {
      return parseInt(cached, 10);
    }

    const count = await this.collectedGameRepository.count({
      where: { user_id: String(userId) },
    });

    // 缓存5分钟
    await this.redis.setex(
      REDIS_KEY.COLLECTION_COUNT(userId),
      300,
      String(count),
    );

    return count;
  }

  /**
   * 获取用户收藏的所有标签
   */
  async getUserTags(userId: number): Promise<string[]> {
    const uid = String(userId);

    const collections = await this.collectedGameRepository.find({
      where: { user_id: uid },
      select: ['tags'],
    });

    const tagSet = new Set<string>();
    for (const c of collections) {
      if (c.tags) {
        for (const tag of c.tags) {
          tagSet.add(tag);
        }
      }
    }

    return Array.from(tagSet).sort();
  }

  /**
   * 获取热门标签
   */
  async getPopularTags(gameType?: string, limit: number = 20): Promise<string[]> {
    const key = gameType
      ? REDIS_KEY.POPULAR_TAGS(gameType)
      : 'collection:tags:all';

    // 从Redis获取热门标签（ZSET）
    const tags = await this.redis.zrevrange(key, 0, limit - 1);
    return tags;
  }

  // ==================== 私有方法 ====================

  /**
   * 转换实体为详情对象
   */
  private toDetail(entity: CollectedGame): CollectedGameDetail {
    return {
      id: entity.id,
      userId: parseInt(entity.user_id, 10),
      recordId: entity.record_id,
      gameType: entity.game_type,
      note: entity.note,
      tags: entity.tags || [],
      shareToken: entity.share_token,
      viewCount: entity.view_count,
      collectedAt: entity.created_at,
    };
  }

  /**
   * 从对局记录获取游戏类型
   * 实际应从对局记录表中查询
   */
  private async getGameTypeFromRecord(recordId: number): Promise<string> {
    // TODO: 从对局记录表查询
    // 暂时返回默认值
    return 'chess';
  }

  /**
   * 生成分享token
   */
  private generateShareToken(userId: number, recordId: number): string {
    const random = crypto.randomBytes(16).toString('hex');
    const data = `${userId}:${recordId}:${random}:${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  /**
   * 更新热门标签
   */
  private async updatePopularTags(gameType: string, tags: string[]): Promise<void> {
    const key = REDIS_KEY.POPULAR_TAGS(gameType);
    const pipeline = this.redis.pipeline();

    for (const tag of tags) {
      pipeline.zincrby(key, 1, tag);
    }

    // 设置7天TTL
    pipeline.expire(key, 7 * 86400);

    await pipeline.exec();
  }

  /**
   * 服务销毁时清理
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('CollectionService destroyed');
  }
}
