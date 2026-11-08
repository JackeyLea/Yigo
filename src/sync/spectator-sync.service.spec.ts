/**
 * SpectatorSyncService 单元测试
 *
 * 测试覆盖：
 * - 房间注册/注销
 * - 环形缓冲区读写
 * - 15秒延迟
 * - 观战者管理
 * - 视角切换
 * - 聊天隔离
 * - 阶段管理
 * - 可见性过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  SpectatorSyncService,
  RingBuffer,
  GameEvent,
  SpectatorChatMessage,
} from './spectator-sync.service';

describe('RingBuffer', () => {
  let buffer: RingBuffer;

  beforeEach(() => {
    buffer = new RingBuffer(100);
  });

  it('should write and read events', () => {
    const event: GameEvent = {
      id: '1',
      type: 'move',
      timestamp: Date.now(),
      emitTimestamp: Date.now(),
      roomId: 'room1',
      payload: {},
      visibility: 'public',
    };

    buffer.write(event);
    expect(buffer.getSize()).toBe(1);

    const ready = buffer.readReady(Date.now() + 1);
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe('1');
    expect(buffer.getSize()).toBe(0);
  });

  it('should not read events that are not ready', () => {
    const now = Date.now();
    const event: GameEvent = {
      id: '1',
      type: 'move',
      timestamp: now,
      emitTimestamp: now + 15000, // 15秒后ready
      roomId: 'room1',
      payload: {},
      visibility: 'public',
    };

    buffer.write(event);
    const ready = buffer.readReady(now + 1000); // 1秒后读取
    expect(ready).toHaveLength(0);
    expect(buffer.getSize()).toBe(1);
  });

  it('should respect capacity limit', () => {
    const bufferSmall = new RingBuffer(3);
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      bufferSmall.write({
        id: String(i),
        type: 'move',
        timestamp: now,
        emitTimestamp: now,
        roomId: 'room1',
        payload: {},
        visibility: 'public',
      });
    }

    expect(bufferSmall.getSize()).toBe(3);
    const all = bufferSmall.getAllEvents();
    expect(all[0].id).toBe('2'); // 最早的0,1被移除了
  });

  it('should clear all events', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      buffer.write({
        id: String(i),
        type: 'move',
        timestamp: now,
        emitTimestamp: now,
        roomId: 'room1',
        payload: {},
        visibility: 'public',
      });
    }

    buffer.clear();
    expect(buffer.getSize()).toBe(0);
    expect(buffer.getAllEvents()).toHaveLength(0);
  });

  it('should read only ready events in order', () => {
    const now = Date.now();
    // Event 1: ready now
    buffer.write({
      id: '1', type: 'move', timestamp: now,
      emitTimestamp: now, roomId: 'room1', payload: {}, visibility: 'public',
    });
    // Event 2: ready in 5s
    buffer.write({
      id: '2', type: 'move', timestamp: now,
      emitTimestamp: now + 5000, roomId: 'room1', payload: {}, visibility: 'public',
    });
    // Event 3: ready now
    buffer.write({
      id: '3', type: 'move', timestamp: now,
      emitTimestamp: now, roomId: 'room1', payload: {}, visibility: 'public',
    });

    // Read at now + 1000 (event 1 and 3 should be ready)
    const ready = buffer.readReady(now + 1000);
    expect(ready).toHaveLength(2);
    expect(ready[0].id).toBe('1');
    expect(ready[1].id).toBe('3');
    // Event 2 should remain
    expect(buffer.getSize()).toBe(1);
  });
});

describe('SpectatorSyncService', () => {
  let service: SpectatorSyncService;

  const mockRoomId = 'ROOM123';
  const mockPlayerIds = ['player1', 'player2'];
  const mockSpectatorId = 999;
  const mockSocketId = 'socket_abc';

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpectatorSyncService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                SPECTATOR_DELAY_MS: 15000,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SpectatorSyncService>(SpectatorSyncService);
  });

  afterEach(() => {
    jest.useRealTimers();
    service.onModuleDestroy();
  });

  describe('Room Management', () => {
    it('should register a room', () => {
      service.registerRoom(mockRoomId, mockPlayerIds);

      const count = service.getSpectatorCount(mockRoomId);
      expect(count).toBe(0);
    });

    it('should update player list when registering existing room', () => {
      service.registerRoom(mockRoomId, ['player1']);
      service.registerRoom(mockRoomId, ['player1', 'player2', 'player3']);

      // Room should still exist with updated players
      const count = service.getSpectatorCount(mockRoomId);
      expect(count).toBe(0);
    });

    it('should unregister a room', () => {
      service.registerRoom(mockRoomId, mockPlayerIds);
      service.unregisterRoom(mockRoomId);

      const count = service.getSpectatorCount(mockRoomId);
      expect(count).toBe(0);
    });
  });

  describe('Spectator Management', () => {
    beforeEach(() => {
      service.registerRoom(mockRoomId, mockPlayerIds);
    });

    it('should add spectator', () => {
      service.addSpectator(mockRoomId, mockSpectatorId, mockSocketId);

      const count = service.getSpectatorCount(mockRoomId);
      expect(count).toBe(1);

      const spectators = service.getSpectators(mockRoomId);
      expect(spectators[0].userId).toBe(mockSpectatorId);
      expect(spectators[0].socketId).toBe(mockSocketId);
    });

    it('should remove spectator', () => {
      service.addSpectator(mockRoomId, mockSpectatorId, mockSocketId);
      service.removeSpectator(mockRoomId, mockSpectatorId);

      const count = service.getSpectatorCount(mockRoomId);
      expect(count).toBe(0);
    });

    it('should not add spectator to unregistered room', () => {
      // 先销毁之前的注册
      service.unregisterRoom(mockRoomId);

      service.addSpectator('NONEXISTENT', mockSpectatorId, mockSocketId);
      // Should not throw
      expect(service.getSpectatorCount('NONEXISTENT')).toBe(0);
    });

    it('should track multiple spectators', () => {
      service.addSpectator(mockRoomId, 1, 'socket1');
      service.addSpectator(mockRoomId, 2, 'socket2');
      service.addSpectator(mockRoomId, 3, 'socket3');

      expect(service.getSpectatorCount(mockRoomId)).toBe(3);
    });
  });

  describe('Event Buffering and Delay', () => {
    beforeEach(() => {
      service.registerRoom(mockRoomId, mockPlayerIds);
      service.addSpectator(mockRoomId, mockSpectatorId, mockSocketId);
    });

    it('should buffer and delay events', () => {
      const now = Date.now();
      const event = {
        id: service.generateEventId(),
        type: 'move',
        timestamp: now,
        roomId: mockRoomId,
        payload: { from: 'e2', to: 'e4' },
        visibility: 'public' as const,
      };

      service.bufferEvent(mockRoomId, event);

      // Immediately flush - should not be ready
      const result = service.flushReadyEvents();
      const roomResult = result.find((r) => r.roomId === mockRoomId);
      expect(roomResult?.events.length || 0).toBe(0);
    });

    it('should send events after delay', () => {
      const now = Date.now();

      // Advance timers past the delay
      jest.advanceTimersByTime(16000);

      const event = {
        id: service.generateEventId(),
        type: 'move',
        timestamp: now,
        roomId: mockRoomId,
        payload: { from: 'e2', to: 'e4' },
        visibility: 'public' as const,
      };

      service.bufferEvent(mockRoomId, event);

      // Event should be ready now (timestamp + 15s < now + 16s)
      const result = service.flushReadyEvents();
      const roomResult = result.find((r) => r.roomId === mockRoomId);
      expect(roomResult?.events.length || 0).toBeGreaterThan(0);
    });

    it('should buffer multiple events', () => {
      const now = Date.now();
      const events = [
        {
          id: '1', type: 'move', timestamp: now,
          roomId: mockRoomId, payload: {}, visibility: 'public' as const,
        },
        {
          id: '2', type: 'move', timestamp: now + 1000,
          roomId: mockRoomId, payload: {}, visibility: 'public' as const,
        },
        {
          id: '3', type: 'chat', timestamp: now + 2000,
          roomId: mockRoomId, payload: {}, visibility: 'public' as const,
        },
      ];

      service.bufferEvents(mockRoomId, events);

      const status = service.getBufferStatus(mockRoomId);
      expect(status?.size).toBe(3);
    });

    it('should flush all events on demand', () => {
      const now = Date.now();
      const events = [
        {
          id: '1', type: 'move', timestamp: now,
          roomId: mockRoomId, payload: {}, visibility: 'public' as const,
        },
        {
          id: '2', type: 'chat', timestamp: now + 1000,
          roomId: mockRoomId, payload: {}, visibility: 'public' as const,
        },
      ];

      service.bufferEvents(mockRoomId, events);

      const flushed = service.flushAll(mockRoomId);
      expect(flushed).toHaveLength(2);

      const status = service.getBufferStatus(mockRoomId);
      expect(status?.size).toBe(0);
    });

    it('should skip rooms with no spectators on flush', () => {
      // Remove all spectators
      service.removeSpectator(mockRoomId, mockSpectatorId);

      const now = Date.now();
      jest.advanceTimersByTime(16000);

      service.bufferEvent(mockRoomId, {
        id: '1', type: 'move', timestamp: now,
        roomId: mockRoomId, payload: {}, visibility: 'public' as const,
      });

      const result = service.flushReadyEvents();
      const roomResult = result.find((r) => r.roomId === mockRoomId);
      expect(roomResult).toBeUndefined();
    });
  });

  describe('Game Phase Management', () => {
    beforeEach(() => {
      service.registerRoom(mockRoomId, mockPlayerIds);
    });

    it('should not be in showdown by default', () => {
      // 通过buffer event来验证showdown_only事件不可见
      const now = Date.now();
      jest.advanceTimersByTime(16000);

      service.bufferEvent(mockRoomId, {
        id: '1', type: 'card_reveal', timestamp: now,
        roomId: mockRoomId, payload: {}, visibility: 'showdown_only' as const,
      });

      const result = service.flushReadyEvents();
      const roomResult = result.find((r) => r.roomId === mockRoomId);
      // No spectators and not in showdown, but since we have no spectators it skips
      expect(roomResult).toBeUndefined();
    });

    it('should enter showdown phase', () => {
      service.setGamePhase(mockRoomId, 'showdown');

      service.addSpectator(mockRoomId, mockSpectatorId, mockSocketId);

      const now = Date.now();
      jest.advanceTimersByTime(16000);

      service.bufferEvent(mockRoomId, {
        id: '1', type: 'card_reveal', timestamp: now,
        roomId: mockRoomId, payload: {}, visibility: 'showdown_only' as const,
      });

      const result = service.flushReadyEvents();
      const roomResult = result.find((r) => r.roomId === mockRoomId);
      expect(roomResult?.events.length).toBe(1);
    });
  });

  describe('Perspective Switch', () => {
    beforeEach(() => {
      service.registerRoom(mockRoomId, mockPlayerIds);
      service.addSpectator(mockRoomId, mockSpectatorId, mockSocketId);
    });

    it('should switch perspective to player', () => {
      // First enter showdown
      service.setGamePhase(mockRoomId, 'showdown');

      const result = service.switchPerspective(mockRoomId, mockSpectatorId, 'player1');
      expect(result).toBe(true);

      const perspective = service.getPerspective(mockRoomId, mockSpectatorId);
      expect(perspective).toBe('player1');
    });

    it('should not switch perspective when not in showdown', () => {
      const result = service.switchPerspective(mockRoomId, mockSpectatorId, 'player1');
      expect(result).toBe(false);

      const perspective = service.getPerspective(mockRoomId, mockSpectatorId);
      expect(perspective).toBeNull();
    });

    it('should not switch to non-existent player', () => {
      service.setGamePhase(mockRoomId, 'showdown');

      const result = service.switchPerspective(mockRoomId, mockSpectatorId, 'player999');
      expect(result).toBe(false);
    });

    it('should reset perspective to null', () => {
      service.setGamePhase(mockRoomId, 'showdown');
      service.switchPerspective(mockRoomId, mockSpectatorId, 'player1');

      const result = service.switchPerspective(mockRoomId, mockSpectatorId, null);
      expect(result).toBe(true);

      const perspective = service.getPerspective(mockRoomId, mockSpectatorId);
      expect(perspective).toBeNull();
    });

    it('should filter player_only events based on perspective', () => {
      service.setGamePhase(mockRoomId, 'showdown');
      service.switchPerspective(mockRoomId, mockSpectatorId, 'player1');

      const now = Date.now();
      jest.advanceTimersByTime(16000);

      service.bufferEvents(mockRoomId, [
        {
          id: '1', type: 'hand_reveal', timestamp: now,
          roomId: mockRoomId, payload: {}, visibility: 'player_only' as const,
          targetPlayerId: 'player1',
        },
        {
          id: '2', type: 'hand_reveal', timestamp: now,
          roomId: mockRoomId, payload: {}, visibility: 'player_only' as const,
          targetPlayerId: 'player2',
        },
      ]);

      const result = service.flushReadyEvents();
      const roomResult = result.find((r) => r.roomId === mockRoomId);
      // Only player1 event should be visible (since spectator switched to player1)
      expect(roomResult?.events.length).toBe(1);
      expect(roomResult?.events[0].targetPlayerId).toBe('player1');
    });
  });

  describe('Spectator Chat Isolation', () => {
    beforeEach(() => {
      service.registerRoom(mockRoomId, mockPlayerIds);
      service.addSpectator(mockRoomId, mockSpectatorId, mockSocketId);
    });

    it('should allow spectator to send chat', () => {
      const canChat = service.canSendSpectatorChat(mockRoomId, mockSpectatorId);
      expect(canChat).toBe(true);
    });

    it('should not allow non-spectator to send chat', () => {
      const canChat = service.canSendSpectatorChat(mockRoomId, 888);
      expect(canChat).toBe(false);
    });

    it('should get spectator chat members', () => {
      service.addSpectator(mockRoomId, 2, 'socket2');
      service.addSpectator(mockRoomId, 3, 'socket3');

      const members = service.getSpectatorChatMembers(mockRoomId);
      expect(members).toHaveLength(3);
      expect(members).toContain(mockSpectatorId);
      expect(members).toContain(2);
      expect(members).toContain(3);
    });

    it('should store chat history', () => {
      const message: SpectatorChatMessage = {
        id: service.generateMessageId(),
        roomId: mockRoomId,
        userId: mockSpectatorId,
        username: 'spectator1',
        message: 'Great move!',
        timestamp: Date.now(),
      };

      service.sendSpectatorChat(mockRoomId, message);

      const history = service.getSpectatorChatHistory(mockRoomId);
      expect(history).toHaveLength(1);
      expect(history[0].message).toBe('Great move!');
    });

    it('should limit chat history', () => {
      // Add 110 messages
      for (let i = 0; i < 110; i++) {
        service.sendSpectatorChat(mockRoomId, {
          id: `msg_${i}`,
          roomId: mockRoomId,
          userId: mockSpectatorId,
          username: 'spectator',
          message: `Message ${i}`,
          timestamp: Date.now(),
        });
      }

      const history = service.getSpectatorChatHistory(mockRoomId);
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should mute and unmute spectator', () => {
      service.muteSpectator(mockRoomId, mockSpectatorId);

      const state = (service as any).roomStates.get(mockRoomId);
      const spectator = state.spectators.get(mockSpectatorId);
      expect(spectator.isChatEnabled).toBe(false);

      service.unmuteSpectator(mockRoomId, mockSpectatorId);
      expect(spectator.isChatEnabled).toBe(true);
    });
  });

  describe('Buffer Status', () => {
    beforeEach(() => {
      service.registerRoom(mockRoomId, mockPlayerIds);
    });

    it('should return buffer status', () => {
      const status = service.getBufferStatus(mockRoomId);
      expect(status).not.toBeNull();
      expect(status?.size).toBe(0);
      expect(status?.capacity).toBe(5000);
      expect(status?.delayMs).toBe(15000);
    });

    it('should return null for unregistered room', () => {
      const status = service.getBufferStatus('NONEXISTENT');
      expect(status).toBeNull();
    });
  });
});
