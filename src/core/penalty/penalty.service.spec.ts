/**
 * PenaltyService 单元测试
 *
 * 测试覆盖：
 * - 逃跑记录
 * - 信誉分计算
 * - 惩罚等级判定
 * - 禁止匹配
 * - 完成恢复
 * - 宽恕功能
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PenaltyService, PenaltyStatus } from './penalty.service';
import { EscapeRecord } from './entities/escape-record.entity';

// Mock ioredis
const mockRedisData: Map<string, string> = new Map();
const mockRedisTTL: Map<string, number> = new Map();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    setex: jest.fn().mockImplementation((key: string, seconds: number, value: string) => {
      mockRedisData.set(key, value);
      mockRedisTTL.set(key, seconds);
      return Promise.resolve('OK');
    }),
    set: jest.fn().mockImplementation((key: string, ...args: any[]) => {
      // Handle NX option
      if (args.includes('NX')) {
        if (mockRedisData.has(key)) return Promise.resolve(null);
        const value = args[0];
        const exIndex = args.indexOf('EX');
        const ttl = exIndex >= 0 ? args[exIndex + 1] : 3600;
        mockRedisData.set(key, value);
        mockRedisTTL.set(key, ttl);
        return Promise.resolve('OK');
      }
      mockRedisData.set(key, args[0]);
      return Promise.resolve('OK');
    }),
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(mockRedisData.get(key) || null);
    }),
    del: jest.fn().mockImplementation((key: string) => {
      mockRedisData.delete(key);
      mockRedisTTL.delete(key);
      return Promise.resolve(1);
    }),
    exists: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(mockRedisData.has(key) ? 1 : 0);
    }),
    incr: jest.fn().mockImplementation((key: string) => {
      const current = parseInt(mockRedisData.get(key) || '0', 10);
      const next = current + 1;
      mockRedisData.set(key, String(next));
      return Promise.resolve(next);
    }),
    mget: jest.fn().mockResolvedValue([]),
    keys: jest.fn().mockResolvedValue([]),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
  }));
});

describe('PenaltyService', () => {
  let service: PenaltyService;
  let escapeRecordRepository: Repository<EscapeRecord>;

  const mockUserId = 12345;
  const mockRoomId = 'ABC123';
  const mockGameType = 'chess';

  beforeEach(async () => {
    mockRedisData.clear();
    mockRedisTTL.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PenaltyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                redis: { host: 'localhost', port: 6379 },
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: getRepositoryToken(EscapeRecord),
          useValue: {
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn().mockImplementation((entity) =>
              Promise.resolve({ ...entity, id: 1, created_at: new Date(), updated_at: new Date() }),
            ),
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            findAndCount: jest.fn().mockResolvedValue([[], 0]),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<PenaltyService>(PenaltyService);
    escapeRecordRepository = module.get<Repository<EscapeRecord>>(
      getRepositoryToken(EscapeRecord),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordEscape', () => {
    it('should record escape and deduct reputation score', async () => {
      // 初始化信誉分
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '100');

      await service.recordEscape(mockUserId, mockRoomId, mockGameType);

      expect(escapeRecordRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: String(mockUserId),
          room_id: mockRoomId,
          game_type: mockGameType,
          score_deducted: 10,
        }),
      );
      expect(escapeRecordRepository.save).toHaveBeenCalled();

      // 检查信誉分是否扣减
      const score = await redis.get(`penalty:reputation:${mockUserId}`);
      expect(score).toBe('90');
    });

    it('should not record duplicate escape for same room', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '100');

      // 先设置锁，模拟已记录
      await redis.set(`penalty:lock:${mockUserId}:${mockRoomId}`, '1', 'EX', 3600, 'NX');

      await service.recordEscape(mockUserId, mockRoomId, mockGameType);

      // 不应再次保存
      expect(escapeRecordRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('checkPenalty', () => {
    it('should return no penalty for score 100', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '100');

      const status = await service.checkPenalty(mockUserId);

      expect(status.canPlay).toBe(true);
      expect(status.reputationScore).toBe(100);
      expect(status.penaltyLevel).toBe(0);
      expect(status.cooldownSeconds).toBe(0);
      expect(status.message).toBe('信誉良好，无惩罚');
    });

    it('should return level 1 penalty for score 85', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '85');

      const status = await service.checkPenalty(mockUserId);

      expect(status.canPlay).toBe(true);
      expect(status.reputationScore).toBe(85);
      expect(status.penaltyLevel).toBe(1);
      expect(status.message).toBe('匹配等待时间+30秒');
    });

    it('should return level 2 penalty for score 60', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '60');

      const status = await service.checkPenalty(mockUserId);

      expect(status.canPlay).toBe(false); // 60分属于等级2，禁止5分钟
      expect(status.reputationScore).toBe(60);
      expect(status.penaltyLevel).toBe(2);
      expect(status.cooldownSeconds).toBe(300);
    });

    it('should return level 3 penalty for score 40', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '40');

      const status = await service.checkPenalty(mockUserId);

      expect(status.canPlay).toBe(false);
      expect(status.reputationScore).toBe(40);
      expect(status.penaltyLevel).toBe(3);
      expect(status.cooldownSeconds).toBe(1800); // 30分钟
    });

    it('should return level 4 penalty for score 20', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '20');

      const status = await service.checkPenalty(mockUserId);

      expect(status.canPlay).toBe(false);
      expect(status.reputationScore).toBe(20);
      expect(status.penaltyLevel).toBe(4);
      expect(status.cooldownSeconds).toBe(86400); // 24小时
    });
  });

  describe('recordGameComplete', () => {
    it('should recover reputation score after game complete', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '80');

      await service.recordGameComplete(mockUserId, mockGameType);

      const score = await redis.get(`penalty:reputation:${mockUserId}`);
      expect(score).toBe('85'); // 80 + 5 = 85
    });

    it('should not exceed max reputation score', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '98');

      await service.recordGameComplete(mockUserId, mockGameType);

      const score = await redis.get(`penalty:reputation:${mockUserId}`);
      expect(score).toBe('100'); // 98 + 5 = 103 -> capped at 100
    });

    it('should clear match wait bonus when score >= 90', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '88');
      await redis.setex(`penalty:wait_bonus:${mockUserId}`, 86400, '30');

      await service.recordGameComplete(mockUserId, mockGameType);

      const score = await redis.get(`penalty:reputation:${mockUserId}`);
      expect(score).toBe('93');
      // 93 >= 90, 应清除等待加成
      const bonus = await redis.get(`penalty:wait_bonus:${mockUserId}`);
      expect(bonus).toBeNull();
    });
  });

  describe('getEscapeHistory', () => {
    it('should return escape history for user', async () => {
      const mockRecords: EscapeRecord[] = [
        {
          id: 1,
          user_id: String(mockUserId),
          room_id: 'ROOM1',
          game_type: 'chess',
          score_deducted: 10,
          status: 'active',
          note: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        } as EscapeRecord,
        {
          id: 2,
          user_id: String(mockUserId),
          room_id: 'ROOM2',
          game_type: 'chess',
          score_deducted: 10,
          status: 'active',
          note: null,
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-02'),
        } as EscapeRecord,
      ];

      jest.spyOn(escapeRecordRepository, 'find').mockResolvedValue(mockRecords);

      const result = await service.getEscapeHistory(mockUserId);

      expect(result).toHaveLength(2);
      expect(escapeRecordRepository.find).toHaveBeenCalledWith({
        where: { user_id: String(mockUserId) },
        order: { created_at: 'DESC' },
        take: 100,
      });
    });
  });

  describe('getMatchWaitBonus', () => {
    it('should return match wait bonus', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:wait_bonus:${mockUserId}`, 86400, '30');

      const bonus = await service.getMatchWaitBonus(mockUserId);

      expect(bonus).toBe(30);
    });

    it('should return 0 when no bonus', async () => {
      const bonus = await service.getMatchWaitBonus(mockUserId);

      expect(bonus).toBe(0);
    });
  });

  describe('getEscapeCount24h', () => {
    it('should return escape count within 24h', async () => {
      const redis = (service as any).redis;
      await redis.setex(`penalty:escape_count:${mockUserId}`, 86400, '3');

      const count = await service.getEscapeCount24h(mockUserId);

      expect(count).toBe(3);
    });

    it('should return 0 when no escapes', async () => {
      const count = await service.getEscapeCount24h(mockUserId);

      expect(count).toBe(0);
    });
  });

  describe('forgiveEscape', () => {
    it('should forgive escape and recover score', async () => {
      const mockRecord: EscapeRecord = {
        id: 1,
        user_id: String(mockUserId),
        room_id: mockRoomId,
        game_type: mockGameType,
        score_deducted: 10,
        status: 'active',
        note: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as EscapeRecord;

      jest.spyOn(escapeRecordRepository, 'findOne').mockResolvedValue(mockRecord);
      jest.spyOn(escapeRecordRepository, 'save').mockImplementation((entity) =>
        Promise.resolve(entity as EscapeRecord),
      );

      const redis = (service as any).redis;
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, '80');

      await service.forgiveEscape(1);

      expect(escapeRecordRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'forgiven',
          note: expect.stringContaining('已宽恕恢复10分'),
        }),
      );

      const score = await redis.get(`penalty:reputation:${mockUserId}`);
      expect(score).toBe('90'); // 80 + 10 = 90
    });

    it('should throw error for non-existent record', async () => {
      jest.spyOn(escapeRecordRepository, 'findOne').mockResolvedValue(null);

      await expect(service.forgiveEscape(999)).rejects.toThrow('Escape record 999 not found');
    });
  });

  describe('score boundaries', () => {
    it.each([
      [100, 0, true, 0],   // 满分
      [90, 0, true, 0],    // 90分边界
      [89, 1, true, 30],   // 89分 -> 等级1
      [70, 1, true, 30],   // 70分边界
      [69, 2, false, 300], // 69分 -> 等级2
      [50, 2, false, 300], // 50分边界
      [49, 3, false, 1800],// 49分 -> 等级3
      [30, 3, false, 1800],// 30分边界
      [29, 4, false, 86400],// 29分 -> 等级4
      [0, 4, false, 86400], // 0分
    ])('score %i should have level %i, canPlay=%s, cooldown=%i', async (
      score, expectedLevel, expectedCanPlay, expectedCooldown,
    ) => {
      const redis = (service as any).redis;
      // Clear ban keys first
      await redis.del(`penalty:ban:${mockUserId}:all`);
      await redis.del(`penalty:ban:${mockUserId}:${mockGameType}`);
      await redis.setex(`penalty:reputation:${mockUserId}`, 86400, String(score));

      const status = await service.checkPenalty(mockUserId);

      expect(status.penaltyLevel).toBe(expectedLevel);
      expect(status.canPlay).toBe(expectedCanPlay);
      // For banned levels, cooldown should match; for non-banned, should be 0
      if (expectedLevel >= 2) {
        expect(status.cooldownSeconds).toBe(expectedCooldown);
      } else {
        expect(status.cooldownSeconds).toBe(0);
      }
    });
  });
});
