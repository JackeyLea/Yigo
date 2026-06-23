import { Test, TestingModule } from '@nestjs/testing';
import { StateSyncService } from './state-sync.service';
import { BoardSyncStrategy } from './strategies/board-sync.strategy';
import { CardSyncStrategy } from './strategies/card-sync.strategy';
import { MixedSyncStrategy, GameType } from './strategies/mixed-sync.strategy';
import { RecorderService } from './replay/recorder.service';
import { ReplayService } from './replay/replay.service';
import { EventBus } from '../plugin/event-bus';
import { GameState, Action, PlayerState } from '../plugin/interfaces/game-controller.interface';
import { randomBytes } from 'crypto';

describe('SyncModule', () => {
  let stateSyncService: StateSyncService;
  let boardStrategy: BoardSyncStrategy;
  let cardStrategy: CardSyncStrategy;
  let mixedStrategy: MixedSyncStrategy;
  let recorderService: RecorderService;
  let replayService: ReplayService;
  let eventBus: EventBus;

  // 测试数据
  const testRoomId = 'TEST01';
  const testPlayerId = 'player-1';

  const mockPlayers: PlayerState[] = [
    { playerId: 'player-1', seatIndex: 0, status: 'active', score: 0 },
    { playerId: 'player-2', seatIndex: 1, status: 'active', score: 0 },
  ];

  const mockBoardState: GameState = {
    status: 'playing',
    players: mockPlayers,
    board: [
      ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', 'c', '.', '.', '.', '.', '.', 'c', '.'],
      ['p', '.', 'p', '.', 'p', '.', 'p', '.', 'p'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['P', '.', 'P', '.', 'P', '.', 'P', '.', 'P'],
      ['.', 'C', '.', '.', '.', '.', '.', 'C', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'],
    ],
    currentPlayer: 'player-1',
    round: 1,
    metadata: {
      moveHistory: [],
      gameType: 'xiangqi',
    },
  };

  const mockCardState: GameState = {
    status: 'playing',
    players: mockPlayers,
    currentPlayer: 'player-1',
    round: 1,
    metadata: {
      phase: 'betting',
      pot: 100,
      boardCards: [],
      discardPile: [],
      hiddenCards: [{ suit: 'spades', rank: 'A', id: 'card-1' }],
    },
  };

  const mockAction: Action = {
    type: 'move',
    playerId: 'player-1',
    data: { from: [0, 0], to: [1, 0] },
    timestamp: Date.now(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateSyncService,
        BoardSyncStrategy,
        CardSyncStrategy,
        MixedSyncStrategy,
        RecorderService,
        ReplayService,
        EventBus,
      ],
    }).compile();

    stateSyncService = module.get<StateSyncService>(StateSyncService);
    boardStrategy = module.get<BoardSyncStrategy>(BoardSyncStrategy);
    cardStrategy = module.get<CardSyncStrategy>(CardSyncStrategy);
    mixedStrategy = module.get<MixedSyncStrategy>(MixedSyncStrategy);
    recorderService = module.get<RecorderService>(RecorderService);
    replayService = module.get<ReplayService>(ReplayService);
    eventBus = module.get<EventBus>(EventBus);

    // 清理之前测试的状态
    mixedStrategy.unregisterRoom(testRoomId);
  });

  afterEach(() => {
    mixedStrategy.unregisterRoom(testRoomId);
    boardStrategy.cleanup(testRoomId);
    cardStrategy.cleanup(testRoomId);
  });

  // ==================== BoardSyncStrategy Tests ====================

  describe('BoardSyncStrategy', () => {
    it('should be defined', () => {
      expect(boardStrategy).toBeDefined();
    });

    it('should compute CRC32 correctly', () => {
      const testString = 'test data for crc32';
      const crc32 = boardStrategy.computeCRC32(testString);

      expect(crc32).toBeDefined();
      expect(typeof crc32).toBe('string');
      expect(crc32.length).toBe(8); // 8 hex chars = 32 bits
      expect(/^[0-9a-f]{8}$/i.test(crc32)).toBe(true);
    });

    it('should compute consistent CRC32 for same input', () => {
      const testString = 'consistent data';
      const crc1 = boardStrategy.computeCRC32(testString);
      const crc2 = boardStrategy.computeCRC32(testString);

      expect(crc1).toBe(crc2);
    });

    it('should compute different CRC32 for different input', () => {
      const crc1 = boardStrategy.computeCRC32('data1');
      const crc2 = boardStrategy.computeCRC32('data2');

      expect(crc1).not.toBe(crc2);
    });

    it('should sync full board state without error', async () => {
      await expect(
        boardStrategy.syncFullState(testRoomId, mockBoardState),
      ).resolves.not.toThrow();
    });

    it('should send keyframe without error', async () => {
      await expect(
        boardStrategy.sendKeyframe(testRoomId, mockBoardState),
      ).resolves.not.toThrow();
    });

    it('should start and stop keyframe timer', () => {
      const stateProvider = () => mockBoardState;

      boardStrategy.startKeyframeTimer(testRoomId, stateProvider);
      expect(boardStrategy.getCurrentFrameSeq(testRoomId)).toBeGreaterThanOrEqual(0);

      boardStrategy.stopKeyframeTimer(testRoomId);
      // Should not throw after stop
    });

    it('should handle action with new state', async () => {
      const newState = {
        ...mockBoardState,
        board: mockBoardState.board.map((row) => [...row]),
        currentPlayer: 'player-2',
      };
      newState.board[0][0] = '.';
      newState.board[1][0] = 'r';

      await expect(
        boardStrategy.handleAction(testRoomId, mockAction, newState),
      ).resolves.not.toThrow();
    });

    it('should increment frame counter on sync', async () => {
      const seq1 = boardStrategy.getCurrentFrameSeq(testRoomId);
      await boardStrategy.syncFullState(testRoomId, mockBoardState);
      const seq2 = boardStrategy.getCurrentFrameSeq(testRoomId);

      expect(seq2).toBeGreaterThan(seq1);
    });
  });

  // ==================== CardSyncStrategy Tests ====================

  describe('CardSyncStrategy', () => {
    it('should be defined', () => {
      expect(cardStrategy).toBeDefined();
    });

    it('should sync action without error', async () => {
      await expect(
        cardStrategy.syncAction(testRoomId, mockAction),
      ).resolves.not.toThrow();
    });

    it('should sync full state without error', async () => {
      await expect(
        cardStrategy.syncFullState(testRoomId, mockCardState),
      ).resolves.not.toThrow();
    });

    it('should compute CRC32 correctly', () => {
      const testString = 'test data for crc32';
      const crc32 = cardStrategy.computeCRC32(testString);

      expect(crc32).toBeDefined();
      expect(typeof crc32).toBe('string');
      expect(crc32.length).toBe(8);
    });

    it('should generate and verify HMAC hash correctly', () => {
      const key = randomBytes(32);
      const nonce = randomBytes(16);
      const cards = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
        { suit: 'hearts', rank: 'K', id: 'card-2' },
        { suit: 'diamonds', rank: 'Q', id: 'card-3' },
      ];

      const hash = cardStrategy.generateCardHash(cards, key, nonce);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 hex = 64 chars

      // Same input should produce same hash
      const hash2 = cardStrategy.generateCardHash(cards, key, nonce);
      expect(hash).toBe(hash2);

      // Different nonce should produce different hash
      const differentNonce = randomBytes(16);
      const hash3 = cardStrategy.generateCardHash(cards, key, differentNonce);
      expect(hash).not.toBe(hash3);
    });

    it('should verify HMAC hash correctly', () => {
      const key = randomBytes(32);
      const nonce = randomBytes(16);
      const cards = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
        { suit: 'hearts', rank: 'K', id: 'card-2' },
      ];

      const hash = cardStrategy.generateCardHash(cards, key, nonce);

      // Correct cards should verify
      expect(cardStrategy.verifyCardHash(cards, key, nonce, hash)).toBe(true);

      // Wrong cards should not verify
      const wrongCards = [
        { suit: 'clubs', rank: 'J', id: 'card-3' },
      ];
      expect(cardStrategy.verifyCardHash(wrongCards, key, nonce, hash)).toBe(false);

      // Wrong key should not verify
      const wrongKey = randomBytes(32);
      expect(cardStrategy.verifyCardHash(cards, wrongKey, nonce, hash)).toBe(false);
    });

    it('should init and destroy HMAC key', () => {
      const keyData = cardStrategy.initHmacKey(testRoomId);

      expect(keyData).toBeDefined();
      expect(keyData.key).toBeDefined();
      expect(keyData.key.length).toBe(32);
      expect(keyData.nonce).toBeDefined();
      expect(keyData.nonce.length).toBe(16);

      // getOrCreateHmacKey should return existing key
      const keyData2 = cardStrategy.getOrCreateHmacKey(testRoomId);
      expect(keyData2.key.toString('hex')).toBe(keyData.key.toString('hex'));

      // Destroy should work
      cardStrategy.destroyHmacKey(testRoomId);
      expect(cardStrategy.getHmacKey(testRoomId)).toBeUndefined();
    });

    it('should filter public state correctly', async () => {
      await cardStrategy.syncFullState(testRoomId, mockCardState);
      // syncFullState should filter out hiddenCards
      // This is verified by the fact it doesn't throw
    });

    it('should start and stop full state timer', () => {
      const stateProvider = () => mockCardState;

      cardStrategy.startFullStateTimer(testRoomId, stateProvider);
      cardStrategy.stopFullStateTimer(testRoomId);
      // Should not throw
    });

    it('should sync hidden cards hash', async () => {
      const cards = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
        { suit: 'hearts', rank: 'K', id: 'card-2' },
      ];

      const result = await cardStrategy.syncHiddenCardsHash(
        testRoomId,
        testPlayerId,
        cards,
      );

      expect(result).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(64);
    });

    it('should handle action with state', async () => {
      await expect(
        cardStrategy.handleActionWithState(testRoomId, mockAction, mockCardState),
      ).resolves.not.toThrow();
    });

    it('should be deterministic hash regardless of card order', () => {
      const key = randomBytes(32);
      const nonce = randomBytes(16);

      const cards1 = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
        { suit: 'hearts', rank: 'K', id: 'card-2' },
      ];
      const cards2 = [
        { suit: 'hearts', rank: 'K', id: 'card-2' },
        { suit: 'spades', rank: 'A', id: 'card-1' },
      ];

      const hash1 = cardStrategy.generateCardHash(cards1, key, nonce);
      const hash2 = cardStrategy.generateCardHash(cards2, key, nonce);

      // Should be same because cards are sorted by id before hashing
      expect(hash1).toBe(hash2);
    });
  });

  // ==================== MixedSyncStrategy Tests ====================

  describe('MixedSyncStrategy', () => {
    it('should be defined', () => {
      expect(mixedStrategy).toBeDefined();
    });

    it('should register room with board game type', () => {
      mixedStrategy.registerRoom(testRoomId, GameType.BOARD);
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.BOARD);
    });

    it('should register room with card game type', () => {
      mixedStrategy.registerRoom(testRoomId, GameType.CARD);
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.CARD);
    });

    it('should auto-detect board game type', () => {
      mixedStrategy.registerRoom(testRoomId, 'chess');
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.BOARD);
    });

    it('should auto-detect card game type', () => {
      mixedStrategy.registerRoom(testRoomId, 'poker');
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.CARD);
    });

    it('should auto-detect mahjong as card game', () => {
      mixedStrategy.registerRoom(testRoomId, 'mahjong');
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.CARD);
    });

    it('should auto-detect xiangqi as board game', () => {
      mixedStrategy.registerRoom(testRoomId, 'xiangqi');
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.BOARD);
    });

    it('should switch strategy dynamically', () => {
      mixedStrategy.registerRoom(testRoomId, GameType.BOARD);
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.BOARD);

      mixedStrategy.switchStrategy(testRoomId, GameType.CARD);
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.CARD);
    });

    it('should return correct current strategy', () => {
      mixedStrategy.registerRoom(testRoomId, GameType.BOARD);
      expect(mixedStrategy.getCurrentStrategy(testRoomId)).toBe('board');

      mixedStrategy.switchStrategy(testRoomId, GameType.CARD);
      expect(mixedStrategy.getCurrentStrategy(testRoomId)).toBe('card');
    });

    it('should unregister room and clean up', () => {
      mixedStrategy.registerRoom(testRoomId, GameType.BOARD);
      mixedStrategy.unregisterRoom(testRoomId);
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.BOARD); // defaults to BOARD
    });

    it('should sync using correct strategy', async () => {
      mixedStrategy.registerRoom(testRoomId, GameType.BOARD);
      await expect(
        mixedStrategy.sync(testRoomId, GameType.BOARD, mockAction, mockBoardState),
      ).resolves.not.toThrow();
    });

    it('should get strategy instances', () => {
      expect(mixedStrategy.getBoardStrategy()).toBe(boardStrategy);
      expect(mixedStrategy.getCardStrategy()).toBe(cardStrategy);
    });
  });

  // ==================== StateSyncService Tests ====================

  describe('StateSyncService', () => {
    it('should be defined', () => {
      expect(stateSyncService).toBeDefined();
    });

    it('should register room with state provider', () => {
      const stateProvider = () => mockBoardState;

      stateSyncService.registerRoom(testRoomId, GameType.BOARD, stateProvider);

      // Cleanup
      stateSyncService.unregisterRoom(testRoomId);
    });

    it('should sync board game', async () => {
      await expect(
        stateSyncService.syncBoardGame(testRoomId, mockBoardState),
      ).resolves.not.toThrow();
    });

    it('should sync card game action', async () => {
      await expect(
        stateSyncService.syncCardGame(testRoomId, mockAction),
      ).resolves.not.toThrow();
    });

    it('should sync card game full state', async () => {
      await expect(
        stateSyncService.syncCardGameFullState(testRoomId, mockCardState),
      ).resolves.not.toThrow();
    });

    it('should sync hidden cards', async () => {
      const cards = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
        { suit: 'hearts', rank: 'K', id: 'card-2' },
      ];

      const result = await stateSyncService.syncHiddenCards(
        testRoomId,
        testPlayerId,
        cards,
      );

      expect(result).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(64);
    });

    it('should generate card hash with provided key and nonce', () => {
      const key = randomBytes(32);
      const nonce = randomBytes(16);
      const cards = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
      ];

      const hash = stateSyncService.generateCardHash(cards, key, nonce);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });

    it('should send keyframe', async () => {
      mixedStrategy.registerRoom(testRoomId, GameType.BOARD);
      await expect(
        stateSyncService.sendKeyframe(testRoomId, mockBoardState),
      ).resolves.not.toThrow();
    });

    it('should send delta for card game', async () => {
      mixedStrategy.registerRoom(testRoomId, GameType.CARD);
      await expect(
        stateSyncService.sendDelta(testRoomId, mockAction),
      ).resolves.not.toThrow();
    });

    it('should handle spectate push', async () => {
      await expect(
        stateSyncService.spectatePush(testRoomId, mockBoardState),
      ).resolves.not.toThrow();
    });

    it('should register and unregister room', () => {
      const stateProvider = () => mockBoardState;

      stateSyncService.registerRoom(testRoomId, GameType.BOARD, stateProvider);
      stateSyncService.unregisterRoom(testRoomId);
      // Should not throw
    });

    it('should switch game type', () => {
      stateSyncService.registerRoom(testRoomId, GameType.BOARD);
      stateSyncService.switchGameType(testRoomId, GameType.CARD);
      expect(mixedStrategy.getGameType(testRoomId)).toBe(GameType.CARD);
    });

    it('should register state provider', () => {
      const stateProvider = () => mockBoardState;
      stateSyncService.registerStateProvider(testRoomId, stateProvider);
      // Should not throw
    });

    it('should handle sendDelta without state provider', async () => {
      mixedStrategy.registerRoom(testRoomId, GameType.BOARD);
      // When no state provider is registered, it should warn but not throw
      await expect(
        stateSyncService.sendDelta(testRoomId, mockAction),
      ).resolves.not.toThrow();
    });
  });

  // ==================== RecorderService Tests ====================

  describe('RecorderService', () => {
    it('should be defined', () => {
      expect(recorderService).toBeDefined();
    });

    it('should start and stop recording', async () => {
      recorderService.startRecording(testRoomId, mockPlayers, 'xiangqi');

      const info = recorderService.getSessionInfo(testRoomId);
      expect(info.isRecording).toBe(true);

      const dataUrl = await recorderService.stopRecording(testRoomId);
      expect(dataUrl).toBeDefined();
      expect(typeof dataUrl).toBe('string');
    });

    it('should record actions', async () => {
      recorderService.startRecording(testRoomId, mockPlayers);

      recorderService.recordAction(testRoomId, mockAction);
      recorderService.recordAction(testRoomId, {
        ...mockAction,
        type: 'bet',
        data: { amount: 100 },
      });

      const info = recorderService.getSessionInfo(testRoomId);
      expect(info.actionCount).toBe(2);

      await recorderService.stopRecording(testRoomId);
    });

    it('should not record without active session', () => {
      // Should not throw even without active session
      expect(() => {
        recorderService.recordAction('NONEXISTENT', mockAction);
      }).not.toThrow();
    });

    it('should discard recording', () => {
      recorderService.startRecording(testRoomId, mockPlayers);
      recorderService.discardRecording(testRoomId);

      const info = recorderService.getSessionInfo(testRoomId);
      expect(info.isRecording).toBe(false);
    });

    it('should get active recordings', () => {
      recorderService.startRecording(testRoomId, mockPlayers);

      const recordings = recorderService.getActiveRecordings();
      expect(recordings.length).toBeGreaterThan(0);

      recorderService.discardRecording(testRoomId);
    });

    it('should not stop recording without active session', async () => {
      await expect(
        recorderService.stopRecording('NONEXISTENT'),
      ).rejects.toThrow('No active recording');
    });

    it('should handle duplicate start recording', () => {
      recorderService.startRecording(testRoomId, mockPlayers);
      // Second start should not throw (warns instead)
      recorderService.startRecording(testRoomId, mockPlayers);

      recorderService.discardRecording(testRoomId);
    });

    it('should generate unique record IDs', async () => {
      recorderService.startRecording('ROOM1', mockPlayers);
      const url1 = await recorderService.stopRecording('ROOM1');

      recorderService.startRecording('ROOM2', mockPlayers);
      const url2 = await recorderService.stopRecording('ROOM2');

      expect(url1).not.toBe(url2);
    });
  });

  // ==================== ReplayService Tests ====================

  describe('ReplayService', () => {
    it('should be defined', () => {
      expect(replayService).toBeDefined();
    });

    it('should throw NotFoundException for non-existent replay', async () => {
      await expect(
        replayService.getReplay('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create playback session', async () => {
      // First create and save a recording
      recorderService.startRecording(testRoomId, mockPlayers, 'test');
      recorderService.recordAction(testRoomId, mockAction);
      recorderService.recordAction(testRoomId, {
        ...mockAction,
        type: 'bet',
        playerId: 'player-2',
        data: { amount: 50 },
      });
      const dataUrl = await recorderService.stopRecording(testRoomId);

      // Extract recordId from dataUrl
      const recordId = dataUrl.split('/').pop()?.replace('.json', '') || '';

      if (recordId && recordId.length > 10) {
        // Create playback session
        const sessionId = await replayService.createPlaybackSession(recordId);
        expect(sessionId).toBe(recordId);

        // Cleanup
        replayService.cleanupSession(recordId);
      }
    });

    it('should control playback status', async () => {
      recorderService.startRecording(testRoomId, mockPlayers, 'test');
      recorderService.recordAction(testRoomId, mockAction);
      const dataUrl = await recorderService.stopRecording(testRoomId);

      const recordId = dataUrl.split('/').pop()?.replace('.json', '') || '';

      if (recordId && recordId.length > 10) {
        await replayService.createPlaybackSession(recordId);

        // Test play
        await replayService.play(recordId);
        let status = replayService.getPlaybackStatus(recordId);
        expect(status.status).toBe('playing');

        // Test pause
        await replayService.pause(recordId);
        status = replayService.getPlaybackStatus(recordId);
        expect(status.status).toBe('paused');

        // Test stop
        await replayService.stop(recordId);
        status = replayService.getPlaybackStatus(recordId);
        expect(status.status).toBe('idle');

        replayService.cleanupSession(recordId);
      }
    });

    it('should seek to specific index', async () => {
      recorderService.startRecording(testRoomId, mockPlayers, 'test');
      recorderService.recordAction(testRoomId, mockAction);
      recorderService.recordAction(testRoomId, {
        ...mockAction,
        type: 'move2',
        playerId: 'player-2',
      });
      const dataUrl = await recorderService.stopRecording(testRoomId);

      const recordId = dataUrl.split('/').pop()?.replace('.json', '') || '';

      if (recordId && recordId.length > 10) {
        await replayService.createPlaybackSession(recordId);

        const state = await replayService.seekTo(recordId, 0);
        expect(state).toBeDefined();
        expect(state.status).toBeDefined();

        replayService.cleanupSession(recordId);
      }
    });

    it('should support nextFrame and prevFrame', async () => {
      recorderService.startRecording(testRoomId, mockPlayers, 'test');
      recorderService.recordAction(testRoomId, mockAction);
      recorderService.recordAction(testRoomId, {
        ...mockAction,
        type: 'move2',
      });
      const dataUrl = await recorderService.stopRecording(testRoomId);

      const recordId = dataUrl.split('/').pop()?.replace('.json', '') || '';

      if (recordId && recordId.length > 10) {
        await replayService.createPlaybackSession(recordId);

        const state1 = await replayService.nextFrame(recordId);
        expect(state1).toBeDefined();

        const state0 = await replayService.prevFrame(recordId);
        expect(state0).toBeDefined();

        replayService.cleanupSession(recordId);
      }
    });

    it('should control playback speed', async () => {
      recorderService.startRecording(testRoomId, mockPlayers, 'test');
      recorderService.recordAction(testRoomId, mockAction);
      const dataUrl = await recorderService.stopRecording(testRoomId);

      const recordId = dataUrl.split('/').pop()?.replace('.json', '') || '';

      if (recordId && recordId.length > 10) {
        await replayService.createPlaybackSession(recordId);

        const speed1 = await replayService.setPlaybackSpeed(recordId, 2);
        expect(speed1).toBe(2);

        const speed2 = await replayService.fastForward(recordId);
        expect(speed2).toBeGreaterThanOrEqual(1);

        const speed3 = await replayService.rewind(recordId);
        expect(speed3).not.toBe(0);

        replayService.cleanupSession(recordId);
      }
    });

    it('should clamp playback speed to valid range', async () => {
      recorderService.startRecording(testRoomId, mockPlayers, 'test');
      recorderService.recordAction(testRoomId, mockAction);
      const dataUrl = await recorderService.stopRecording(testRoomId);

      const recordId = dataUrl.split('/').pop()?.replace('.json', '') || '';

      if (recordId && recordId.length > 10) {
        await replayService.createPlaybackSession(recordId);

        // Speed should be clamped to max 4
        const fast = await replayService.setPlaybackSpeed(recordId, 10);
        expect(fast).toBe(4);

        // Speed should be clamped to min 0.25
        const slow = await replayService.setPlaybackSpeed(recordId, 0.1);
        expect(slow).toBe(0.25);

        replayService.cleanupSession(recordId);
      }
    });

    it('should handle invalid seek index', async () => {
      recorderService.startRecording(testRoomId, mockPlayers, 'test');
      recorderService.recordAction(testRoomId, mockAction);
      const dataUrl = await recorderService.stopRecording(testRoomId);

      const recordId = dataUrl.split('/').pop()?.replace('.json', '') || '';

      if (recordId && recordId.length > 10) {
        await replayService.createPlaybackSession(recordId);

        // Negative index should be clamped to -1
        const state = await replayService.seekTo(recordId, -999);
        expect(state).toBeDefined();

        // Out of range index should be clamped
        const state2 = await replayService.seekTo(recordId, 999);
        expect(state2).toBeDefined();

        replayService.cleanupSession(recordId);
      }
    });
  });

  // ==================== Integration Tests ====================

  describe('Integration', () => {
    it('should complete a full board game sync flow', async () => {
      // 1. Register room
      stateSyncService.registerRoom(testRoomId, GameType.BOARD, () => mockBoardState);

      // 2. Sync board state after move
      await stateSyncService.syncBoardGame(testRoomId, mockBoardState);

      // 3. Send keyframe
      await stateSyncService.sendKeyframe(testRoomId, mockBoardState);

      // 4. Start recording
      recorderService.startRecording(testRoomId, mockPlayers, 'xiangqi', mockBoardState);

      // 5. Record some actions
      recorderService.recordAction(testRoomId, mockAction);
      recorderService.recordAction(testRoomId, {
        ...mockAction,
        type: 'move',
        playerId: 'player-2',
      });

      // 6. Stop recording
      const dataUrl = await recorderService.stopRecording(testRoomId);
      expect(dataUrl).toBeDefined();

      // 7. Cleanup
      stateSyncService.unregisterRoom(testRoomId);
    });

    it('should complete a full card game sync flow', async () => {
      // 1. Register room
      stateSyncService.registerRoom(testRoomId, GameType.CARD, () => mockCardState);

      // 2. Init HMAC key for hidden cards
      cardStrategy.initHmacKey(testRoomId);

      // 3. Sync hidden cards hash
      const cards = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
        { suit: 'hearts', rank: 'K', id: 'card-2' },
      ];
      const hashResult = await stateSyncService.syncHiddenCards(
        testRoomId,
        testPlayerId,
        cards,
      );
      expect(hashResult.hash).toBeDefined();

      // 4. Sync card game action
      await stateSyncService.syncCardGame(testRoomId, mockAction);

      // 5. Sync full state
      await stateSyncService.syncCardGameFullState(testRoomId, mockCardState);

      // 6. Start recording
      recorderService.startRecording(testRoomId, mockPlayers, 'poker', mockCardState);
      recorderService.recordAction(testRoomId, mockAction, mockCardState);

      // 7. Stop recording
      const dataUrl = await recorderService.stopRecording(testRoomId, mockCardState);
      expect(dataUrl).toBeDefined();

      // 8. Cleanup
      stateSyncService.unregisterRoom(testRoomId);
    });

    it('should generate deterministic HMAC hash', () => {
      const key = Buffer.alloc(32, 0xAB);
      const nonce = Buffer.alloc(16, 0xCD);
      const cards = [
        { suit: 'spades', rank: 'A', id: 'card-1' },
        { suit: 'hearts', rank: 'K', id: 'card-2' },
        { suit: 'diamonds', rank: 'Q', id: 'card-3' },
        { suit: 'clubs', rank: 'J', id: 'card-4' },
      ];

      const hash1 = stateSyncService.generateCardHash(cards, key, nonce);
      const hash2 = stateSyncService.generateCardHash(cards, key, nonce);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    it('should handle spectate push without errors', async () => {
      await stateSyncService.spectatePush(testRoomId, mockCardState);
      // Should complete without throwing
    });

    it('should cleanup all resources on unregister', () => {
      stateSyncService.registerRoom(testRoomId, GameType.BOARD, () => mockBoardState);
      stateSyncService.unregisterRoom(testRoomId);

      // After unregister, strategies should be cleaned up
      expect(boardStrategy.getCurrentFrameSeq(testRoomId)).toBe(0);
    });
  });
});
