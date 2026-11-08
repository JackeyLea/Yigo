/**
 * CollectionService 单元测试
 *
 * 测试覆盖：
 * - 收藏/取消收藏
 * - 收藏列表查询
 * - 备注管理
 * - 标签管理
 * - 分享功能
 * - 统计功能
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionService, PaginatedResult, CollectedGameDetail } from './collection.service';
import { CollectedGame } from './entities/collected-game.entity';

// Mock ioredis
const mockRedisData: Map<string, string> = new Map();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    setex: jest.fn().mockImplementation((key: string, seconds: number, value: string) => {
      mockRedisData.set(key, value);
      return Promise.resolve('OK');
    }),
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(mockRedisData.get(key) || null);
    }),
    del: jest.fn().mockImplementation((key: string) => {
      mockRedisData.delete(key);
      return Promise.resolve(1);
    }),
    exists: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(mockRedisData.has(key) ? 1 : 0);
    }),
    incr: jest.fn().mockResolvedValue(1),
    zincrby: jest.fn().mockResolvedValue(1),
    zrevrange: jest.fn().mockResolvedValue(['经典对局', '开局陷阱', '残局技巧']),
    expire: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn().mockReturnValue({
      zincrby: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
  }));
});

describe('CollectionService', () => {
  let service: CollectionService;
  let collectedGameRepository: Repository<CollectedGame>;

  const mockUserId = 12345;
  const mockRecordId = 10001;

  beforeEach(async () => {
    mockRedisData.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                redis: { host: 'localhost', port: 6379 },
                SHARE_BASE_URL: 'https://chess.example.com/share',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: getRepositoryToken(CollectedGame),
          useValue: {
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn().mockImplementation((entity) =>
              Promise.resolve({
                ...entity,
                id: 1,
                created_at: new Date(),
                updated_at: new Date(),
              }),
            ),
            findOne: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
            findAndCount: jest.fn().mockResolvedValue([[], 0]),
            count: jest.fn().mockResolvedValue(0),
            remove: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<CollectionService>(CollectionService);
    collectedGameRepository = module.get<Repository<CollectedGame>>(
      getRepositoryToken(CollectedGame),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('collectGame', () => {
    it('should collect a game successfully', async () => {
      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(null);

      await service.collectGame(mockUserId, mockRecordId, ['经典对局']);

      expect(collectedGameRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: String(mockUserId),
          record_id: mockRecordId,
          tags: ['经典对局'],
        }),
      );
      expect(collectedGameRepository.save).toHaveBeenCalled();
    });

    it('should throw ConflictException when already collected', async () => {
      const existing: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: [],
        share_token: null,
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(existing);

      await expect(service.collectGame(mockUserId, mockRecordId)).rejects.toThrow(
        '该对局已被收藏',
      );
    });
  });

  describe('uncollectGame', () => {
    it('should uncollect a game successfully', async () => {
      const existing: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: [],
        share_token: null,
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(existing);
      jest.spyOn(collectedGameRepository, 'remove').mockResolvedValue(existing);

      await service.uncollectGame(mockUserId, mockRecordId);

      expect(collectedGameRepository.remove).toHaveBeenCalledWith(existing);
    });

    it('should throw NotFoundException when collection not found', async () => {
      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(null);

      await expect(service.uncollectGame(mockUserId, mockRecordId)).rejects.toThrow(
        '收藏记录不存在',
      );
    });
  });

  describe('getCollections', () => {
    it('should return paginated collections', async () => {
      const mockCollections: CollectedGame[] = [
        {
          id: 1,
          user_id: String(mockUserId),
          record_id: 10001,
          game_type: 'chess',
          note: '精彩对局',
          tags: ['经典'],
          share_token: null,
          view_count: 5,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 2,
          user_id: String(mockUserId),
          record_id: 10002,
          game_type: 'go',
          note: null,
          tags: ['布局'],
          share_token: 'token123',
          view_count: 3,
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-02'),
        },
      ];

      jest.spyOn(collectedGameRepository, 'findAndCount').mockResolvedValue([
        mockCollections,
        2,
      ]);

      const result = await service.getCollections(mockUserId, 1, 20);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by game type', async () => {
      jest.spyOn(collectedGameRepository, 'findAndCount').mockImplementation(
        async (options: any) => {
          expect(options.where.game_type).toBe('chess');
          return [[], 0];
        },
      );

      await service.getCollections(mockUserId, 1, 20, 'chess');

      expect(collectedGameRepository.findAndCount).toHaveBeenCalled();
    });

    it('should filter by tags', async () => {
      const mockCollections: CollectedGame[] = [
        {
          id: 1,
          user_id: String(mockUserId),
          record_id: 10001,
          game_type: 'chess',
          note: null,
          tags: ['经典', '开局'],
          share_token: null,
          view_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          user_id: String(mockUserId),
          record_id: 10002,
          game_type: 'chess',
          note: null,
          tags: ['残局'],
          share_token: null,
          view_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      jest.spyOn(collectedGameRepository, 'findAndCount').mockResolvedValue([
        mockCollections,
        2,
      ]);

      const result = await service.getCollections(mockUserId, 1, 20, undefined, ['经典']);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].tags).toContain('经典');
    });
  });

  describe('getCollectionDetail', () => {
    it('should return collection detail with incremented view count', async () => {
      const mockCollection: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: '测试备注',
        tags: ['经典'],
        share_token: null,
        view_count: 4,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(mockCollection);
      jest.spyOn(collectedGameRepository, 'save').mockImplementation((entity) =>
        Promise.resolve(entity as CollectedGame),
      );

      const result = await service.getCollectionDetail(mockUserId, mockRecordId);

      expect(result.recordId).toBe(mockRecordId);
      expect(result.viewCount).toBe(5); // 4 + 1
      expect(collectedGameRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ view_count: 5 }),
      );
    });

    it('should throw NotFoundException when collection not found', async () => {
      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(null);

      await expect(service.getCollectionDetail(mockUserId, mockRecordId)).rejects.toThrow(
        '收藏记录不存在',
      );
    });
  });

  describe('addNote', () => {
    it('should add note to collection', async () => {
      const mockCollection: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: [],
        share_token: null,
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(mockCollection);
      jest.spyOn(collectedGameRepository, 'save').mockImplementation((entity) =>
        Promise.resolve(entity as CollectedGame),
      );

      await service.addNote(mockUserId, mockRecordId, '这是一个精彩的开局');

      expect(collectedGameRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ note: '这是一个精彩的开局' }),
      );
    });
  });

  describe('addTags', () => {
    it('should add tags to collection', async () => {
      const mockCollection: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: ['经典'],
        share_token: null,
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(mockCollection);
      jest.spyOn(collectedGameRepository, 'save').mockImplementation((entity) =>
        Promise.resolve(entity as CollectedGame),
      );

      await service.addTags(mockUserId, mockRecordId, ['开局陷阱', '精彩']);

      expect(collectedGameRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['经典', '开局陷阱', '精彩']),
        }),
      );
    });
  });

  describe('removeTags', () => {
    it('should remove tags from collection', async () => {
      const mockCollection: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: ['经典', '开局', '残局'],
        share_token: null,
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(mockCollection);
      jest.spyOn(collectedGameRepository, 'save').mockImplementation((entity) =>
        Promise.resolve(entity as CollectedGame),
      );

      await service.removeTags(mockUserId, mockRecordId, ['开局']);

      expect(collectedGameRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['经典', '残局']),
        }),
      );
      expect(collectedGameRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['开局']),
        }),
      );
    });
  });

  describe('shareCollection', () => {
    it('should create share link for collection', async () => {
      const mockCollection: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: [],
        share_token: null,
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(mockCollection);
      jest.spyOn(collectedGameRepository, 'save').mockImplementation((entity) =>
        Promise.resolve(entity as CollectedGame),
      );

      const result = await service.shareCollection(mockUserId, mockRecordId);

      expect(result).toContain('https://chess.example.com/share/');
      expect(collectedGameRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          share_token: expect.any(String),
        }),
      );
    });

    it('should return existing share link if already shared', async () => {
      const mockCollection: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: [],
        share_token: 'existingtoken123',
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(mockCollection);

      const result = await service.shareCollection(mockUserId, mockRecordId);

      expect(result).toBe('https://chess.example.com/share/existingtoken123');
      // 不应再次保存
      expect(collectedGameRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeShare', () => {
    it('should revoke share for collection', async () => {
      const mockCollection: CollectedGame = {
        id: 1,
        user_id: String(mockUserId),
        record_id: mockRecordId,
        game_type: 'chess',
        note: null,
        tags: [],
        share_token: 'token123',
        view_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(collectedGameRepository, 'findOne').mockResolvedValue(mockCollection);
      jest.spyOn(collectedGameRepository, 'save').mockImplementation((entity) =>
        Promise.resolve(entity as CollectedGame),
      );

      await service.revokeShare(mockUserId, mockRecordId);

      expect(collectedGameRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ share_token: null }),
      );
    });
  });

  describe('getCollectionCount', () => {
    it('should return collection count', async () => {
      jest.spyOn(collectedGameRepository, 'count').mockResolvedValue(42);

      const count = await service.getCollectionCount(mockUserId);

      expect(count).toBe(42);
    });

    it('should return cached count if available', async () => {
      mockRedisData.set(`collection:count:${mockUserId}`, '100');

      const count = await service.getCollectionCount(mockUserId);

      expect(count).toBe(100);
      expect(collectedGameRepository.count).not.toHaveBeenCalled();
    });
  });

  describe('getUserTags', () => {
    it('should return unique tags for user', async () => {
      const mockCollections: Partial<CollectedGame>[] = [
        { tags: ['经典', '开局'] },
        { tags: ['残局', '经典'] }, // '经典' 重复
        { tags: ['中局'] },
        { tags: null },
      ];

      jest.spyOn(collectedGameRepository, 'find').mockResolvedValue(mockCollections as CollectedGame[]);

      const tags = await service.getUserTags(mockUserId);

      expect(tags).toContain('经典');
      expect(tags).toContain('开局');
      expect(tags).toContain('残局');
      expect(tags).toContain('中局');
      expect(tags).toHaveLength(4); // 无重复
    });
  });

  describe('getPopularTags', () => {
    it('should return popular tags', async () => {
      const tags = await service.getPopularTags('chess', 10);

      expect(tags).toEqual(['经典对局', '开局陷阱', '残局技巧']);
    });
  });
});
