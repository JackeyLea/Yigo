/**
 * AchievementService Unit Tests - 成就服务单元测试
 *
 * 测试覆盖：
 * - 成就查询（getAchievements, getUserAchievements）
 * - 成就解锁检查（checkAndUnlock）
 * - 奖励领取（claimReward）
 * - 进度查询（getProgress）
 * - 成就统计（getAchievementStats）
 * - 初始化（initializeUserAchievements）
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { AchievementService } from './achievement.service';
import { Achievement, AchievementCategory } from '../common/entities/achievement.entity';
import { UserAchievement } from '../common/entities/user-achievement.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { Transaction, TransactionType } from '../common/entities/transaction.entity';
import { User, UserStatus } from '../common/entities/user.entity';

import { GameEvent, UnlockedAchievement, AchievementProgress } from './interfaces';

// ---- Mock Data ----

const mockAchievement: Achievement = {
  achievement_id: '1',
  achievement_code: 'first_victory',
  name: '初次胜利',
  description: '赢得第1场对局',
  icon_url: null,
  game_type: null,
  unlock_condition_json: { eventType: 'game_won', count: 1 },
  reward_json: { type: 'xp', value: 100 },
  category: AchievementCategory.CROSS_GAME,
  is_hidden: false,
  created_at: new Date(),
  user_achievements: [],
};

const mockAchievementTenWins: Achievement = {
  achievement_id: '2',
  achievement_code: 'ten_win_streak',
  name: '十连胜',
  description: '连续赢得10场对局',
  icon_url: null,
  game_type: null,
  unlock_condition_json: { eventType: 'streak', count: 10 },
  reward_json: { type: 'currency', value: 500, currency: 'COIN' },
  category: AchievementCategory.CROSS_GAME,
  is_hidden: false,
  created_at: new Date(),
  user_achievements: [],
};

const mockAchievementAllGames: Achievement = {
  achievement_id: '3',
  achievement_code: 'all_around_champion',
  name: '全能王',
  description: '在所有7款游戏中都赢过',
  icon_url: null,
  game_type: null,
  unlock_condition_json: {
    eventType: 'game_won',
    requireAllGameTypes: ['chess', 'go', 'xiangqi', 'checkers', 'backgammon', 'reversi', 'gomoku'],
    perGameCount: 1,
  },
  reward_json: { type: 'title', value: '全能王' },
  category: AchievementCategory.CROSS_GAME,
  is_hidden: false,
  created_at: new Date(),
  user_achievements: [],
};

const mockAchievementSocial: Achievement = {
  achievement_id: '4',
  achievement_code: 'social_butterfly',
  name: '社交达人',
  description: '添加10个好友',
  icon_url: null,
  game_type: null,
  unlock_condition_json: { eventType: 'social', action: 'add_friend', count: 10 },
  reward_json: { type: 'currency', value: 300, currency: 'COIN' },
  category: AchievementCategory.EVENT,
  is_hidden: false,
  created_at: new Date(),
  user_achievements: [],
};

const mockAchievementLogin: Achievement = {
  achievement_id: '5',
  achievement_code: 'persistent_login',
  name: '坚持不懈',
  description: '连续登录7天',
  icon_url: null,
  game_type: null,
  unlock_condition_json: { eventType: 'login', consecutiveDays: 7 },
  reward_json: { type: 'xp', value: 200 },
  category: AchievementCategory.EVENT,
  is_hidden: false,
  created_at: new Date(),
  user_achievements: [],
};

// ---- Mock Repository ----

const createMockRepository = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn((entities: any) =>
    Promise.resolve(
      Array.isArray(entities)
        ? entities.map((e: any, i: number) => ({
            ...e,
            id: e.id || String(i + 1),
            achievement_id: e.achievement_id || String(i + 1),
          }))
        : { ...entities, id: entities.id || '1' },
    ),
  ),
  create: jest.fn((dto: any) => dto),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    getCount: jest.fn().mockResolvedValue(0),
  })),
  count: jest.fn().mockResolvedValue(0),
});

// ---- Mock QueryRunner ----

const createMockQueryRunner = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  rollbackTransaction: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  manager: {
    createQueryBuilder: jest.fn(() => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    })),
    getRepository: jest.fn(() => createMockRepository()),
    save: jest.fn().mockImplementation((entity: any, data: any) =>
      Promise.resolve({ ...data, id: '1' }),
    ),
    create: jest.fn().mockImplementation((entity: any, data: any) => data),
  },
});

// ---- Mock DataSource ----

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(createMockQueryRunner()),
};

// ---- Mock ConfigService ----

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'redis') {
      return {
        host: 'localhost',
        port: 6379,
        db: 0,
      };
    }
    return undefined;
  }),
};

// ---- Tests ----

describe('AchievementService', () => {
  let service: AchievementService;
  let achievementRepository: Repository<Achievement>;
  let userAchievementRepository: Repository<UserAchievement>;
  let walletRepository: Repository<Wallet>;
  let transactionRepository: Repository<Transaction>;
  let userRepository: Repository<User>;
  let queryRunner: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementService,
        {
          provide: getRepositoryToken(Achievement),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(UserAchievement),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(Wallet),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(Transaction),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(User),
          useFactory: createMockRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AchievementService>(AchievementService);
    achievementRepository = module.get<Repository<Achievement>>(
      getRepositoryToken(Achievement),
    );
    userAchievementRepository = module.get<Repository<UserAchievement>>(
      getRepositoryToken(UserAchievement),
    );
    walletRepository = module.get<Repository<Wallet>>(
      getRepositoryToken(Wallet),
    );
    transactionRepository = module.get<Repository<Transaction>>(
      getRepositoryToken(Transaction),
    );
    userRepository = module.get<Repository<User>>(
      getRepositoryToken(User),
    );
    queryRunner = createMockQueryRunner();
    mockDataSource.createQueryRunner.mockReturnValue(queryRunner);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // 1. getAchievements 测试
  // ============================================================

  describe('getAchievements', () => {
    it('should return all visible achievements without userId', async () => {
      const mockAchievements = [mockAchievement, mockAchievementTenWins];
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              addOrderBy: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue(mockAchievements),
            }) as any,
        );

      const result = await service.getAchievements();

      expect(result).toHaveLength(2);
      expect(result[0].achievement_code).toBe('first_victory');
      expect(result[1].achievement_code).toBe('ten_win_streak');
    });

    it('should filter achievements by gameType', async () => {
      const chessAchievement = { ...mockAchievement, game_type: 'chess' };
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              addOrderBy: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([chessAchievement]),
            }) as any,
        );

      // Also mock user achievements query
      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([]);

      const result = await service.getAchievements(1, 'chess');

      expect(result).toHaveLength(1);
      expect(result[0].game_type).toBe('chess');
    });
  });

  // ============================================================
  // 2. getUserAchievements 测试
  // ============================================================

  describe('getUserAchievements', () => {
    it('should return user achievements with relations', async () => {
      const mockUserAchievements: UserAchievement[] = [
        {
          id: '1',
          user_id: '1',
          achievement_id: '1',
          unlocked_at: new Date(),
          progress_json: { totalWins: 1 },
          is_claimed: false,
          user: null as any,
          achievement: mockAchievement,
        },
      ];

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue(mockUserAchievements);

      const result = await service.getUserAchievements(1);

      expect(result).toHaveLength(1);
      expect(result[0].achievement_id).toBe('1');
      expect(result[0].achievement.name).toBe('初次胜利');
    });
  });

  // ============================================================
  // 3. checkAndUnlock 测试
  // ============================================================

  describe('checkAndUnlock', () => {
    it('should unlock "first_victory" on game_won event', async () => {
      // Mock getRelevantAchievements
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockAchievement]),
            }) as any,
        );

      // Mock user achievement (not yet unlocked)
      const userAchievement = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        unlocked_at: null,
        progress_json: { totalWins: 0 },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({
            ...data,
            id: '1',
            achievement: mockAchievement,
          }),
        );

      const event: GameEvent = {
        type: 'game_won',
        gameType: 'chess',
        pluginId: 'chess_plugin',
        mode: 'ranked',
      };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].achievementCode).toBe('first_victory');
      expect(result[0].isNew).toBe(true);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should unlock "ten_win_streak" on streak event with count >= 10', async () => {
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockAchievementTenWins]),
            }) as any,
        );

      const userAchievement = {
        id: '2',
        user_id: '1',
        achievement_id: '2',
        unlocked_at: null,
        progress_json: { currentStreak: 0, maxStreak: 0 },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievementTenWins,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({
            ...data,
            id: '2',
            achievement: mockAchievementTenWins,
          }),
        );

      const event: GameEvent = { type: 'streak', count: 10 };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].achievementCode).toBe('ten_win_streak');
      expect(result[0].isNew).toBe(true);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should not unlock "ten_win_streak" on streak event with count < 10', async () => {
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockAchievementTenWins]),
            }) as any,
        );

      const userAchievement = {
        id: '2',
        user_id: '1',
        achievement_id: '2',
        unlocked_at: null,
        progress_json: { currentStreak: 0, maxStreak: 0 },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievementTenWins,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({
            ...data,
            id: '2',
            achievement: mockAchievementTenWins,
          }),
        );

      const event: GameEvent = { type: 'streak', count: 5 };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(0);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should unlock "social_butterfly" after 10 social actions', async () => {
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockAchievementSocial]),
            }) as any,
        );

      const userAchievement = {
        id: '4',
        user_id: '1',
        achievement_id: '4',
        unlocked_at: null,
        progress_json: { totalActions: 0, actionsByType: {} },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievementSocial,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({
            ...data,
            id: '4',
            achievement: mockAchievementSocial,
          }),
        );

      const event: GameEvent = {
        type: 'social',
        action: 'add_friend',
        count: 10,
      };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].achievementCode).toBe('social_butterfly');
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should unlock "persistent_login" after 7 consecutive days', async () => {
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockAchievementLogin]),
            }) as any,
        );

      const userAchievement = {
        id: '5',
        user_id: '1',
        achievement_id: '5',
        unlocked_at: null,
        progress_json: { consecutiveDays: 0, totalDays: 0, lastLoginDate: null },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievementLogin,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({
            ...data,
            id: '5',
            achievement: mockAchievementLogin,
          }),
        );

      const event: GameEvent = { type: 'login', consecutiveDays: 7 };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].achievementCode).toBe('persistent_login');
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should return empty array when no relevant achievements', async () => {
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }) as any,
        );

      const event: GameEvent = {
        type: 'game_won',
        gameType: 'chess',
        pluginId: 'chess_plugin',
        mode: 'ranked',
      };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(0);
    });

    it('should skip already unlocked achievements', async () => {
      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockAchievement]),
            }) as any,
        );

      // Already unlocked
      const userAchievement = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        unlocked_at: new Date(),
        progress_json: { totalWins: 1 },
        is_claimed: true,
        user: null as any,
        achievement: mockAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      const saveSpy = jest.spyOn(userAchievementRepository, 'save');

      const event: GameEvent = {
        type: 'game_won',
        gameType: 'chess',
        pluginId: 'chess_plugin',
        mode: 'ranked',
      };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(0);
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 4. claimReward 测试
  // ============================================================

  describe('claimReward', () => {
    it('should claim XP reward successfully', async () => {
      const mockUserAchievement = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        unlocked_at: new Date(),
        progress_json: { totalWins: 1 },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'findOne')
        .mockResolvedValue(mockUserAchievement);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) => Promise.resolve(data));

      // Mock wallet query for XP (no wallet needed)
      queryRunner.manager.createQueryBuilder.mockImplementation(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          user_id: '1',
          xp: '0',
          level: 1,
        }),
      }));

      const result = await service.claimReward(1, 1);

      expect(result.rewardType).toBe('xp');
      expect(result.rewardValue).toBe(100);
      expect(result.achievementName).toBe('初次胜利');
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user achievement not found', async () => {
      jest
        .spyOn(userAchievementRepository, 'findOne')
        .mockResolvedValue(null);

      await expect(service.claimReward(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when achievement not unlocked', async () => {
      const mockUserAchievement = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        unlocked_at: null,
        progress_json: { totalWins: 0 },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'findOne')
        .mockResolvedValue(mockUserAchievement);

      await expect(service.claimReward(1, 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when reward already claimed', async () => {
      const mockUserAchievement = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        unlocked_at: new Date(),
        progress_json: { totalWins: 1 },
        is_claimed: true,
        user: null as any,
        achievement: mockAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'findOne')
        .mockResolvedValue(mockUserAchievement);

      await expect(service.claimReward(1, 1)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================================
  // 5. getProgress 测试
  // ============================================================

  describe('getProgress', () => {
    it('should return achievement progress for new user', async () => {
      jest
        .spyOn(achievementRepository, 'findOne')
        .mockResolvedValue(mockAchievement);

      jest
        .spyOn(userAchievementRepository, 'findOne')
        .mockResolvedValue(null);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({ ...data, id: '1' }),
        );

      const result = await service.getProgress(1, 1);

      expect(result.achievementCode).toBe('first_victory');
      expect(result.currentProgress).toBe(0);
      expect(result.targetProgress).toBe(1);
      expect(result.percentage).toBe(0);
      expect(result.isUnlocked).toBe(false);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('should return correct progress for in-progress achievement', async () => {
      jest
        .spyOn(achievementRepository, 'findOne')
        .mockResolvedValue(mockAchievement);

      const userAchievement = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        unlocked_at: null,
        progress_json: { totalWins: 0 },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'findOne')
        .mockResolvedValue(userAchievement);

      const result = await service.getProgress(1, 1);

      expect(result.currentProgress).toBe(0);
      expect(result.targetProgress).toBe(1);
      expect(result.percentage).toBe(0);
      expect(result.isUnlocked).toBe(false);
    });

    it('should return 100% for completed achievement', async () => {
      jest
        .spyOn(achievementRepository, 'findOne')
        .mockResolvedValue(mockAchievement);

      const userAchievement = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        unlocked_at: new Date(),
        progress_json: { totalWins: 1 },
        is_claimed: false,
        user: null as any,
        achievement: mockAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'findOne')
        .mockResolvedValue(userAchievement);

      const result = await service.getProgress(1, 1);

      expect(result.currentProgress).toBe(1);
      expect(result.targetProgress).toBe(1);
      expect(result.percentage).toBe(100);
      expect(result.isUnlocked).toBe(true);
    });

    it('should throw NotFoundException when achievement not found', async () => {
      jest
        .spyOn(achievementRepository, 'findOne')
        .mockResolvedValue(null);

      await expect(service.getProgress(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================================
  // 6. getAchievementStats 测试
  // ============================================================

  describe('getAchievementStats', () => {
    it('should return correct achievement statistics', async () => {
      jest
        .spyOn(achievementRepository, 'count')
        .mockResolvedValue(5);

      const mockUserAchievements = [
        {
          id: '1',
          user_id: '1',
          achievement_id: '1',
          unlocked_at: new Date(),
          progress_json: { totalWins: 1 },
          is_claimed: true,
          achievement: {
            ...mockAchievement,
            reward_json: { type: 'xp', value: 100 },
          },
        },
        {
          id: '2',
          user_id: '1',
          achievement_id: '2',
          unlocked_at: new Date(),
          progress_json: { maxStreak: 10 },
          is_claimed: false,
          achievement: {
            ...mockAchievementTenWins,
            reward_json: { type: 'currency', value: 500, currency: 'COIN' },
          },
        },
        {
          id: '3',
          user_id: '1',
          achievement_id: '3',
          unlocked_at: null,
          progress_json: {},
          is_claimed: false,
          achievement: mockAchievementAllGames,
        },
      ];

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue(mockUserAchievements as any);

      const result = await service.getAchievementStats(1);

      expect(result.totalAchievements).toBe(5);
      expect(result.unlockedCount).toBe(2);
      expect(result.claimedCount).toBe(1);
      expect(result.totalRewards).toBe(100); // Only claimed XP reward
    });
  });

  // ============================================================
  // 7. initializeUserAchievements 测试
  // ============================================================

  describe('initializeUserAchievements', () => {
    it('should create missing user achievement records', async () => {
      const allAchievements = [
        mockAchievement,
        mockAchievementTenWins,
        mockAchievementAllGames,
      ];

      jest
        .spyOn(achievementRepository, 'find')
        .mockResolvedValue(allAchievements);

      // No existing records
      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([]);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve(
            Array.isArray(data)
              ? data.map((d: any, i: number) => ({ ...d, id: String(i + 1) }))
              : { ...data, id: '1' },
          ),
        );

      await service.initializeUserAchievements(1);

      expect(saveSpy).toHaveBeenCalled();
      const savedData = saveSpy.mock.calls[0][0];
      expect(Array.isArray(savedData)).toBe(true);
      expect(savedData).toHaveLength(3);
    });

    it('should only create records for missing achievements', async () => {
      const allAchievements = [
        mockAchievement,
        mockAchievementTenWins,
      ];

      jest
        .spyOn(achievementRepository, 'find')
        .mockResolvedValue(allAchievements);

      // One existing record
      const existingRecord = {
        id: '1',
        user_id: '1',
        achievement_id: '1',
        progress_json: {},
        is_claimed: false,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([existingRecord as any]);

      const saveSpy = jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve(
            Array.isArray(data)
              ? data.map((d: any, i: number) => ({ ...d, id: String(i + 1) }))
              : { ...data, id: '1' },
          ),
        );

      await service.initializeUserAchievements(1);

      expect(saveSpy).toHaveBeenCalled();
      const savedData = saveSpy.mock.calls[0][0];
      expect(Array.isArray(savedData)).toBe(true);
      expect(savedData).toHaveLength(1); // Only the missing one
      expect(savedData[0].achievement_id).toBe('2');
    });
  });

  // ============================================================
  // 8. GameEvent edge cases
  // ============================================================

  describe('GameEvent edge cases', () => {
    it('should handle special_move event', async () => {
      const specialMoveAchievement: Achievement = {
        achievement_id: '6',
        achievement_code: 'special_master',
        name: '特殊大师',
        description: '完成5次特殊移动',
        icon_url: null,
        game_type: 'chess',
        unlock_condition_json: { eventType: 'special_move', count: 5 },
        reward_json: { type: 'currency', value: 200, currency: 'COIN' },
        category: AchievementCategory.GAME_SPECIFIC,
        is_hidden: false,
        created_at: new Date(),
        user_achievements: [],
      };

      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([specialMoveAchievement]),
            }) as any,
        );

      const userAchievement = {
        id: '6',
        user_id: '1',
        achievement_id: '6',
        unlocked_at: null,
        progress_json: { movesByType: {}, totalSpecialMoves: 0 },
        is_claimed: false,
        user: null as any,
        achievement: specialMoveAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({ ...data, id: '6', achievement: specialMoveAchievement }),
        );

      const event: GameEvent = {
        type: 'special_move',
        gameType: 'chess',
        moveType: 'en_passant',
      };

      // First call - not enough
      let result = await service.checkAndUnlock(1, event);
      expect(result).toHaveLength(0);

      // Simulate 4 more special moves
      userAchievement.progress_json = { movesByType: { en_passant: 4 }, totalSpecialMoves: 4 };
      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      // After 5 total
      const saveCalls: any[] = [];
      jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) => {
          saveCalls.push(data);
          return Promise.resolve({ ...data, id: '6', achievement: specialMoveAchievement });
        });

      result = await service.checkAndUnlock(1, event);
      expect(result).toHaveLength(1);
      expect(result[0].achievementCode).toBe('special_master');
    });

    it('should handle game_played event', async () => {
      const playAchievement: Achievement = {
        achievement_id: '7',
        achievement_code: 'play_100_games',
        name: '百战百胜',
        description: '完成100场对局',
        icon_url: null,
        game_type: null,
        unlock_condition_json: { eventType: 'game_played', count: 100 },
        reward_json: { type: 'currency', value: 1000, currency: 'COIN' },
        category: AchievementCategory.CROSS_GAME,
        is_hidden: false,
        created_at: new Date(),
        user_achievements: [],
      };

      jest
        .spyOn(achievementRepository, 'createQueryBuilder')
        .mockImplementation(
          () =>
            ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([playAchievement]),
            }) as any,
        );

      const userAchievement = {
        id: '7',
        user_id: '1',
        achievement_id: '7',
        unlocked_at: null,
        progress_json: { totalGamesPlayed: 95, gamesByGameType: {} },
        is_claimed: false,
        user: null as any,
        achievement: playAchievement,
      };

      jest
        .spyOn(userAchievementRepository, 'find')
        .mockResolvedValue([userAchievement]);

      jest
        .spyOn(userAchievementRepository, 'save')
        .mockImplementation((data: any) =>
          Promise.resolve({ ...data, id: '7', achievement: playAchievement }),
        );

      const event: GameEvent = {
        type: 'game_played',
        gameType: 'chess',
        count: 5,
      };

      const result = await service.checkAndUnlock(1, event);

      expect(result).toHaveLength(1);
      expect(result[0].achievementCode).toBe('play_100_games');
    });
  });
});
