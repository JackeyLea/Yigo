/**
 * EscrowService 单元测试
 *
 * 测试覆盖：
 * - 启动/取消托管
 * - 托管状态检查
 * - AI操作获取
 * - 超时处理
 * - 玩家重连
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EscrowService, EscrowStatus } from './escrow.service';
import { EventBus } from '../../plugin/event-bus';
import { AiEngineService } from '../../ai/ai-engine.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    mget: jest.fn().mockResolvedValue([]),
    keys: jest.fn().mockResolvedValue([]),
    incr: jest.fn().mockResolvedValue(1),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
  }));
});

describe('EscrowService', () => {
  let service: EscrowService;
  let configService: ConfigService;
  let eventBus: EventBus;
  let aiEngineService: AiEngineService;
  let redisMock: any;

  const mockRoomId = 'ABC123';
  const mockPlayerId = 'user_456';
  const mockInstanceId = 'ai-chess-medium-1234567890-abcde';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                redis: { host: 'localhost', port: 6379 },
                ESCROW_TIMEOUT_SECONDS: 60,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: EventBus,
          useValue: {
            publishToRoom: jest.fn(),
          },
        },
        {
          provide: AiEngineService,
          useValue: {
            createAI: jest.fn().mockResolvedValue({
              instanceId: mockInstanceId,
              pluginId: 'chess',
              difficulty: 'medium',
              status: 'idle',
              createdAt: new Date(),
              lastUsedAt: new Date(),
              totalRequests: 0,
            }),
            requestAction: jest.fn().mockResolvedValue({
              type: 'move',
              from: 'e2',
              to: 'e4',
            }),
            releaseAI: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<EscrowService>(EscrowService);
    configService = module.get<ConfigService>(ConfigService);
    eventBus = module.get<EventBus>(EventBus);
    aiEngineService = module.get<AiEngineService>(AiEngineService);

    // Access the redis instance
    redisMock = (service as any).redis;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startEscrow', () => {
    it('should start escrow successfully', async () => {
      redisMock.exists.mockResolvedValue(0);
      redisMock.setex.mockResolvedValue('OK');

      await service.startEscrow(mockRoomId, mockPlayerId);

      expect(aiEngineService.createAI).toHaveBeenCalledWith(
        'chess',
        'medium',
        { isEscrow: true },
      );
      expect(redisMock.setex).toHaveBeenCalled();
      expect(eventBus.publishToRoom).toHaveBeenCalledWith(
        mockRoomId,
        'escrow.started',
        expect.objectContaining({
          roomId: mockRoomId,
          playerId: mockPlayerId,
        }),
      );
    });

    it('should throw ConflictException if escrow already active', async () => {
      redisMock.exists.mockResolvedValue(1);

      await expect(service.startEscrow(mockRoomId, mockPlayerId)).rejects.toThrow(
        '托管已处于激活状态',
      );
      expect(aiEngineService.createAI).not.toHaveBeenCalled();
    });
  });

  describe('cancelEscrow', () => {
    it('should cancel escrow successfully', async () => {
      const status: EscrowStatus = {
        roomId: mockRoomId,
        playerId: mockPlayerId,
        startTime: Date.now(),
        aiInstanceId: mockInstanceId,
        timeoutSeconds: 60,
      };
      redisMock.get.mockResolvedValue(JSON.stringify(status));

      await service.cancelEscrow(mockRoomId, mockPlayerId);

      expect(aiEngineService.releaseAI).toHaveBeenCalledWith(mockInstanceId);
      expect(redisMock.del).toHaveBeenCalledTimes(2);
      expect(eventBus.publishToRoom).toHaveBeenCalledWith(
        mockRoomId,
        'escrow.cancelled',
        expect.any(Object),
      );
    });

    it('should do nothing if no active escrow', async () => {
      redisMock.get.mockResolvedValue(null);

      await service.cancelEscrow(mockRoomId, mockPlayerId);

      expect(aiEngineService.releaseAI).not.toHaveBeenCalled();
    });
  });

  describe('isEscrowed', () => {
    it('should return true when escrow is active', async () => {
      redisMock.exists.mockResolvedValue(1);

      const result = await service.isEscrowed(mockRoomId, mockPlayerId);

      expect(result).toBe(true);
    });

    it('should return false when escrow is not active', async () => {
      redisMock.exists.mockResolvedValue(0);

      const result = await service.isEscrowed(mockRoomId, mockPlayerId);

      expect(result).toBe(false);
    });
  });

  describe('getEscrowAction', () => {
    it('should return AI action when escrowed', async () => {
      const status: EscrowStatus = {
        roomId: mockRoomId,
        playerId: mockPlayerId,
        startTime: Date.now(),
        aiInstanceId: mockInstanceId,
        timeoutSeconds: 60,
      };
      redisMock.get.mockResolvedValue(JSON.stringify(status));

      const mockGameState = {
        board: [],
        currentPlayer: mockPlayerId,
        legalActions: [
          { type: 'move', from: 'e2', to: 'e4' },
          { type: 'move', from: 'd2', to: 'd4' },
        ],
      };

      const result = await service.getEscrowAction(mockRoomId, mockPlayerId, mockGameState);

      expect(result.isEscrowed).toBe(true);
      expect(result.action).toBeDefined();
      expect(aiEngineService.requestAction).toHaveBeenCalled();
    });

    it('should return empty result when not escrowed', async () => {
      redisMock.get.mockResolvedValue(null);

      const result = await service.getEscrowAction(mockRoomId, mockPlayerId, {});

      expect(result.isEscrowed).toBe(false);
      expect(aiEngineService.requestAction).not.toHaveBeenCalled();
    });
  });

  describe('handlePlayerReconnect', () => {
    it('should cancel escrow and return canContinue on reconnect', async () => {
      const status: EscrowStatus = {
        roomId: mockRoomId,
        playerId: mockPlayerId,
        startTime: Date.now() - 15000, // 15 seconds ago
        aiInstanceId: mockInstanceId,
        timeoutSeconds: 60,
      };
      redisMock.get.mockResolvedValue(JSON.stringify(status));

      const result = await service.handlePlayerReconnect(mockRoomId, mockPlayerId);

      expect(result.canContinue).toBe(true);
      expect(result.escrowDuration).toBeGreaterThanOrEqual(15);
      expect(aiEngineService.releaseAI).toHaveBeenCalled();
    });

    it('should return canContinue=false when not in escrow', async () => {
      redisMock.get.mockResolvedValue(null);

      const result = await service.handlePlayerReconnect(mockRoomId, mockPlayerId);

      expect(result.canContinue).toBe(false);
      expect(result.escrowDuration).toBe(0);
    });
  });

  describe('escrowResign', () => {
    it('should resign and clean up escrow', async () => {
      const status: EscrowStatus = {
        roomId: mockRoomId,
        playerId: mockPlayerId,
        startTime: Date.now(),
        aiInstanceId: mockInstanceId,
        timeoutSeconds: 60,
      };
      redisMock.get.mockResolvedValue(JSON.stringify(status));

      await service.escrowResign(mockRoomId, mockPlayerId);

      expect(aiEngineService.releaseAI).toHaveBeenCalledWith(mockInstanceId);
      expect(redisMock.del).toHaveBeenCalled();
      expect(eventBus.publishToRoom).toHaveBeenCalledWith(
        mockRoomId,
        'escrow.resigned',
        expect.any(Object),
      );
    });
  });

  describe('getRoomEscrowStatuses', () => {
    it('should return all escrow statuses in room', async () => {
      const status1: EscrowStatus = {
        roomId: mockRoomId,
        playerId: 'player1',
        startTime: Date.now(),
        aiInstanceId: 'ai-1',
        timeoutSeconds: 60,
      };
      const status2: EscrowStatus = {
        roomId: mockRoomId,
        playerId: 'player2',
        startTime: Date.now(),
        aiInstanceId: 'ai-2',
        timeoutSeconds: 60,
      };

      redisMock.keys.mockResolvedValue([
        `escrow:${mockRoomId}:player1`,
        `escrow:${mockRoomId}:player2`,
      ]);
      redisMock.mget.mockResolvedValue([
        JSON.stringify(status1),
        JSON.stringify(status2),
      ]);

      const result = await service.getRoomEscrowStatuses(mockRoomId);

      expect(result).toHaveLength(2);
      expect(result[0].playerId).toBe('player1');
      expect(result[1].playerId).toBe('player2');
    });

    it('should return empty array when no active escrows', async () => {
      redisMock.keys.mockResolvedValue([]);

      const result = await service.getRoomEscrowStatuses(mockRoomId);

      expect(result).toHaveLength(0);
    });
  });
});
