import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { Plugin, PluginCategory } from '../common/entities/plugin.entity';
import { Announcement } from './entities/announcement.entity';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { GameResponseDto } from './dto/game-response.dto';
import { AnnouncementDto } from './dto/announcement.dto';

/**
 * 分页结果接口
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * LobbyService - 游戏大厅业务逻辑层
 *
 * 负责处理游戏列表、公告、收藏、最近游玩等功能。
 * 在线人数和收藏状态通过Redis管理，游戏基础数据通过PostgreSQL管理。
 */
@Injectable()
export class LobbyService {
  private readonly logger = new Logger(LobbyService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(Plugin)
    private readonly pluginRepository: Repository<Plugin>,
    @InjectRepository(Announcement)
    private readonly announcementRepository: Repository<Announcement>,
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

  /**
   * 获取游戏列表（支持关键词搜索、分类筛选、分页）
   *
   * @param query - 查询参数
   * @param userId - 当前用户ID（可选，用于获取收藏状态）
   * @returns 分页的游戏列表
   */
  async listGames(
    query: ListGamesQueryDto,
    userId?: number,
  ): Promise<PaginatedResult<GameResponseDto>> {
    const { keyword, category, page, pageSize } = query;
    const currentPage = page || 1;
    const currentPageSize = pageSize || 20;

    const qb = this.pluginRepository
      .createQueryBuilder('plugin')
      .where('plugin.is_enabled = :isEnabled', { isEnabled: true });

    // 分类筛选
    if (category) {
      const normalizedCategory = category.toLowerCase().trim();
      if (Object.values(PluginCategory).includes(normalizedCategory as PluginCategory)) {
        qb.andWhere('plugin.category = :category', {
          category: normalizedCategory as PluginCategory,
        });
      }
    }

    // 关键词搜索（plugin_id 和 name 字段模糊匹配）
    if (keyword && keyword.trim().length > 0) {
      const trimmedKeyword = keyword.trim();
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('plugin.plugin_id ILIKE :keyword', {
              keyword: `%${trimmedKeyword}%`,
            })
            .orWhere('plugin.name ILIKE :keyword', {
              keyword: `%${trimmedKeyword}%`,
            });
        }),
      );
    }

    // 获取总数
    const total = await qb.getCount();

    // 分页查询
    const plugins = await qb
      .skip((currentPage - 1) * currentPageSize)
      .take(currentPageSize)
      .orderBy('plugin.name', 'ASC')
      .getMany();

    // 并行获取扩展数据（在线人数、房间数、收藏状态、最近游玩）
    const items = await Promise.all(
      plugins.map((plugin) =>
        this.enrichGameData(plugin, userId),
      ),
    );

    return {
      items,
      total,
      page: currentPage,
      pageSize: currentPageSize,
      totalPages: Math.ceil(total / currentPageSize),
    };
  }

  /**
   * 获取游戏详情
   *
   * @param pluginId - 插件ID
   * @param userId - 当前用户ID（可选）
   * @returns 游戏详情
   * @throws NotFoundException 当游戏不存在时
   */
  async getGameDetail(
    pluginId: string,
    userId?: number,
  ): Promise<GameResponseDto> {
    const plugin = await this.pluginRepository.findOne({
      where: { plugin_id: pluginId },
    });

    if (!plugin) {
      throw new NotFoundException(`游戏 '${pluginId}' 不存在`);
    }

    return this.enrichGameData(plugin, userId);
  }

  /**
   * 获取在线人数（从Redis Hash结构读取）
   *
   * Redis键格式: online:{pluginId}
   * 数据结构: Hash，field为用户ID，value为用户在线信息
   *
   * @param pluginId - 插件ID
   * @returns 在线人数
   */
  async getOnlineCount(pluginId: string): Promise<number> {
    try {
      const count = await this.redis.hlen(`online:${pluginId}`);
      return count;
    } catch (error) {
      this.logger.warn(
        `Failed to get online count for plugin ${pluginId}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * 获取有效公告列表
   *
   * 只返回当前时间在start_time和end_time之间、且is_enabled=true的公告
   * 按priority降序、start_time升序排列
   *
   * @returns 公告列表
   */
  async getAnnouncements(): Promise<AnnouncementDto[]> {
    const now = new Date();

    const announcements = await this.announcementRepository
      .createQueryBuilder('announcement')
      .where('announcement.is_enabled = :isEnabled', { isEnabled: true })
      .andWhere('announcement.start_time <= :now', { now })
      .andWhere('announcement.end_time >= :now', { now })
      .orderBy('announcement.priority', 'DESC')
      .addOrderBy('announcement.start_time', 'ASC')
      .getMany();

    return announcements.map((a) => this.mapAnnouncementToDto(a));
  }

  /**
   * 获取用户收藏的游戏ID列表
   *
   * Redis键格式: favorites:{userId}
   * 数据结构: Set，存储用户收藏的pluginId
   *
   * @param userId - 用户ID
   * @returns 收藏的游戏ID列表
   */
  async getFavorites(userId: number): Promise<string[]> {
    try {
      const favorites = await this.redis.smembers(`favorites:${userId}`);
      return favorites;
    } catch (error) {
      this.logger.warn(
        `Failed to get favorites for user ${userId}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * 切换收藏状态
   *
   * 如果游戏已在收藏中则移除，否则添加收藏
   *
   * @param userId - 用户ID
   * @param pluginId - 插件ID
   * @returns 操作后的收藏状态（true=已收藏，false=未收藏）
   */
  async toggleFavorite(
    userId: number,
    pluginId: string,
  ): Promise<boolean> {
    try {
      const key = `favorites:${userId}`;
      const isMember = await this.redis.sismember(key, pluginId);

      if (isMember) {
        await this.redis.srem(key, pluginId);
        this.logger.debug(
          `User ${userId} removed favorite: ${pluginId}`,
        );
        return false;
      } else {
        await this.redis.sadd(key, pluginId);
        this.logger.debug(
          `User ${userId} added favorite: ${pluginId}`,
        );
        return true;
      }
    } catch (error) {
      this.logger.error(
        `Failed to toggle favorite for user ${userId}, plugin ${pluginId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 获取最近游玩的游戏列表
   *
   * Redis键格式: recent:{userId}
   * 数据结构: Sorted Set，score为时间戳，member为pluginId
   *
   * @param userId - 用户ID
   * @param limit - 返回数量限制，默认10
   * @returns 最近游玩的游戏列表
   */
  async getRecentGames(
    userId: number,
    limit: number = 10,
  ): Promise<GameResponseDto[]> {
    try {
      const recentEntries = await this.redis.zrevrange(
        `recent:${userId}`,
        0,
        limit - 1,
        'WITHSCORES',
      );

      if (!recentEntries || recentEntries.length === 0) {
        return [];
      }

      // 解析Sorted Set结果，获取pluginId和对应的score（时间戳）
      const recentMap = new Map<string, number>();
      for (let i = 0; i < recentEntries.length; i += 2) {
        const pluginId = recentEntries[i];
        const score = parseInt(recentEntries[i + 1], 10);
        recentMap.set(pluginId, score);
      }

      const pluginIds = Array.from(recentMap.keys());

      // 查询数据库获取游戏信息
      const plugins = await this.pluginRepository
        .createQueryBuilder('plugin')
        .where('plugin.plugin_id IN (:...pluginIds)', { pluginIds })
        .getMany();

      // 按最近游玩时间排序，并补充数据
      const enrichedGames = await Promise.all(
        plugins.map((plugin) =>
          this.enrichGameData(plugin, userId),
        ),
      );

      // 按照Redis中的时间戳排序
      enrichedGames.sort((a, b) => {
        const aTime = recentMap.get(a.pluginId) || 0;
        const bTime = recentMap.get(b.pluginId) || 0;
        return bTime - aTime;
      });

      // 添加lastPlayedAt字段
      enrichedGames.forEach((game) => {
        const timestamp = recentMap.get(game.pluginId);
        if (timestamp) {
          game.lastPlayedAt = new Date(timestamp);
        }
      });

      return enrichedGames;
    } catch (error) {
      this.logger.warn(
        `Failed to get recent games for user ${userId}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * 获取当前房间数
   *
   * 查询数据库中该游戏的活跃房间数量
   *
   * @param pluginId - 插件ID
   * @returns 房间数量
   */
  private async getTotalRooms(pluginId: string): Promise<number> {
    try {
      // 使用动态导入避免循环依赖
      const { Room } = await import('../common/entities/room.entity');
      const count = await this.pluginRepository.manager
        .getRepository(Room)
        .count({
          where: { plugin_id: pluginId },
        });
      return count;
    } catch (error) {
      this.logger.warn(
        `Failed to get total rooms for plugin ${pluginId}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * 补充游戏数据的扩展信息（在线人数、房间数、收藏状态等）
   *
   * @param plugin - 插件实体
   * @param userId - 当前用户ID（可选）
   * @returns 补充完整数据的游戏响应DTO
   */
  private async enrichGameData(
    plugin: Plugin,
    userId?: number,
  ): Promise<GameResponseDto> {
    const [
      onlineCount,
      totalRooms,
    ] = await Promise.all([
      this.getOnlineCount(plugin.plugin_id),
      this.getTotalRooms(plugin.plugin_id),
    ]);

    // 从meta_json中提取描述和图标URL
    const description = plugin.meta_json?.description || '';
    const iconUrl = plugin.meta_json?.iconUrl || plugin.meta_json?.icon_url || '';

    const dto: GameResponseDto = {
      pluginId: plugin.plugin_id,
      name: plugin.name,
      category: plugin.category as 'board' | 'card' | 'mahjong',
      description,
      iconUrl,
      minPlayers: plugin.min_players,
      maxPlayers: plugin.max_players,
      onlineCount,
      totalRooms,
      isEnabled: plugin.is_enabled,
    };

    // 如果提供了用户ID，查询收藏状态
    if (userId !== undefined) {
      try {
        const isFavorite = await this.redis.sismember(
          `favorites:${userId}`,
          plugin.plugin_id,
        );
        dto.isFavorite = isFavorite === 1;
      } catch {
        dto.isFavorite = false;
      }
    }

    return dto;
  }

  /**
   * 将公告实体映射为DTO
   *
   * @param announcement - 公告实体
   * @returns 公告DTO
   */
  private mapAnnouncementToDto(
    announcement: Announcement,
  ): AnnouncementDto {
    return {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      imageUrl: announcement.image_url || undefined,
      linkUrl: announcement.link_url || undefined,
      startTime: announcement.start_time,
      endTime: announcement.end_time,
      priority: announcement.priority,
    };
  }
}
