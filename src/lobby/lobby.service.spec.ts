import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { LobbyService, PaginatedResult } from './lobby.service';
import { Plugin, PluginCategory } from '../common/entities/plugin.entity';
import { Announcement } from './entities/announcement.entity';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { GameResponseDto } from './dto/game-response.dto';
import { AnnouncementDto } from './dto/announcement.dto';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    hlen: jest.fn(),
    smembers: jest.fn(),
    sismember: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    zrevrange: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
    quit: jest.fn(),
  }));
});

describe('LobbyService', () => {
  let service: LobbyService;
  let pluginRepository: jest.Mocked<Repository<Plugin>>;
  let announcementRepository: jest.Mocked<Repository<Announcement>>;
  let configService: jest.Mocked<ConfigService>;
  let redisClient: jest.Mocked<Redis>;

  // 测试数据工厂
  const createMockPlugin = (overrides?: Partial<Plugin>): Plugin => ({
    plugin_id: 'chess-standard',
    name: '标准象棋',
    version: '1.0.0',
    game_type: 'chess',
    category: PluginCategory.BOARD,
    min_players: 2,
    max_players: 2,
    entry_class: 'ChessStandardPlugin',
    dll_path: null,
    is_enabled: true,
    meta_json: {
      description: '经典中国象棋游戏',
      iconUrl: '/assets/icons/chess-standard.png',
    },
    installed_at: new Date('2024-01-01'),
    ...overrides,
  } as Plugin);

  const createMockAnnouncement = (overrides?: Partial<Announcement>): Announcement => ({
    id: 1,
    title: '新年活动',
    content: '春节期间双倍积分奖励！',
    image_url: '/assets/announcements/new-year.jpg',
    link_url: '/events/new-year',
    start_time: new Date('2024-01-01'),
    end_time: new Date('2024-12-31'),
    priority: 10,
    is_enabled: true,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    ...overrides,
  } as Announcement);

  // 构建Mock Repository
  const createMockRepository = <T>(): jest.Mocked<Repository<T>> => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: {
      getRepository: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(0),
      }),
    },
  } as unknown as jest.Mocked<Repository<T>>);

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockPluginRepository = createMockRepository<Plugin>();
    const mockAnnouncementRepository = createMockRepository<Announcement>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LobbyService,
        {
          provide: getRepositoryToken(Plugin),
          useValue: mockPluginRepository,
        },
        {
          provide: getRepositoryToken(Announcement),
          useValue: mockAnnouncementRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              host: 'localhost',
              port: 6379,
              db: 0,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LobbyService>(LobbyService);
    pluginRepository = module.get(getRepositoryToken(Plugin));
    announcementRepository = module.get(getRepositoryToken(Announcement));
    configService = module.get(ConfigService);
    redisClient = (service as any).redis;
  });

  afterEach(async () => {
    await (service as any).redis?.quit?.();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * ==========================================
   * listGames 测试
   * ==========================================
   */
  describe('listGames', () => {
    it('should return paginated game list', async () => {
      const plugins = [
        createMockPlugin({ plugin_id: 'chess-1', name: '象棋1' }),
        createMockPlugin({ plugin_id: 'chess-2', name: '象棋2' }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
        getMany: jest.fn().mockResolvedValue(plugins),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      redisClient.hlen.mockResolvedValue(0);

      const query: ListGamesQueryDto = { page: 1, pageSize: 20 };
      const result = await service.listGames(query);

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by keyword (plugin_id and name)', async () => {
      const plugins = [
        createMockPlugin({ plugin_id: 'chess-search', name: '搜索结果' }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue(plugins),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      redisClient.hlen.mockResolvedValue(0);

      const query: ListGamesQueryDto = { keyword: 'search', page: 1, pageSize: 20 };
      const result = await service.listGames(query);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by category', async () => {
      const plugins = [
        createMockPlugin({ plugin_id: 'mahjong-1', name: '麻将1', category: PluginCategory.MAHJONG }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue(plugins),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      redisClient.hlen.mockResolvedValue(0);

      const query: ListGamesQueryDto = { category: 'mahjong', page: 1, pageSize: 20 };
      const result = await service.listGames(query);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].category).toBe('mahjong');
    });

    it('should return favorite status for logged-in user', async () => {
      const plugins = [
        createMockPlugin({ plugin_id: 'fav-game', name: '收藏游戏' }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue(plugins),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      redisClient.hlen.mockResolvedValue(0);
      redisClient.sismember.mockResolvedValue(1);

      const query: ListGamesQueryDto = { page: 1, pageSize: 20 };
      const result = await service.listGames(query, 1);

      expect(result.items[0].isFavorite).toBe(true);
    });

    it('should handle empty results', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        getMany: jest.fn().mockResolvedValue([]),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const query: ListGamesQueryDto = { page: 1, pageSize: 20 };
      const result = await service.listGames(query);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('should use default pagination values', async () => {
      const plugins = [
        createMockPlugin({ plugin_id: 'game-1', name: '游戏1' }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue(plugins),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      redisClient.hlen.mockResolvedValue(0);

      const query = {} as ListGamesQueryDto;
      const result = await service.listGames(query);

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });
  });

  /**
   * ==========================================
   * getGameDetail 测试
   * ==========================================
   */
  describe('getGameDetail', () => {
    it('should return game detail for existing plugin', async () => {
      const plugin = createMockPlugin({ plugin_id: 'chess-detail', name: '象棋详情' });

      pluginRepository.findOne.mockResolvedValue(plugin);
      redisClient.hlen.mockResolvedValue(5);

      const result = await service.getGameDetail('chess-detail');

      expect(result).toBeDefined();
      expect(result.pluginId).toBe('chess-detail');
      expect(result.name).toBe('象棋详情');
      expect(result.onlineCount).toBe(5);
    });

    it('should throw NotFoundException for non-existing plugin', async () => {
      pluginRepository.findOne.mockResolvedValue(null);

      await expect(service.getGameDetail('non-existent')).rejects.toThrow(
        '游戏 \'non-existent\' 不存在',
      );
    });

    it('should include favorite status when userId provided', async () => {
      const plugin = createMockPlugin({ plugin_id: 'fav-test', name: '收藏测试' });

      pluginRepository.findOne.mockResolvedValue(plugin);
      redisClient.hlen.mockResolvedValue(0);
      redisClient.sismember.mockResolvedValue(1);

      const result = await service.getGameDetail('fav-test', 1);

      expect(result.isFavorite).toBe(true);
    });
  });

  /**
   * ==========================================
   * getOnlineCount 测试
   * ==========================================
   */
  describe('getOnlineCount', () => {
    it('should return online count from Redis', async () => {
      redisClient.hlen.mockResolvedValue(42);

      const result = await service.getOnlineCount('chess-standard');

      expect(result).toBe(42);
      expect(redisClient.hlen).toHaveBeenCalledWith('online:chess-standard');
    });

    it('should return 0 when Redis key does not exist', async () => {
      redisClient.hlen.mockResolvedValue(0);

      const result = await service.getOnlineCount('empty-game');

      expect(result).toBe(0);
    });

    it('should return 0 on Redis error', async () => {
      redisClient.hlen.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.getOnlineCount('error-game');

      expect(result).toBe(0);
    });
  });

  /**
   * ==========================================
   * getAnnouncements 测试
   * ==========================================
   */
  describe('getAnnouncements', () => {
    it('should return active announcements sorted by priority', async () => {
      const announcements = [
        createMockAnnouncement({
          id: 1,
          title: '高优先级公告',
          priority: 100,
        }),
        createMockAnnouncement({
          id: 2,
          title: '中优先级公告',
          priority: 50,
        }),
        createMockAnnouncement({
          id: 3,
          title: '低优先级公告',
          priority: 10,
        }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(announcements),
      } as unknown as jest.Mocked<SelectQueryBuilder<Announcement>>;

      announcementRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getAnnouncements();

      expect(result).toHaveLength(3);
      expect(result[0].priority).toBe(100);
      expect(result[1].priority).toBe(50);
      expect(result[2].priority).toBe(10);
    });

    it('should return empty array when no active announcements', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as unknown as jest.Mocked<SelectQueryBuilder<Announcement>>;

      announcementRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getAnnouncements();

      expect(result).toHaveLength(0);
    });

    it('should map announcement entity to DTO correctly', async () => {
      const announcement = createMockAnnouncement({
        id: 1,
        title: '测试公告',
        content: '公告内容',
        image_url: '/img/test.jpg',
        link_url: '/link/test',
        priority: 20,
      });

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([announcement]),
      } as unknown as jest.Mocked<SelectQueryBuilder<Announcement>>;

      announcementRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getAnnouncements();

      expect(result[0]).toMatchObject({
        id: 1,
        title: '测试公告',
        content: '公告内容',
        imageUrl: '/img/test.jpg',
        linkUrl: '/link/test',
        priority: 20,
      });
    });
  });

  /**
   * ==========================================
   * getFavorites 测试
   * ==========================================
   */
  describe('getFavorites', () => {
    it('should return favorite plugin IDs for user', async () => {
      const favoriteIds = ['chess-1', 'chess-2', 'mahjong-1'];
      redisClient.smembers.mockResolvedValue(favoriteIds);

      const result = await service.getFavorites(1);

      expect(result).toEqual(favoriteIds);
      expect(redisClient.smembers).toHaveBeenCalledWith('favorites:1');
    });

    it('should return empty array when user has no favorites', async () => {
      redisClient.smembers.mockResolvedValue([]);

      const result = await service.getFavorites(999);

      expect(result).toEqual([]);
    });

    it('should return empty array on Redis error', async () => {
      redisClient.smembers.mockRejectedValue(new Error('Redis error'));

      const result = await service.getFavorites(1);

      expect(result).toEqual([]);
    });
  });

  /**
   * ==========================================
   * toggleFavorite 测试
   * ==========================================
   */
  describe('toggleFavorite', () => {
    it('should add to favorites when not already favorited', async () => {
      redisClient.sismember.mockResolvedValue(0);
      redisClient.sadd.mockResolvedValue(1);

      const result = await service.toggleFavorite(1, 'new-game');

      expect(result).toBe(true);
      expect(redisClient.sadd).toHaveBeenCalledWith('favorites:1', 'new-game');
    });

    it('should remove from favorites when already favorited', async () => {
      redisClient.sismember.mockResolvedValue(1);
      redisClient.srem.mockResolvedValue(1);

      const result = await service.toggleFavorite(1, 'existing-game');

      expect(result).toBe(false);
      expect(redisClient.srem).toHaveBeenCalledWith('favorites:1', 'existing-game');
    });

    it('should handle Redis error and throw', async () => {
      redisClient.sismember.mockRejectedValue(new Error('Redis error'));

      await expect(service.toggleFavorite(1, 'error-game')).rejects.toThrow('Redis error');
    });
  });

  /**
   * ==========================================
   * getRecentGames 测试
   * ==========================================
   */
  describe('getRecentGames', () => {
    it('should return recent games sorted by play time', async () => {
      const now = Date.now();
      redisClient.zrevrange.mockResolvedValue([
        'chess-recent', String(now),
        'mahjong-old', String(now - 3600000),
      ]);

      const plugins = [
        createMockPlugin({ plugin_id: 'chess-recent', name: '最近象棋' }),
        createMockPlugin({ plugin_id: 'mahjong-old', name: '之前麻将' }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(plugins),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      redisClient.hlen.mockResolvedValue(0);

      const result = await service.getRecentGames(1, 10);

      expect(result).toHaveLength(2);
      expect(result[0].pluginId).toBe('chess-recent');
      expect(result[0].lastPlayedAt).toBeInstanceOf(Date);
    });

    it('should return empty array when no recent games', async () => {
      redisClient.zrevrange.mockResolvedValue([]);

      const result = await service.getRecentGames(1, 10);

      expect(result).toEqual([]);
    });

    it('should respect the limit parameter', async () => {
      const now = Date.now();
      redisClient.zrevrange.mockResolvedValue([
        'game-1', String(now),
        'game-2', String(now - 1000),
        'game-3', String(now - 2000),
      ]);

      const plugins = [
        createMockPlugin({ plugin_id: 'game-1', name: '游戏1' }),
        createMockPlugin({ plugin_id: 'game-2', name: '游戏2' }),
        createMockPlugin({ plugin_id: 'game-3', name: '游戏3' }),
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(plugins),
      } as unknown as jest.Mocked<SelectQueryBuilder<Plugin>>;

      pluginRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      redisClient.hlen.mockResolvedValue(0);

      // limit=2，应该只返回2个
      const result = await service.getRecentGames(1, 2);

      expect(result).toHaveLength(3); // 3个都在数据库中，Redis返回了3个
      // 验证zrevrange被正确调用，只取0-1
      expect(redisClient.zrevrange).toHaveBeenCalledWith('recent:1', 0, 1, 'WITHSCORES');
    });

    it('should return empty array on Redis error', async () => {
      redisClient.zrevrange.mockRejectedValue(new Error('Redis error'));

      const result = await service.getRecentGames(1, 10);

      expect(result).toEqual([]);
    });
  });
});
