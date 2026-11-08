import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import Redis from 'ioredis';

import { EloService } from './elo.service';
import { MatchEngineService, QueuedPlayer, MatchCriteria } from './match-engine.service';
import { MatchQueueService, MatchStatus } from './match-queue.service';
import { MatchCleanupService } from './match-cleanup.service';
import { LeaderboardEntry } from '../common/entities/leaderboard-entry.entity';
import { RoomService } from '../room/room.service';
import { PluginService } from '../plugin/plugin.service';
import { UserService } from '../user/user.service';
import { EventBus } from '../plugin/event-bus';

// ==================== Mocks ====================

const mockRepository = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
});

const mockRedis = {
  zadd: jest.fn().mockResolvedValue(1),
  zrange: jest.fn().mockResolvedValue([]),
  zrem: jest.fn().mockResolvedValue(1),
  zcard: jest.fn().mockResolvedValue(0),
  zcount: jest.fn().mockResolvedValue(0),
  hmset: jest.fn().mockResolvedValue('OK'),
  hgetall: jest.fn().mockResolvedValue({}),
  hset: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(0),
  eval: jest.fn().mockResolvedValue(1),
  pipeline: jest.fn().mockReturnValue({
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }),
  scanStream: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
  }),
  on: jest.fn().mockReturnThis(),
};

// Mock ioredis constructor
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

const createMockService = () => ({
  createRoom: jest.fn().mockResolvedValue({ roomId: 'ROOM01' }),
  joinRoom: jest.fn().mockResolvedValue({ roomId: 'ROOM01' }),
});

describe('Match System', () => {
  let eloService: EloService;
  let matchEngine: MatchEngineService;
  let matchQueue: MatchQueueService;
  let cleanupService: MatchCleanupService;

  // Shared mocks that tests can configure
  let leaderboardRepository: any;
  let roomService: any;
  let eventBus: any;
  let configService: any;
  let schedulerRegistry: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EloService,
        MatchEngineService,
        MatchQueueService,
        MatchCleanupService,
        {
          provide: getRepositoryToken(LeaderboardEntry),
          useFactory: mockRepository,
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
        {
          provide: SchedulerRegistry,
          useValue: {
            addCronJob: jest.fn(),
          },
        },
        {
          provide: RoomService,
          useFactory: createMockService,
        },
        {
          provide: PluginService,
          useValue: {},
        },
        {
          provide: UserService,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: EventBus,
          useValue: {
            publishToPlayer: jest.fn().mockResolvedValue(undefined),
            publishToRoom: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    eloService = module.get<EloService>(EloService);
    matchEngine = module.get<MatchEngineService>(MatchEngineService);
    matchQueue = module.get<MatchQueueService>(MatchQueueService);
    cleanupService = module.get<MatchCleanupService>(MatchCleanupService);

    leaderboardRepository = module.get(getRepositoryToken(LeaderboardEntry));
    roomService = module.get(RoomService);
    eventBus = module.get(EventBus);
    configService = module.get(ConfigService);
    schedulerRegistry = module.get(SchedulerRegistry);

    // Reset Redis mocks
    Object.keys(mockRedis).forEach((key) => {
      if (typeof mockRedis[key] === 'function' && jest.isMockFunction(mockRedis[key])) {
        mockRedis[key].mockClear?.();
      }
    });
  });

  // ==================== EloService Tests ====================

  describe('EloService', () => {
    it('should be defined', () => {
      expect(eloService).toBeDefined();
    });

    describe('calculateExpectedScore', () => {
      it('same rating gives 0.5 expected score', () => {
        expect(eloService.calculateExpectedScore(1500, 1500)).toBe(0.5);
      });

      it('200 point advantage gives ~0.76 expected score', () => {
        expect(eloService.calculateExpectedScore(1600, 1400)).toBeCloseTo(0.7597, 2);
      });
    });

    describe('updateRating', () => {
      it('win increases rating', () => {
        const newRating = eloService.updateRating(1500, 0.5, 1.0, 20);
        expect(newRating).toBeGreaterThan(1500);
      });

      it('loss decreases rating', () => {
        const newRating = eloService.updateRating(1500, 0.5, 0.0, 20);
        expect(newRating).toBeLessThan(1500);
      });
    });

    describe('getKFactor', () => {
      it('returns 40 for new players (<=30 games)', () => {
        expect(eloService.getKFactor(30)).toBe(40);
      });

      it('returns 20 for intermediate players (31-100 games)', () => {
        expect(eloService.getKFactor(50)).toBe(20);
      });

      it('returns 10 for experienced players (>100 games)', () => {
        expect(eloService.getKFactor(101)).toBe(10);
      });
    });

    describe('updateRatingsDuel', () => {
      it('even match win gives K/2 points', () => {
        const [winner, loser] = eloService.updateRatingsDuel(1500, 1500, 1.0, 50, 50);
        expect(winner - 1500).toBe(10); // K=20, (1-0.5)*20/2 = 10
        expect(1500 - loser).toBe(10);
      });
    });
  });

  // ==================== MatchEngineService Tests ====================

  describe('MatchEngineService', () => {
    it('should be defined', () => {
      expect(matchEngine).toBeDefined();
    });

    describe('calculateRatingDiff', () => {
      it('calculates absolute difference', () => {
        expect(matchEngine.calculateRatingDiff(1500, 1600)).toBe(100);
        expect(matchEngine.calculateRatingDiff(1600, 1500)).toBe(100);
      });
    });

    describe('calculateDynamicRatingRange', () => {
      it('returns base range at 0 wait time', () => {
        expect(matchEngine.calculateDynamicRatingRange(200, 0)).toBe(200);
      });

      it('expands range with wait time', () => {
        const range30s = matchEngine.calculateDynamicRatingRange(200, 30000);
        const range60s = matchEngine.calculateDynamicRatingRange(200, 60000);
        expect(range30s).toBeGreaterThan(200);
        expect(range60s).toBeGreaterThan(range30s);
      });

      it('caps at 5x base range', () => {
        const veryLongWait = matchEngine.calculateDynamicRatingRange(200, 600000);
        expect(veryLongWait).toBe(1000);
      });
    });

    describe('calculateMatchScore', () => {
      it('returns lower score for closer ratings', () => {
        const player1 = createQueuedPlayer(1, 1500, Date.now() - 10000);
        const player2 = createQueuedPlayer(2, 1510, Date.now() - 10000);
        const player3 = createQueuedPlayer(3, 1700, Date.now() - 10000);

        const scoreClose = matchEngine.calculateMatchScore(player1, player2);
        const scoreFar = matchEngine.calculateMatchScore(player1, player3);

        expect(scoreClose).toBeLessThan(scoreFar);
      });
    });

    describe('canMatch', () => {
      it('same user cannot match', () => {
        const p = createQueuedPlayer(1, 1500);
        expect(matchEngine.canMatch(p, p)).toBe(false);
      });

      it('different plugin cannot match', () => {
        const p1 = createQueuedPlayer(1, 1500);
        const p2 = createQueuedPlayer(2, 1500);
        p2.pluginId = 'different-plugin';
        expect(matchEngine.canMatch(p1, p2)).toBe(false);
      });

      it('different mode cannot match', () => {
        const p1 = createQueuedPlayer(1, 1500);
        const p2 = createQueuedPlayer(2, 1500);
        p1.criteria.mode = 'ranked';
        p2.criteria.mode = 'casual';
        expect(matchEngine.canMatch(p1, p2)).toBe(false);
      });

      it('rating within range can match', () => {
        const p1 = createQueuedPlayer(1, 1500);
        const p2 = createQueuedPlayer(2, 1550);
        expect(matchEngine.canMatch(p1, p2)).toBe(true);
      });

      it('rating outside range cannot match', () => {
        const p1 = createQueuedPlayer(1, 1500);
        const p2 = createQueuedPlayer(2, 2000);
        expect(matchEngine.canMatch(p1, p2)).toBe(false);
      });
    });

    describe('findBestMatch', () => {
      it('finds closest rating match', () => {
        const target = createQueuedPlayer(1, 1500);
        const candidates = [
          createQueuedPlayer(2, 2000),
          createQueuedPlayer(3, 1520),
          createQueuedPlayer(4, 1800),
        ];

        const best = matchEngine.findBestMatch(target, candidates);
        expect(best).not.toBeNull();
        expect(best!.userId).toBe(3); // 1520 is closest to 1500
      });

      it('returns null when no valid match', () => {
        const target = createQueuedPlayer(1, 1500);
        const candidates = [createQueuedPlayer(2, 3000)];

        const best = matchEngine.findBestMatch(target, candidates);
        expect(best).toBeNull();
      });
    });

    describe('greedyMatch', () => {
      it('returns empty array for insufficient players', () => {
        const players = [createQueuedPlayer(1, 1500)];
        expect(matchEngine.greedyMatch(players, 2)).toEqual([]);
      });

      it('matches 2 players with similar ratings', () => {
        const players = [
          createQueuedPlayer(1, 1500),
          createQueuedPlayer(2, 1520),
        ];

        const groups = matchEngine.greedyMatch(players, 2);
        expect(groups).toHaveLength(1);
        expect(groups[0].players).toHaveLength(2);
      });

      it('only matches compatible players', () => {
        const players = [
          createQueuedPlayer(1, 1000),
          createQueuedPlayer(2, 1010),
          createQueuedPlayer(3, 2500), // Too high, won't match
        ];

        const groups = matchEngine.greedyMatch(players, 2);
        expect(groups).toHaveLength(1);
        expect(groups[0].players.map((p) => p.userId).sort()).toEqual([1, 2]);
      });

      it('does not include matched players in multiple groups', () => {
        const players = [
          createQueuedPlayer(1, 1500),
          createQueuedPlayer(2, 1520),
          createQueuedPlayer(3, 1540),
          createQueuedPlayer(4, 1560),
        ];

        const groups = matchEngine.greedyMatch(players, 2);
        expect(groups.length).toBeGreaterThan(0);

        // Check no duplicate players across groups
        const allPlayerIds = groups.flatMap((g) => g.players.map((p) => p.userId));
        const uniqueIds = new Set(allPlayerIds);
        expect(allPlayerIds.length).toBe(uniqueIds.size);
      });

      it('handles 4 players with 2-player groups', () => {
        const players = [
          createQueuedPlayer(1, 1400),
          createQueuedPlayer(2, 1450),
          createQueuedPlayer(3, 1500),
          createQueuedPlayer(4, 1550),
        ];

        const groups = matchEngine.greedyMatch(players, 2);
        expect(groups.length).toBe(2);
      });
    });

    describe('createAIPlayers', () => {
      it('creates requested number of AI players', () => {
        const aiPlayers = matchEngine.createAIPlayers(1500, 'TKT-123', 'hard', 3);
        expect(aiPlayers).toHaveLength(3);
      });

      it('AI players have negative userIds', () => {
        const aiPlayers = matchEngine.createAIPlayers(1500, 'TKT-123', 'medium', 1);
        expect(aiPlayers[0].userId).toBeLessThan(0);
      });

      it('AI players have isAI flag', () => {
        const aiPlayers = matchEngine.createAIPlayers(1500, 'TKT-123', 'easy', 1);
        expect(aiPlayers[0].isAI).toBe(true);
      });

      it('AI rating is close to target rating', () => {
        const aiPlayers = matchEngine.createAIPlayers(1500, 'TKT-123', 'medium', 1);
        expect(Math.abs(aiPlayers[0].rating - 1500)).toBeLessThanOrEqual(50);
      });
    });

    describe('getRecommendedGroupSize', () => {
      it('defaults to 2', () => {
        expect(matchEngine.getRecommendedGroupSize({})).toBe(2);
      });

      it('uses maxPlayers when specified', () => {
        expect(matchEngine.getRecommendedGroupSize({ maxPlayers: 4 })).toBe(4);
      });

      it('uses average when both min and max specified', () => {
        expect(matchEngine.getRecommendedGroupSize({ minPlayers: 2, maxPlayers: 6 })).toBe(4);
      });
    });
  });

  // ==================== MatchQueueService Tests ====================

  describe('MatchQueueService', () => {
    it('should be defined', () => {
      expect(matchQueue).toBeDefined();
    });

    describe('enqueue', () => {
      it('should create ticket and add to queue', async () => {
        // Setup mocks
        mockRedis.get.mockResolvedValue(null); // No existing ticket
        mockRedis.hmset.mockResolvedValue('OK');
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.setex.mockResolvedValue('OK');

        leaderboardRepository.findOne.mockResolvedValue({ rating_score: 1500 });

        const criteria: MatchCriteria = {
          ratingRange: 200,
          maxWaitTime: 60,
          allowAI: true,
        };

        const ticketId = await matchQueue.enqueue(1, 'chess', criteria);

        expect(ticketId).toBeDefined();
        expect(ticketId).toMatch(/^TKT-/);
        expect(mockRedis.hmset).toHaveBeenCalled();
        expect(mockRedis.zadd).toHaveBeenCalledWith(
          'match:queue:chess',
          1500,
          expect.any(String),
        );
      });

      it('should use default rating 1000 when no leaderboard entry', async () => {
        mockRedis.get.mockResolvedValue(null);
        mockRedis.hmset.mockResolvedValue('OK');
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.setex.mockResolvedValue('OK');

        leaderboardRepository.findOne.mockResolvedValue(null);

        const criteria: MatchCriteria = { ratingRange: 200 };

        await matchQueue.enqueue(1, 'chess', criteria);

        // Verify it was called with rating 1000
        const hmsetCall = mockRedis.hmset.mock.calls[0];
        const ticketData = hmsetCall[1];
        expect(ticketData.rating).toBe('1000');
      });

      it('should reject if user already in queue', async () => {
        // 仅用户票key返回已存在的ticketId，状态key返回null以走票Hash回退逻辑
        mockRedis.get.mockImplementation(async (key: string) => {
          if (key === 'match:user:1') return 'TKT-EXISTING';
          return null;
        });
        mockRedis.hgetall.mockResolvedValue({
          userId: '1',
          status: 'queued',
        });

        const criteria: MatchCriteria = { ratingRange: 200 };

        await expect(matchQueue.enqueue(1, 'chess', criteria)).rejects.toThrow(
          '用户已在匹配队列中',
        );
      });
    });

    describe('dequeue', () => {
      it('should remove user from queue', async () => {
        mockRedis.hgetall.mockResolvedValue({
          userId: '1',
          ticketId: 'TKT-123',
          pluginId: 'chess',
          status: 'queued',
        });
        mockRedis.zrem.mockResolvedValue(1);
        mockRedis.hset.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.del.mockResolvedValue(1);

        await matchQueue.dequeue(1, 'TKT-123');

        expect(mockRedis.zrem).toHaveBeenCalledWith('match:queue:chess', 'TKT-123');
        expect(mockRedis.del).toHaveBeenCalledWith('match:user:1');
      });

      it('should throw if ticket not found', async () => {
        mockRedis.hgetall.mockResolvedValue({});

        await expect(matchQueue.dequeue(1, 'TKT-NOTFOUND')).rejects.toThrow(
          '匹配票不存在',
        );
      });

      it('should throw if user does not own ticket', async () => {
        mockRedis.hgetall.mockResolvedValue({
          userId: '2',
          ticketId: 'TKT-123',
          status: 'queued',
        });

        await expect(matchQueue.dequeue(1, 'TKT-123')).rejects.toThrow(
          '无权取消他人的匹配',
        );
      });

      it('should throw if match already accepted', async () => {
        mockRedis.hgetall.mockResolvedValue({
          userId: '1',
          ticketId: 'TKT-123',
          pluginId: 'chess',
          status: 'accepted',
        });

        await expect(matchQueue.dequeue(1, 'TKT-123')).rejects.toThrow(
          '匹配已接受，无法取消',
        );
      });
    });

    describe('getMatchStatus', () => {
      it('should return status from status key', async () => {
        const mockStatus: MatchStatus = {
          ticketId: 'TKT-123',
          status: 'queued',
          elapsedTime: 10,
          estimatedWait: 30,
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(mockStatus));

        const status = await matchQueue.getMatchStatus('TKT-123');

        expect(status).not.toBeNull();
        expect(status!.ticketId).toBe('TKT-123');
        expect(status!.status).toBe('queued');
      });

      it('should return null for non-existent ticket', async () => {
        mockRedis.get.mockResolvedValue(null);
        mockRedis.hgetall.mockResolvedValue({});

        const status = await matchQueue.getMatchStatus('TKT-NOTFOUND');

        expect(status).toBeNull();
      });
    });

    describe('processMatch', () => {
      it('should process queue and create matches', async () => {
        // Setup queue with 2 players
        mockRedis.zrange.mockResolvedValue(['TKT-1', 'TKT-2']);

        // Setup ticket data
        mockRedis.hgetall
          .mockResolvedValueOnce({
            userId: '1',
            ticketId: 'TKT-1',
            pluginId: 'chess',
            rating: '1500',
            joinTime: String(Date.now()),
            criteria: JSON.stringify({ ratingRange: 200, mode: 'normal' }),
            status: 'queued',
          })
          .mockResolvedValueOnce({
            userId: '2',
            ticketId: 'TKT-2',
            pluginId: 'chess',
            rating: '1520',
            joinTime: String(Date.now()),
            criteria: JSON.stringify({ ratingRange: 200, mode: 'normal' }),
            status: 'queued',
          });

        mockRedis.hset.mockResolvedValue(1);
        mockRedis.zrem.mockResolvedValue(1);
        mockRedis.setex.mockResolvedValue('OK');

        await matchQueue.processMatch('chess');

        // Verify players were matched
        expect(mockRedis.hset).toHaveBeenCalledWith(
          expect.any(String),
          'status',
          'matched',
        );
      });

      it('should handle empty queue', async () => {
        mockRedis.zrange.mockResolvedValue([]);

        await matchQueue.processMatch('chess');

        expect(mockRedis.hgetall).not.toHaveBeenCalled();
      });

      it('should skip non-queued tickets', async () => {
        mockRedis.zrange.mockResolvedValue(['TKT-1']);
        mockRedis.hgetall.mockResolvedValue({
          userId: '1',
          ticketId: 'TKT-1',
          pluginId: 'chess',
          rating: '1500',
          joinTime: String(Date.now()),
          criteria: '{}',
          status: 'matched', // Not queued
        });

        await matchQueue.processMatch('chess');

        expect(mockRedis.hset).not.toHaveBeenCalled();
      });
    });

    describe('acceptMatch', () => {
      it('should accept matched ticket', async () => {
        mockRedis.hgetall.mockResolvedValue({
          userId: '1',
          ticketId: 'TKT-123',
          pluginId: 'chess',
          status: 'matched',
        });
        mockRedis.hset.mockResolvedValue(1);
        mockRedis.setex.mockResolvedValue('OK');
        mockRedis.get.mockResolvedValue(
          JSON.stringify({
            matchedPlayers: [
              { userId: 1, ticketId: 'TKT-123', rating: 1500 },
              { userId: 2, ticketId: 'TKT-124', rating: 1520 },
            ],
          }),
        );

        await matchQueue.acceptMatch('TKT-123');

        expect(mockRedis.hset).toHaveBeenCalledWith(
          'match:ticket:TKT-123',
          'status',
          'accepted',
        );
      });

      it('should throw if ticket not in matched state', async () => {
        mockRedis.hgetall.mockResolvedValue({
          userId: '1',
          ticketId: 'TKT-123',
          status: 'queued',
        });

        await expect(matchQueue.acceptMatch('TKT-123')).rejects.toThrow(
          '当前状态为 queued，无法接受匹配',
        );
      });
    });

    describe('rejectMatch', () => {
      it('should reject matched ticket', async () => {
        mockRedis.hgetall.mockResolvedValue({
          userId: '1',
          ticketId: 'TKT-123',
          pluginId: 'chess',
          status: 'matched',
          criteria: '{}',
        });
        mockRedis.get.mockResolvedValue(
          JSON.stringify({
            matchedPlayers: [
              { userId: 1, ticketId: 'TKT-123', rating: 1500 },
              { userId: 2, ticketId: 'TKT-124', rating: 1520 },
            ],
          }),
        );
        mockRedis.hset.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zrem.mockResolvedValue(1);
        mockRedis.del.mockResolvedValue(1);
        mockRedis.zadd.mockResolvedValue(1);

        await matchQueue.rejectMatch('TKT-123');

        expect(mockRedis.hset).toHaveBeenCalledWith(
          'match:ticket:TKT-123',
          'status',
          'rejected',
        );
      });
    });
  });

  // ==================== MatchCleanupService Tests ====================

  describe('MatchCleanupService', () => {
    it('should be defined', () => {
      expect(cleanupService).toBeDefined();
    });

    describe('runManualCleanup', () => {
      it('should run cleanup for all plugins', async () => {
        mockRedis.scanStream.mockReturnValue({
          on: jest.fn().mockImplementation(function (event: string, cb: any) {
            if (event === 'data') {
              cb(['match:queue:chess', 'match:queue:go']);
            }
            if (event === 'end') {
              cb();
            }
            return this;
          }),
        });

        mockRedis.zcard.mockResolvedValue(0);

        const result = await cleanupService.runManualCleanup();

        expect(result.processed).toBe(2);
      });

      it('should run cleanup for specific plugin', async () => {
        mockRedis.zcard.mockResolvedValue(0);

        const result = await cleanupService.runManualCleanup('chess');

        expect(result.processed).toBe(1);
      });
    });
  });
});

// ==================== Helper Functions ====================

function createQueuedPlayer(
  userId: number,
  rating: number,
  joinTime?: number,
  criteria?: MatchCriteria,
): QueuedPlayer {
  return {
    userId,
    ticketId: `TKT-${userId}`,
    rating,
    joinTime: joinTime || Date.now(),
    criteria: criteria || { ratingRange: 200, mode: 'normal' },
    pluginId: 'chess',
  };
}
