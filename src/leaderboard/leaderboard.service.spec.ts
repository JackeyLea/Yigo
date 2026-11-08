/**
 * LeaderboardService Unit Tests - 排行榜服务单元测试
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { LeaderboardService } from './leaderboard.service';
import { EloCalculator } from './elo-calculator';
import { LeaderboardEntry } from '../common/entities/leaderboard-entry.entity';
import { User } from '../common/entities/user.entity';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    zcard: jest.fn(),
    zrevrange: jest.fn(),
    zrevrank: jest.fn(),
    zscore: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    zrange: jest.fn(),
    zmscore: jest.fn(),
    zrevrangebyscore: jest.fn(),
    hgetall: jest.fn(),
    hget: jest.fn(),
    hset: jest.fn(),
    hmset: jest.fn(),
    hincrby: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    lrange: jest.fn(),
    lpush: jest.fn(),
    exists: jest.fn(),
    pipeline: jest.fn(),
    pexpire: jest.fn(),
    expire: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
    exec: jest.fn(),
  }));
});

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let redisMock: jest.Mocked<Redis>;
  let leaderboardRepoMock: jest.Mocked<Repository<LeaderboardEntry>>;
  let userRepoMock: jest.Mocked<Repository<User>>;

  // 测试数据
  const testGameType = 'chess';
  const testSeasonId = 'all_time';
  const testUserId = 1;

  // Mock pipeline
  const mockPipeline = {
    zadd: jest.fn().mockReturnThis(),
    hincrby: jest.fn().mockReturnThis(),
    hset: jest.fn().mockReturnThis(),
    hmset: jest.fn().mockReturnThis(),
    incr: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    pexpire: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    lpush: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        EloCalculator,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              host: 'localhost',
              port: 6379,
              password: undefined,
              db: 0,
            }),
          },
        },
        {
          provide: getRepositoryToken(LeaderboardEntry),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
    redisMock = service['redis'] as jest.Mocked<Redis>;
    leaderboardRepoMock = module.get(getRepositoryToken(LeaderboardEntry));
    userRepoMock = module.get(getRepositoryToken(User));

    // Setup pipeline mock
    redisMock.pipeline.mockReturnValue(mockPipeline as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // 排行榜查询
  // ============================================================

  describe('getLeaderboard', () => {
    it('应返回分页排行榜数据', async () => {
      // Mock Redis responses
      redisMock.zcard.mockResolvedValue(100);
      redisMock.zrevrange.mockResolvedValue([
        '1', '1500', '2', '1400', '3', '1300',
      ]);
      redisMock.hgetall.mockResolvedValue({
        gamesPlayed: '10',
        gamesWon: '6',
        winRate: '0.6',
        bestStreak: '3',
        currentRating: '1500',
      });
      redisMock.get.mockResolvedValue('1500');
      userRepoMock.findOne.mockResolvedValue({
        user_id: '1',
        username: 'testuser',
        avatar_url: 'http://avatar.jpg',
      } as User);

      const result = await service.getLeaderboard(testGameType, testSeasonId);

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(100);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
      expect(result.items[0]).toMatchObject({
        rank: 1,
        userId: 1,
        username: 'testuser',
        rating: 1500,
      });
    });

    it('空排行榜应返回空数组', async () => {
      redisMock.zcard.mockResolvedValue(0);
      redisMock.zrevrange.mockResolvedValue([]);

      const result = await service.getLeaderboard(testGameType, testSeasonId);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('应支持分页查询', async () => {
      redisMock.zcard.mockResolvedValue(200);
      redisMock.zrevrange.mockResolvedValue(['10', '1200']);
      redisMock.hgetall.mockResolvedValue({
        gamesPlayed: '5',
        gamesWon: '3',
        winRate: '0.6',
        bestStreak: '2',
        currentRating: '1200',
      });
      redisMock.get.mockResolvedValue('1200');
      userRepoMock.findOne.mockResolvedValue({
        user_id: '10',
        username: 'user10',
        avatar_url: '',
      } as User);

      const result = await service.getLeaderboard(
        testGameType,
        testSeasonId,
        'global',
        'all_time',
        3,
        50,
      );

      expect(result.page).toBe(3);
      // zrevrange 应请求 (3-1)*50=100 到 100+49=149
      expect(redisMock.zrevrange).toHaveBeenCalledWith(
        `leaderboard:${testGameType}:${testSeasonId}`,
        100,
        149,
        'WITHSCORES',
      );
    });

    it('应支持不同period查询', async () => {
      redisMock.zcard.mockResolvedValue(10);
      redisMock.zrevrange.mockResolvedValue([]);

      await service.getLeaderboard(testGameType, testSeasonId, 'global', 'daily', 1, 50);

      // 验证使用了daily的key
      expect(redisMock.zcard).toHaveBeenCalled();
      expect(redisMock.zrevrange).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 用户排名
  // ============================================================

  describe('getUserRank', () => {
    it('应返回用户的1-based排名', async () => {
      redisMock.zrevrank.mockResolvedValue(4); // 0-based rank 4 = 第5名

      const rank = await service.getUserRank(testUserId, testGameType);

      expect(rank).toBe(5);
      expect(redisMock.zrevrank).toHaveBeenCalledWith(
        `leaderboard:${testGameType}:all_time`,
        String(testUserId),
      );
    });

    it('用户未上榜应返回0', async () => {
      redisMock.zrevrank.mockResolvedValue(null);

      const rank = await service.getUserRank(testUserId, testGameType);

      expect(rank).toBe(0);
    });
  });

  describe('getUserRating', () => {
    it('应返回用户评分', async () => {
      redisMock.zscore.mockResolvedValue('1600');

      const rating = await service.getUserRating(testUserId, testGameType);

      expect(rating).toBe(1600);
    });

    it('用户无评分应返回默认1000', async () => {
      redisMock.zscore.mockResolvedValue(null);

      const rating = await service.getUserRating(testUserId, testGameType);

      expect(rating).toBe(1000);
    });
  });

  // ============================================================
  // 评分更新
  // ============================================================

  describe('updateRating', () => {
    it('应成功更新双人评分', async () => {
      // Mock getUserStatsFromRedis
      redisMock.hgetall
        .mockResolvedValueOnce({
          gamesPlayed: '50',
          gamesWon: '25',
          winRate: '0.5',
          bestStreak: '5',
          currentRating: '1500',
        })
        .mockResolvedValueOnce({
          gamesPlayed: '30',
          gamesWon: '15',
          winRate: '0.5',
          bestStreak: '3',
          currentRating: '1500',
        })
        .mockResolvedValue({
          gamesPlayed: '51',
          gamesWon: '26',
          winRate: '0.51',
          bestStreak: '6',
          currentStreak: '1',
          currentRating: '1510',
        });

      redisMock.get
        .mockResolvedValueOnce('1500')
        .mockResolvedValueOnce('1500')
        .mockResolvedValue('6');

      redisMock.zscore.mockResolvedValue('1500');

      // Mock seasons
      redisMock.lrange.mockResolvedValue([]);

      const result = await service.updateRating(testGameType, [
        { userId: 1, rank: 1, oldRating: 1500 },
        { userId: 2, rank: 2, oldRating: 1500 },
      ]);

      expect(result).toHaveLength(2);
      // 第1名应加分
      expect(result[0].ratingChange).toBeGreaterThan(0);
      // 第2名应减分
      expect(result[1].ratingChange).toBeLessThan(0);
    });

    it('少于2个玩家应抛出错误', async () => {
      await expect(
        service.updateRating(testGameType, [
          { userId: 1, rank: 1, oldRating: 1500 },
        ]),
      ).rejects.toThrow('At least 2 players are required');
    });

    it('空玩家数组应抛出错误', async () => {
      await expect(service.updateRating(testGameType, [])).rejects.toThrow(
        'At least 2 players are required',
      );
    });
  });

  // ============================================================
  // 个人战绩统计
  // ============================================================

  describe('getUserStats', () => {
    it('应返回用户完整战绩', async () => {
      redisMock.hgetall.mockResolvedValue({
        gamesPlayed: '100',
        gamesWon: '60',
        winRate: '0.6',
        bestStreak: '10',
        currentStreak: '3',
        currentRating: '1600',
        totalPlayTime: '3600',
      });
      // getUserStatsFromRedis 通过两个不同key调用get: highest(最高评分)和streak(当前连胜)
      redisMock.get.mockImplementation(async (key: string) => {
        if (key.includes(':highest:')) return '1800';
        if (key.includes(':streak:')) return '3';
        return null;
      });

      leaderboardRepoMock.findOne.mockResolvedValue({
        games_drawn: 10,
      } as LeaderboardEntry);

      const stats = await service.getUserStats(testUserId, testGameType);

      expect(stats.gameType).toBe(testGameType);
      expect(stats.gamesPlayed).toBe(100);
      expect(stats.gamesWon).toBe(60);
      expect(stats.gamesDrawn).toBe(10);
      expect(stats.gamesLost).toBe(30); // 100 - 60 - 10
      expect(stats.winRate).toBe(0.6);
      expect(stats.currentRating).toBe(1600);
      expect(stats.highestRating).toBe(1800);
      expect(stats.bestStreak).toBe(10);
      expect(stats.currentStreak).toBe(3);
      expect(stats.totalPlayTime).toBe(3600);
    });

    it('无数据时应返回默认值', async () => {
      redisMock.hgetall.mockResolvedValue({});

      const stats = await service.getUserStats(testUserId, testGameType);

      expect(stats.gamesPlayed).toBe(0);
      expect(stats.currentRating).toBe(1000);
      expect(stats.highestRating).toBe(1000);
    });
  });

  // ============================================================
  // 赛季管理
  // ============================================================

  describe('getSeasons', () => {
    it('应返回赛季列表', async () => {
      redisMock.lrange.mockResolvedValue(['season_1', 'season_2']);
      redisMock.hgetall
        .mockResolvedValueOnce({
          seasonId: 'season_1',
          name: 'Season 1',
          gameType: testGameType,
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-03-31T23:59:59Z',
          isActive: 'true',
        })
        .mockResolvedValueOnce({
          seasonId: 'season_2',
          name: 'Season 2',
          gameType: testGameType,
          startDate: '2024-04-01T00:00:00Z',
          endDate: '2024-06-30T23:59:59Z',
          isActive: 'false',
        });

      const seasons = await service.getSeasons(testGameType);

      expect(seasons).toHaveLength(2);
      expect(seasons[0].name).toBe('Season 2'); // 按日期降序
      expect(seasons[0].isActive).toBe(false);
      expect(seasons[1].name).toBe('Season 1');
      expect(seasons[1].isActive).toBe(true);
    });

    it('无赛季时应返回默认all_time赛季', async () => {
      redisMock.lrange.mockResolvedValue([]);

      const seasons = await service.getSeasons(testGameType);

      expect(seasons).toHaveLength(1);
      expect(seasons[0].seasonId).toBe('all_time');
      expect(seasons[0].isActive).toBe(true);
    });
  });

  describe('createSeason', () => {
    it('应成功创建赛季', async () => {
      redisMock.pipeline.mockReturnValue(mockPipeline as any);

      const result = await service.createSeason(
        'New Season',
        new Date('2024-06-01'),
        new Date('2024-08-31'),
        testGameType,
      );

      expect(result.name).toBe('New Season');
      expect(result.gameType).toBe(testGameType);
      expect(result.isActive).toBe(true);
      expect(result.seasonId).toMatch(/^season_/);
    });

    it('结束日期早于开始日期应抛出错误', async () => {
      await expect(
        service.createSeason(
          'Invalid Season',
          new Date('2024-08-31'),
          new Date('2024-06-01'),
          testGameType,
        ),
      ).rejects.toThrow('End date must be after start date');
    });
  });

  describe('endSeason', () => {
    it('应成功结束赛季', async () => {
      redisMock.exists.mockResolvedValue(1);
      redisMock.hmset.mockResolvedValue('OK');

      await service.endSeason('season_1');

      expect(redisMock.hmset).toHaveBeenCalledWith(
        'leaderboard:season:season_1',
        expect.objectContaining({
          isActive: 'false',
        }),
      );
    });

    it('不存在的赛季应抛出NotFoundException', async () => {
      redisMock.exists.mockResolvedValue(0);

      await expect(service.endSeason('nonexistent')).rejects.toThrow('not found');
    });
  });

  // ============================================================
  // 防刷分检测
  // ============================================================

  describe('detectCheating', () => {
    it('正常玩家应返回false', async () => {
      redisMock.hgetall.mockResolvedValue({
        recentGames: '2',
        avgDuration: '120',
        winStreak: '3',
        maxRatingChange: '20',
      });

      const isCheating = await service.detectCheating(testUserId, testGameType);

      expect(isCheating).toBe(false);
    });

    it('短时间对局过多应返回true', async () => {
      redisMock.hgetall.mockResolvedValue({
        recentGames: '6',
        avgDuration: '120',
        winStreak: '2',
        maxRatingChange: '15',
      });

      const isCheating = await service.detectCheating(testUserId, testGameType);

      expect(isCheating).toBe(true);
    });

    it('异常连胜应返回true', async () => {
      redisMock.hgetall.mockResolvedValue({
        recentGames: '2',
        avgDuration: '120',
        winStreak: '12',
        maxRatingChange: '15',
      });

      const isCheating = await service.detectCheating(testUserId, testGameType);

      expect(isCheating).toBe(true);
    });

    it('对局时长过短应返回true', async () => {
      redisMock.hgetall.mockResolvedValue({
        recentGames: '2',
        avgDuration: '10',
        winStreak: '2',
        maxRatingChange: '15',
      });

      const isCheating = await service.detectCheating(testUserId, testGameType);

      expect(isCheating).toBe(true);
    });

    it('评分波动异常应返回true', async () => {
      redisMock.hgetall.mockResolvedValue({
        recentGames: '2',
        avgDuration: '120',
        winStreak: '2',
        maxRatingChange: '250',
      });

      const isCheating = await service.detectCheating(testUserId, testGameType);

      expect(isCheating).toBe(true);
    });

    it('无检测数据应返回false', async () => {
      redisMock.hgetall.mockResolvedValue({});

      const isCheating = await service.detectCheating(testUserId, testGameType);

      expect(isCheating).toBe(false);
    });
  });

  describe('recordGameForCheatDetection', () => {
    it('应记录对局数据', async () => {
      redisMock.hget.mockResolvedValue(null);
      redisMock.pipeline.mockReturnValue(mockPipeline as any);

      await service.recordGameForCheatDetection(testUserId, testGameType, true, 60, 15);

      expect(mockPipeline.hincrby).toHaveBeenCalledWith(
        expect.stringContaining('cheat'),
        'recentGames',
        1,
      );
      expect(mockPipeline.hincrby).toHaveBeenCalledWith(
        expect.stringContaining('cheat'),
        'winStreak',
        1,
      );
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('失败时应重置连胜', async () => {
      redisMock.hget.mockResolvedValue('5');
      redisMock.pipeline.mockReturnValue(mockPipeline as any);

      await service.recordGameForCheatDetection(testUserId, testGameType, false, 60, -10);

      expect(mockPipeline.hset).toHaveBeenCalledWith(
        expect.stringContaining('cheat'),
        'winStreak',
        '0',
      );
    });
  });

  // ============================================================
  // 好友排行榜
  // ============================================================

  describe('getFriendsLeaderboard', () => {
    it('应返回好友排行榜', async () => {
      redisMock.zmscore.mockResolvedValue(['1500', '1400', '1300']);
      redisMock.hgetall.mockResolvedValue({
        gamesPlayed: '10',
        gamesWon: '5',
        winRate: '0.5',
        bestStreak: '3',
        currentRating: '1500',
      });
      redisMock.get.mockResolvedValue('1600');
      userRepoMock.findOne.mockResolvedValue({
        user_id: '1',
        username: 'user1',
        avatar_url: '',
      } as User);

      const result = await service.getFriendsLeaderboard(1, testGameType, testSeasonId, [2, 3]);

      expect(result).toHaveLength(3);
      expect(result[0].rank).toBe(1); // 最高分排第1
      expect(result[0].rating).toBe(1500);
    });
  });

  // ============================================================
  // 重建排行榜
  // ============================================================

  describe('rebuildLeaderboard', () => {
    it('应从数据库重建排行榜', async () => {
      leaderboardRepoMock.find.mockResolvedValue([
        { user_id: '1', rating_score: 1600 } as LeaderboardEntry,
        { user_id: '2', rating_score: 1500 } as LeaderboardEntry,
        { user_id: '3', rating_score: 1400 } as LeaderboardEntry,
      ]);
      redisMock.del.mockResolvedValue(1);
      redisMock.pipeline.mockReturnValue(mockPipeline as any);

      await service.rebuildLeaderboard(testGameType, testSeasonId);

      expect(leaderboardRepoMock.find).toHaveBeenCalledWith({
        where: { game_type: testGameType, season_id: testSeasonId },
        order: { rating_score: 'DESC' },
      });
      expect(mockPipeline.zadd).toHaveBeenCalledTimes(3);
    });

    it('无数据时应跳过', async () => {
      leaderboardRepoMock.find.mockResolvedValue([]);

      await service.rebuildLeaderboard(testGameType, testSeasonId);

      expect(redisMock.del).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 模块生命周期
  // ============================================================

  describe('onModuleDestroy', () => {
    it('应关闭Redis连接', () => {
      service.onModuleDestroy();

      expect(redisMock.disconnect).toHaveBeenCalled();
    });
  });
});
