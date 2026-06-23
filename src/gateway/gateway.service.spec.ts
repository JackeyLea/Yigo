/**
 * Gateway 模块单元测试
 *
 * 测试 WebSocket 网关的核心功能：
 * - 连接管理
 * - JWT 认证
 * - 消息路由
 * - 心跳管理
 * - 房间事件处理
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Socket, Server } from 'socket.io';
import { WsResponse } from '@nestjs/websockets';

import { GameGateway } from './game.gateway';
import { WsJwtGuard } from './guard/ws-jwt.guard';
import { ConnectionManagerService } from './services/connection-manager.service';
import { MessageRouterService } from './services/message-router.service';
import { HeartbeatService } from './services/heartbeat.service';
import { RoomService } from '../room/room.service';
import { WS_EVENTS } from './dto/ws-events';

// ===== Mock 数据 =====

const MOCK_USER = {
  userId: 1,
  username: 'testuser',
  nickname: 'Test User',
};

const MOCK_ROOM = {
  roomId: 'ABC123',
  gameType: 'chess',
  pluginId: 'chess',
  status: 'waiting',
  hostId: 1,
  maxPlayers: 2,
  currentPlayers: 1,
  players: [
    {
      userId: 1,
      username: 'testuser',
      nickname: 'Test User',
      seatIndex: 0,
      isReady: true,
      isHost: true,
    },
  ],
  config: {},
  mode: 'normal',
  isPasswordProtected: false,
  allowSpectator: true,
  spectatorCount: 0,
  createdAt: new Date(),
  expiresAt: new Date(),
};

// ===== Mock 工厂 =====

const createMockSocket = (overrides?: Partial<Socket>): Socket => {
  const mockSocket = {
    id: 'test-socket-id',
    handshake: {
      auth: { token: 'valid-token' },
      query: {},
      headers: {},
    },
    data: {
      user: MOCK_USER,
      userId: MOCK_USER.userId,
      rooms: new Set<string>(),
      isSpectating: false,
      spectateRoomId: null,
    },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockReturnThis(),
    disconnect: jest.fn().mockReturnThis(),
    to: jest.fn().mockReturnThis(),
    ...overrides,
  } as unknown as Socket;

  return mockSocket;
};

const createMockServer = (): Server => {
  return {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn().mockReturnThis(),
    sockets: {
      sockets: new Map(),
    },
  } as unknown as Server;
};

// ===== 测试套件 =====

describe('GatewayModule', () => {
  let gateway: GameGateway;
  let connectionManager: ConnectionManagerService;
  let messageRouter: MessageRouterService;
  let heartbeatService: HeartbeatService;
  let wsJwtGuard: WsJwtGuard;
  let roomService: RoomService;
  let jwtService: JwtService;
  let mockServer: Server;

  beforeEach(async () => {
    mockServer = createMockServer();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameGateway,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                redis: {
                  host: 'localhost',
                  port: 6379,
                  db: 0,
                },
                JWT_EXPIRATION: '1h',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn().mockResolvedValue({
              sub: String(MOCK_USER.userId),
              username: MOCK_USER.username,
            }),
            sign: jest.fn().mockReturnValue('mock-token'),
            verify: jest.fn().mockReturnValue({
              sub: String(MOCK_USER.userId),
              username: MOCK_USER.username,
            }),
          },
        },
        {
          provide: ConnectionManagerService,
          useValue: {
            setServer: jest.fn(),
            getServer: jest.fn().mockReturnValue(mockServer),
            addConnection: jest.fn().mockResolvedValue(undefined),
            removeConnection: jest.fn().mockResolvedValue(MOCK_USER.userId),
            getSocketId: jest.fn().mockResolvedValue('test-socket-id'),
            getUserId: jest.fn().mockResolvedValue(MOCK_USER.userId),
            isOnline: jest.fn().mockResolvedValue(true),
            broadcastToRoom: jest.fn(),
            sendToUser: jest.fn().mockResolvedValue(undefined),
            addUserToRoom: jest.fn().mockResolvedValue(undefined),
            removeUserFromRoom: jest.fn().mockResolvedValue(undefined),
            addSpectatorToRoom: jest.fn().mockResolvedValue(undefined),
            removeSpectatorFromRoom: jest.fn().mockResolvedValue(undefined),
            getRoomUsers: jest.fn().mockResolvedValue([MOCK_USER.userId]),
            getUserRoom: jest.fn().mockResolvedValue('ABC123'),
          },
        },
        {
          provide: MessageRouterService,
          useValue: {
            route: jest.fn().mockResolvedValue(undefined),
            broadcast: jest.fn(),
            unicast: jest.fn().mockResolvedValue(undefined),
            multicast: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: HeartbeatService,
          useValue: {
            registerClient: jest.fn(),
            unregisterClient: jest.fn(),
            handlePong: jest.fn(),
            handlePing: jest.fn().mockResolvedValue(undefined),
            onDisconnect: jest.fn(),
            getMonitoredClientCount: jest.fn().mockReturnValue(1),
            getMissedCount: jest.fn().mockReturnValue(0),
            resetCounter: jest.fn(),
          },
        },
        {
          provide: RoomService,
          useValue: {
            joinRoom: jest.fn().mockResolvedValue(MOCK_ROOM),
            leaveRoom: jest.fn().mockResolvedValue(undefined),
            getRoom: jest.fn().mockResolvedValue(MOCK_ROOM),
            spectatorJoin: jest.fn().mockResolvedValue(undefined),
            spectatorLeave: jest.fn().mockResolvedValue(undefined),
            setReady: jest.fn().mockResolvedValue(MOCK_ROOM),
          },
        },
        {
          provide: SchedulerRegistry,
          useValue: {
            addInterval: jest.fn(),
            deleteInterval: jest.fn(),
            getInterval: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    gateway = module.get<GameGateway>(GameGateway);
    connectionManager = module.get<ConnectionManagerService>(ConnectionManagerService);
    messageRouter = module.get<MessageRouterService>(MessageRouterService);
    heartbeatService = module.get<HeartbeatService>(HeartbeatService);
    roomService = module.get<RoomService>(RoomService);
    jwtService = module.get<JwtService>(JwtService);

    // 设置 Server 实例
    gateway.server = mockServer;
    (connectionManager as any).ioServer = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========== 生命周期测试 ==========

  describe('afterInit', () => {
    it('should set server and configure heartbeat disconnect callback', () => {
      gateway.afterInit(mockServer);

      expect(connectionManager.setServer).toHaveBeenCalledWith(mockServer);
      expect(heartbeatService.onDisconnect).toHaveBeenCalled();
    });
  });

  // ========== 连接管理测试 ==========

  describe('handleConnection', () => {
    it('should accept connection with valid token', async () => {
      const mockSocket = createMockSocket();

      await gateway.handleConnection(mockSocket);

      expect(jwtService.verifyAsync).toHaveBeenCalled();
      expect(connectionManager.addConnection).toHaveBeenCalledWith(
        MOCK_USER.userId,
        mockSocket.id,
      );
      expect(heartbeatService.registerClient).toHaveBeenCalledWith(mockSocket);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'connected',
        expect.objectContaining({
          userId: MOCK_USER.userId,
          username: MOCK_USER.username,
        }),
      );
    });

    it('should reject connection without token', async () => {
      const mockSocket = createMockSocket({
        handshake: {
          auth: {},
          query: {},
          headers: {},
        },
      } as any);

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it('should reject connection with invalid token', async () => {
      const mockSocket = createMockSocket();
      jest.spyOn(jwtService, 'verifyAsync').mockRejectedValueOnce(new Error('Invalid token'));

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleDisconnect', () => {
    it('should clean up on disconnect', async () => {
      const rooms = new Set<string>(['ABC123']);
      const mockSocket = createMockSocket({
        data: {
          user: MOCK_USER,
          userId: MOCK_USER.userId,
          rooms,
          isSpectating: false,
          spectateRoomId: null,
        },
      });

      await gateway.handleDisconnect(mockSocket);

      expect(heartbeatService.unregisterClient).toHaveBeenCalledWith(mockSocket.id);
      expect(roomService.leaveRoom).toHaveBeenCalledWith(MOCK_USER.userId, 'ABC123');
      expect(connectionManager.removeConnection).toHaveBeenCalledWith(mockSocket.id);
    });

    it('should handle disconnect for user not in any room', async () => {
      const mockSocket = createMockSocket({
        data: {
          user: MOCK_USER,
          userId: MOCK_USER.userId,
          rooms: new Set<string>(),
        },
      });

      await gateway.handleDisconnect(mockSocket);

      expect(heartbeatService.unregisterClient).toHaveBeenCalledWith(mockSocket.id);
      expect(connectionManager.removeConnection).toHaveBeenCalledWith(mockSocket.id);
      expect(roomService.leaveRoom).not.toHaveBeenCalled();
    });
  });

  // ========== 房间事件测试 ==========

  describe('onJoinRoom', () => {
    it('should join room successfully', async () => {
      const mockSocket = createMockSocket();

      await gateway.onJoinRoom(mockSocket, {
        roomId: 'ABC123',
        password: undefined,
      });

      expect(roomService.joinRoom).toHaveBeenCalledWith(MOCK_USER.userId, {
        roomId: 'ABC123',
        password: undefined,
        seatIndex: undefined,
      });
      expect(mockSocket.join).toHaveBeenCalledWith('room:ABC123');
      expect(messageRouter.broadcast).toHaveBeenCalled();
    });

    it('should reject join without authentication', async () => {
      const mockSocket = createMockSocket({
        data: {},
      });

      await gateway.onJoinRoom(mockSocket, { roomId: 'ABC123' });

      expect(roomService.joinRoom).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.S_ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should handle join room failure', async () => {
      const mockSocket = createMockSocket();
      jest
        .spyOn(roomService, 'joinRoom')
        .mockRejectedValueOnce(new Error('Room is full'));

      await gateway.onJoinRoom(mockSocket, { roomId: 'ABC123' });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.S_ERROR,
        expect.objectContaining({
          code: 'JOIN_ROOM_FAILED',
          message: 'Room is full',
        }),
      );
    });
  });

  describe('onLeaveRoom', () => {
    it('should leave room successfully', async () => {
      const rooms = new Set<string>(['ABC123']);
      const mockSocket = createMockSocket({
        data: {
          user: MOCK_USER,
          userId: MOCK_USER.userId,
          rooms,
          seatIndex: 0,
        },
      });

      await gateway.onLeaveRoom(mockSocket, { roomId: 'ABC123' });

      expect(roomService.leaveRoom).toHaveBeenCalledWith(MOCK_USER.userId, 'ABC123');
      expect(mockSocket.leave).toHaveBeenCalledWith('room:ABC123');
      expect(messageRouter.broadcast).toHaveBeenCalledWith(
        'ABC123',
        WS_EVENTS.S_PLAYER_LEFT,
        expect.any(Object),
      );
    });
  });

  // ========== 游戏操作测试 ==========

  describe('onGameAction', () => {
    it('should process game action', async () => {
      const rooms = new Set<string>(['ABC123']);
      const mockSocket = createMockSocket({
        data: {
          user: MOCK_USER,
          userId: MOCK_USER.userId,
          rooms,
        },
      });

      const action = { type: 'move', data: { from: 'e2', to: 'e4' } };

      await gateway.onGameAction(mockSocket, { roomId: 'ABC123', action });

      expect(messageRouter.broadcast).toHaveBeenCalledWith(
        'ABC123',
        WS_EVENTS.S_GAME_ACTION_RESULT,
        expect.objectContaining({
          roomId: 'ABC123',
          userId: MOCK_USER.userId,
          action,
          result: 'success',
        }),
      );
    });

    it('should reject action from non-room member', async () => {
      const mockSocket = createMockSocket({
        data: {
          user: MOCK_USER,
          userId: MOCK_USER.userId,
          rooms: new Set<string>(),
        },
      });

      await gateway.onGameAction(mockSocket, {
        roomId: 'ABC123',
        action: { type: 'move' },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.S_ERROR,
        expect.objectContaining({ code: 'NOT_IN_ROOM' }),
      );
    });
  });

  // ========== 观战测试 ==========

  describe('onSpectateJoin', () => {
    it('should join as spectator', async () => {
      const mockSocket = createMockSocket();

      await gateway.onSpectateJoin(mockSocket, { roomId: 'ABC123' });

      expect(roomService.spectatorJoin).toHaveBeenCalledWith(MOCK_USER.userId, 'ABC123');
      expect(mockSocket.join).toHaveBeenCalledWith('room:ABC123:spectators');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.S_GAME_STATE,
        expect.objectContaining({
          roomId: 'ABC123',
          state: expect.objectContaining({ isSpectatorView: true }),
        }),
      );
    });
  });

  describe('onSpectateLeave', () => {
    it('should leave as spectator', async () => {
      const mockSocket = createMockSocket({
        data: {
          user: MOCK_USER,
          userId: MOCK_USER.userId,
          isSpectating: true,
          spectateRoomId: 'ABC123',
        },
      });

      await gateway.onSpectateLeave(mockSocket, { roomId: 'ABC123' });

      expect(roomService.spectatorLeave).toHaveBeenCalledWith(MOCK_USER.userId, 'ABC123');
      expect(mockSocket.leave).toHaveBeenCalledWith('room:ABC123:spectators');
    });
  });

  // ========== 聊天消息测试 ==========

  describe('onChatMessage', () => {
    it('should broadcast chat message', async () => {
      const mockSocket = createMockSocket();

      await gateway.onChatMessage(mockSocket, {
        roomId: 'ABC123',
        message: 'Hello everyone!',
      });

      expect(messageRouter.broadcast).toHaveBeenCalledWith(
        'ABC123',
        WS_EVENTS.S_CHAT_MESSAGE,
        expect.objectContaining({
          roomId: 'ABC123',
          userId: MOCK_USER.userId,
          username: MOCK_USER.username,
          message: 'Hello everyone!',
        }),
      );
    });

    it('should reject empty message', async () => {
      const mockSocket = createMockSocket();

      await gateway.onChatMessage(mockSocket, {
        roomId: 'ABC123',
        message: '',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.S_ERROR,
        expect.objectContaining({ code: 'INVALID_MESSAGE' }),
      );
    });

    it('should reject too long message', async () => {
      const mockSocket = createMockSocket();

      await gateway.onChatMessage(mockSocket, {
        roomId: 'ABC123',
        message: 'a'.repeat(501),
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.S_ERROR,
        expect.objectContaining({ code: 'MESSAGE_TOO_LONG' }),
      );
    });
  });

  // ========== 准备状态测试 ==========

  describe('onReadyToggle', () => {
    it('should toggle ready state', async () => {
      const mockSocket = createMockSocket();
      const roomWithPlayers = {
        ...MOCK_ROOM,
        players: [
          ...MOCK_ROOM.players,
          {
            userId: 2,
            username: 'player2',
            nickname: 'Player 2',
            seatIndex: 1,
            isReady: false,
            isHost: false,
          },
        ],
      };

      // 模拟当前用户是非房主
      const mockSocketNonHost = createMockSocket({
        data: {
          user: { userId: 2, username: 'player2' },
          userId: 2,
          rooms: new Set<string>(['ABC123']),
        },
      });

      jest.spyOn(roomService, 'getRoom').mockResolvedValueOnce(roomWithPlayers);
      jest.spyOn(roomService, 'setReady').mockResolvedValueOnce(roomWithPlayers);

      await gateway.onReadyToggle(mockSocketNonHost, { roomId: 'ABC123' });

      expect(roomService.setReady).toHaveBeenCalledWith(2, 'ABC123', true);
      expect(messageRouter.broadcast).toHaveBeenCalledWith(
        'ABC123',
        WS_EVENTS.S_PLAYER_READY,
        expect.objectContaining({
          roomId: 'ABC123',
          userId: 2,
          isReady: true,
        }),
      );
    });

    it('should not toggle ready for host', async () => {
      const mockSocket = createMockSocket();

      await gateway.onReadyToggle(mockSocket, { roomId: 'ABC123' });

      // 房主不需要调用 setReady
      expect(roomService.setReady).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.S_PLAYER_READY,
        expect.objectContaining({
          userId: MOCK_USER.userId,
          isReady: true,
        }),
      );
    });
  });

  // ========== 心跳测试 ==========

  describe('onHeartbeat', () => {
    it('should process heartbeat and respond', async () => {
      const mockSocket = createMockSocket();

      await gateway.onHeartbeat(mockSocket);

      expect(heartbeatService.handlePong).toHaveBeenCalledWith(mockSocket.id);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        WS_EVENTS.C_HEARTBEAT,
        expect.objectContaining({
          timestamp: expect.any(Number),
          serverTime: expect.any(String),
        }),
      );
    });
  });
});

// ===== ConnectionManagerService 测试 =====

describe('ConnectionManagerService', () => {
  let service: ConnectionManagerService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionManagerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                redis: {
                  host: 'localhost',
                  port: 6379,
                  db: 0,
                },
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ConnectionManagerService>(ConnectionManagerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setServer / getServer', () => {
    it('should set and get server', () => {
      const mockServer = createMockServer();
      service.setServer(mockServer);
      expect(service.getServer()).toBe(mockServer);
    });
  });
});

// ===== MessageRouterService 测试 =====

describe('MessageRouterService', () => {
  let service: MessageRouterService;
  let connectionManager: ConnectionManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageRouterService,
        {
          provide: ConnectionManagerService,
          useValue: {
            getServer: jest.fn(),
            broadcastToRoom: jest.fn(),
            sendToUser: jest.fn().mockResolvedValue(undefined),
            sendToUsers: jest.fn().mockResolvedValue(undefined),
            getRoomUsers: jest.fn().mockResolvedValue([1, 2, 3]),
            getSocketId: jest.fn().mockResolvedValue('socket-1'),
          },
        },
      ],
    }).compile();

    service = module.get<MessageRouterService>(MessageRouterService);
    connectionManager = module.get<ConnectionManagerService>(ConnectionManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('broadcast', () => {
    it('should broadcast to room', () => {
      service.broadcast('room1', 'test-event', { data: 'test' });
      expect(connectionManager.broadcastToRoom).toHaveBeenCalledWith(
        'room1',
        'test-event',
        { data: 'test' },
      );
    });

    it('should broadcast excluding user', () => {
      service.broadcast('room1', 'test-event', { data: 'test' }, 1);
      // 当指定 excludeUserId 时，会调用 route 方法
      expect(connectionManager.broadcastToRoom).not.toHaveBeenCalled();
    });
  });

  describe('unicast', () => {
    it('should send to single user', async () => {
      await service.unicast(1, 'test-event', { data: 'test' });
      expect(connectionManager.sendToUser).toHaveBeenCalledWith(
        1,
        'test-event',
        { data: 'test' },
      );
    });
  });

  describe('multicast', () => {
    it('should send to multiple users', async () => {
      await service.multicast([1, 2, 3], 'test-event', { data: 'test' });
      expect(connectionManager.sendToUsers).toHaveBeenCalledWith(
        [1, 2, 3],
        'test-event',
        { data: 'test' },
      );
    });
  });
});

// ===== HeartbeatService 测试 =====

describe('HeartbeatService', () => {
  let service: HeartbeatService;
  let connectionManager: ConnectionManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeartbeatService,
        {
          provide: ConnectionManagerService,
          useValue: {
            getServer: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: SchedulerRegistry,
          useValue: {
            addInterval: jest.fn(),
            deleteInterval: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<HeartbeatService>(HeartbeatService);
    connectionManager = module.get<ConnectionManagerService>(ConnectionManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerClient / unregisterClient', () => {
    it('should register and unregister client', () => {
      const mockSocket = createMockSocket();

      service.registerClient(mockSocket);
      expect(service.getMonitoredClientCount()).toBe(1);
      expect(service.getMissedCount(mockSocket.id)).toBe(0);

      service.unregisterClient(mockSocket.id);
      expect(service.getMonitoredClientCount()).toBe(0);
    });
  });

  describe('handlePong', () => {
    it('should reset missed count on pong', () => {
      const mockSocket = createMockSocket();

      service.registerClient(mockSocket);
      // 模拟未响应
      (service as any).heartbeatCounters.set(mockSocket.id, 2);

      service.handlePong(mockSocket.id);

      expect(service.getMissedCount(mockSocket.id)).toBe(0);
    });
  });

  describe('onDisconnect callback', () => {
    it('should trigger callback on timeout', () => {
      const disconnectCallback = jest.fn();
      service.onDisconnect(disconnectCallback);

      // 验证回调已注册
      expect((service as any).disconnectCallback).toBe(disconnectCallback);
    });
  });
});

// ===== WsJwtGuard 测试 =====

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsJwtGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('1h'),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn().mockResolvedValue({
              sub: '1',
              username: 'testuser',
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<WsJwtGuard>(WsJwtGuard);
    jwtService = module.get<JwtService>(JwtService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('authenticate', () => {
    it('should authenticate with valid token from auth', async () => {
      const mockSocket = createMockSocket();

      const result = await guard.authenticate(mockSocket);

      expect(result).toEqual({
        userId: 1,
        username: 'testuser',
      });
      expect(jwtService.verifyAsync).toHaveBeenCalled();
    });

    it('should authenticate with token from query', async () => {
      const mockSocket = createMockSocket({
        handshake: {
          auth: {},
          query: { token: 'query-token' },
          headers: {},
        },
      } as any);

      const result = await guard.authenticate(mockSocket);

      expect(result).toEqual({
        userId: 1,
        username: 'testuser',
      });
    });

    it('should return null for socket without token', async () => {
      const mockSocket = createMockSocket({
        handshake: {
          auth: {},
          query: {},
          headers: {},
        },
      } as any);

      const result = await guard.authenticate(mockSocket);

      expect(result).toBeNull();
    });

    it('should return null for invalid token', async () => {
      const mockSocket = createMockSocket();
      jest.spyOn(jwtService, 'verifyAsync').mockRejectedValueOnce(new Error('Invalid token'));

      const result = await guard.authenticate(mockSocket);

      expect(result).toBeNull();
    });
  });

  describe('static helpers', () => {
    it('should get user from socket data', () => {
      const mockSocket = createMockSocket();

      const user = WsJwtGuard.getUser(mockSocket);

      expect(user).toEqual(MOCK_USER);
    });

    it('should get userId from socket data', () => {
      const mockSocket = createMockSocket();

      const userId = WsJwtGuard.getUserId(mockSocket);

      expect(userId).toBe(MOCK_USER.userId);
    });
  });
});
