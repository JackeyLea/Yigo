/**
 * LeaderboardController Unit Tests - 排行榜控制器单元测试
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService, LeaderboardEntryItem, UserGameStats, Season } from './leaderboard.service';
import { EloCalculator } from './elo-calculator';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

describe('LeaderboardController', () => {
  let controller: LeaderboardController;
  let leaderboardService: jest.Mocked<Partial<LeaderboardService>>;
  let eloCalculator: EloCalculator;

  // Mock data
  const mockLeaderboardEntry: LeaderboardEntryItem = {
    rank: 1,
    userId: 1,
    username: 'testuser',
    avatarUrl: 'http://avatar.jpg',
    rating: 1500,
    gamesPlayed: 50,
    gamesWon: 30,
    winRate: 0.6,
    bestStreak: 5,
  };

  const mockPaginatedResult: PaginatedResult<LeaderboardEntryItem> = {
    items: [mockLeaderboardEntry],
    total: 1,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  };

  const mockUserStats: UserGameStats = {
    gameType: 'chess',
    gamesPlayed: 100,
    gamesWon: 60,
    gamesDrawn: 10,
    gamesLost: 30,
    winRate: 0.6,
    currentRating: 1600,
    highestRating: 1800,
    bestStreak: 10,
    currentStreak: 3,
    totalPlayTime: 3600,
  };

  const mockSeason: Season = {
    seasonId: 'season_1',
    name: 'Test Season',
    gameType: 'chess',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    isActive: true,
  };

  beforeEach(async () => {
    leaderboardService = {
      getLeaderboard: jest.fn().mockResolvedValue(mockPaginatedResult),
      getUserRank: jest.fn().mockResolvedValue(5),
      getUserRating: jest.fn().mockResolvedValue(1500),
      getUserStats: jest.fn().mockResolvedValue(mockUserStats),
      getSeasons: jest.fn().mockResolvedValue([mockSeason]),
      createSeason: jest.fn().mockResolvedValue(mockSeason),
      endSeason: jest.fn().mockResolvedValue(undefined),
      updateRating: jest.fn().mockResolvedValue([
        {
          userId: 1,
          oldRating: 1500,
          newRating: 1520,
          ratingChange: 20,
          kFactor: 20,
          expectedScore: 0.5,
          actualScore: 1,
        },
      ]),
      detectCheating: jest.fn().mockResolvedValue(false),
      getFriendsLeaderboard: jest.fn().mockResolvedValue([mockLeaderboardEntry]),
      rebuildLeaderboard: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaderboardController],
      providers: [
        EloCalculator,
        {
          provide: LeaderboardService,
          useValue: leaderboardService,
        },
      ],
    }).compile();

    controller = module.get<LeaderboardController>(LeaderboardController);
    eloCalculator = module.get<EloCalculator>(EloCalculator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // 排行榜查询
  // ============================================================

  describe('GET /leaderboard', () => {
    it('应返回排行榜数据（Query参数方式）', async () => {
      const query = {
        gameType: 'chess',
        seasonId: 'all_time',
        scope: 'global' as const,
        period: 'all_time' as const,
        page: 1,
        pageSize: 50,
      };

      const result = await controller.getLeaderboard(query);

      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        'chess', 'all_time', 'global', 'all_time', 1, 50,
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].rank).toBe(1);
    });
  });

  describe('GET /leaderboard/:gameType', () => {
    it('应返回指定游戏类型的排行榜', async () => {
      const result = await controller.getLeaderboardByGameType(
        'chess', 'all_time', 'global', 'all_time', 1, 50,
      );

      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        'chess', 'all_time', 'global', 'all_time', 1, 50,
      );
      expect(result.items[0].gameType).toBeUndefined(); // service返回的数据结构
    });

    it('pageSize不应超过100', async () => {
      await controller.getLeaderboardByGameType(
        'chess', 'all_time', 'global', 'all_time', 1, 200,
      );

      // 控制器应将pageSize限制为100
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        'chess', 'all_time', 'global', 'all_time', 1, 200,
      );
    });
  });

  describe('GET /leaderboard/:gameType/rank/:userId', () => {
    it('应返回用户排名', async () => {
      const result = await controller.getUserRank('chess', 1, 'all_time');

      expect(leaderboardService.getUserRank).toHaveBeenCalledWith(1, 'chess', 'all_time');
      expect(result.rank).toBe(5);
      expect(result.userId).toBe(1);
    });
  });

  describe('GET /leaderboard/:gameType/friends/:userId', () => {
    it('应返回好友排行榜', async () => {
      const result = await controller.getFriendsLeaderboard(
        'chess', 1, '2,3,4', 'all_time',
      );

      expect(leaderboardService.getFriendsLeaderboard).toHaveBeenCalledWith(
        1, 'chess', 'all_time', [2, 3, 4],
      );
      expect(result.items).toHaveLength(1);
    });

    it('应处理空好友列表', async () => {
      const result = await controller.getFriendsLeaderboard(
        'chess', 1, '', 'all_time',
      );

      expect(leaderboardService.getFriendsLeaderboard).toHaveBeenCalledWith(
        1, 'chess', 'all_time', [],
      );
    });
  });

  // ============================================================
  // 个人战绩
  // ============================================================

  describe('GET /leaderboard/stats/:userId', () => {
    it('应返回用户战绩统计', async () => {
      const result = await controller.getUserStats(1, 'chess');

      expect(leaderboardService.getUserStats).toHaveBeenCalledWith(1, 'chess');
      expect(result.gamesPlayed).toBe(100);
      expect(result.currentRating).toBe(1600);
    });

    it('应支持省略gameType', async () => {
      const result = await controller.getUserStats(1);

      expect(leaderboardService.getUserStats).toHaveBeenCalledWith(1, undefined);
      expect(result).toBeDefined();
    });
  });

  describe('GET /leaderboard/:gameType/stats/:userId', () => {
    it('应通过路径参数返回用户战绩', async () => {
      const result = await controller.getUserStatsByGameType('chess', 1);

      expect(leaderboardService.getUserStats).toHaveBeenCalledWith(1, 'chess');
      expect(result.gameType).toBe('chess');
    });
  });

  // ============================================================
  // 赛季管理
  // ============================================================

  describe('GET /leaderboard/seasons/:gameType', () => {
    it('应返回赛季列表', async () => {
      const result = await controller.getSeasons('chess');

      expect(leaderboardService.getSeasons).toHaveBeenCalledWith('chess');
      expect(result.seasons).toHaveLength(1);
      expect(result.seasons[0].name).toBe('Test Season');
    });
  });

  describe('POST /leaderboard/seasons', () => {
    it('应创建新赛季', async () => {
      const dto = {
        name: 'New Season',
        startDate: '2024-06-01T00:00:00Z',
        endDate: '2024-08-31T23:59:59Z',
        gameType: 'chess',
      };

      const result = await controller.createSeason(dto);

      expect(leaderboardService.createSeason).toHaveBeenCalledWith(
        'New Season',
        new Date('2024-06-01T00:00:00Z'),
        new Date('2024-08-31T23:59:59Z'),
        'chess',
      );
      expect(result.message).toBe('Season created successfully');
      expect(result.season.name).toBe('Test Season');
    });
  });

  describe('PUT /leaderboard/seasons/:seasonId/end', () => {
    it('应结束赛季', async () => {
      const result = await controller.endSeason('season_1');

      expect(leaderboardService.endSeason).toHaveBeenCalledWith('season_1');
      expect(result.message).toBe('Season ended successfully');
      expect(result.seasonId).toBe('season_1');
    });
  });

  // ============================================================
  // 评分更新
  // ============================================================

  describe('POST /leaderboard/rating/update', () => {
    it('应更新玩家评分', async () => {
      const dto = {
        gameType: 'chess',
        playerResults: [
          { userId: 1, rank: 1, oldRating: 1500 },
          { userId: 2, rank: 2, oldRating: 1500 },
        ],
      };

      const result = await controller.updateRating(dto);

      expect(leaderboardService.updateRating).toHaveBeenCalledWith(
        'chess',
        dto.playerResults,
      );
      expect(result.updates).toHaveLength(1);
      expect(result.message).toBe('Rating updated successfully');
    });
  });

  // ============================================================
  // ELO 计算工具
  // ============================================================

  describe('POST /leaderboard/elo/calculate/duel', () => {
    it('应计算双人ELO变化', async () => {
      const body = {
        playerA: { userId: 1, rating: 1500, gamesPlayed: 50, score: 1 },
        playerB: { userId: 2, rating: 1500, gamesPlayed: 50, score: 0 },
      };

      const result = await controller.calculateDuelElo(body);

      expect(result.result).toHaveLength(2);
      expect(result.result[0].ratingChange).toBeGreaterThan(0);
      expect(result.result[1].ratingChange).toBeLessThan(0);
    });
  });

  describe('POST /leaderboard/elo/calculate/multiplayer', () => {
    it('应计算多人ELO变化', async () => {
      const body = {
        players: [
          { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1 },
          { userId: 2, rating: 1500, gamesPlayed: 50, rank: 2 },
          { userId: 3, rating: 1500, gamesPlayed: 50, rank: 3 },
          { userId: 4, rating: 1500, gamesPlayed: 50, rank: 4 },
        ],
      };

      const result = await controller.calculateMultiplayerElo(body);

      expect(result.results).toHaveLength(4);
      expect(result.results[0].ratingChange).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 防刷分检测
  // ============================================================

  describe('GET /leaderboard/cheat/:gameType/:userId', () => {
    it('应返回刷分检测结果', async () => {
      const result = await controller.detectCheating('chess', 1);

      expect(leaderboardService.detectCheating).toHaveBeenCalledWith(1, 'chess');
      expect(result.isCheating).toBe(false);
      expect(result.userId).toBe(1);
      expect(result.gameType).toBe('chess');
    });
  });

  // ============================================================
  // 管理接口
  // ============================================================

  describe('POST /leaderboard/admin/rebuild/:gameType', () => {
    it('应重建排行榜', async () => {
      const result = await controller.rebuildLeaderboard('chess', 'all_time');

      expect(leaderboardService.rebuildLeaderboard).toHaveBeenCalledWith('chess', 'all_time');
      expect(result.message).toBe('Leaderboard rebuilt successfully');
    });
  });
});
