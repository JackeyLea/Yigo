/**
 * RoomStateMachine Unit Tests
 * 房间状态机单元测试
 */
import { RoomStateMachine, RoomEvent, RoomAction } from './room-state-machine';
import { RoomStatus } from '../common/entities/room.entity';
import { RoomEntityLike } from './room-state-machine';

describe('RoomStateMachine', () => {
  let stateMachine: RoomStateMachine;

  beforeEach(() => {
    stateMachine = new RoomStateMachine();
  });

  describe('canTransition', () => {
    it('should allow WAITING -> READY via PLAYER_READY when all players ready', () => {
      expect(
        stateMachine.canTransition(RoomStatus.WAITING, RoomEvent.PLAYER_READY),
      ).toBe(true);
    });

    it('should allow READY -> WAITING via PLAYER_UNREADY', () => {
      expect(
        stateMachine.canTransition(RoomStatus.READY, RoomEvent.PLAYER_UNREADY),
      ).toBe(true);
    });

    it('should allow READY -> PLAYING via HOST_START', () => {
      expect(
        stateMachine.canTransition(RoomStatus.READY, RoomEvent.HOST_START),
      ).toBe(true);
    });

    it('should allow PLAYING -> FINISHED via GAME_END', () => {
      expect(
        stateMachine.canTransition(RoomStatus.PLAYING, RoomEvent.GAME_END),
      ).toBe(true);
    });

    it('should allow any status -> FINISHED via HOST_DISSOLVE', () => {
      expect(
        stateMachine.canTransition(RoomStatus.WAITING, RoomEvent.HOST_DISSOLVE),
      ).toBe(true);
      expect(
        stateMachine.canTransition(RoomStatus.READY, RoomEvent.HOST_DISSOLVE),
      ).toBe(true);
      expect(
        stateMachine.canTransition(RoomStatus.PLAYING, RoomEvent.HOST_DISSOLVE),
      ).toBe(true);
      expect(
        stateMachine.canTransition(RoomStatus.PAUSED, RoomEvent.HOST_DISSOLVE),
      ).toBe(true);
    });

    it('should allow FINISHED -> WAITING via REMAKE', () => {
      expect(
        stateMachine.canTransition(RoomStatus.FINISHED, RoomEvent.REMAKE),
      ).toBe(true);
    });

    it('should allow PLAYING -> PAUSED via GAME_PAUSE', () => {
      expect(
        stateMachine.canTransition(RoomStatus.PLAYING, RoomEvent.GAME_PAUSE),
      ).toBe(true);
    });

    it('should allow PAUSED -> PLAYING via GAME_RESUME', () => {
      expect(
        stateMachine.canTransition(RoomStatus.PAUSED, RoomEvent.GAME_RESUME),
      ).toBe(true);
    });

    it('should allow WAITING -> FINISHED via TIMEOUT', () => {
      expect(
        stateMachine.canTransition(RoomStatus.WAITING, RoomEvent.TIMEOUT),
      ).toBe(true);
    });

    it('should not allow PLAYING -> READY via HOST_START', () => {
      expect(
        stateMachine.canTransition(RoomStatus.PLAYING, RoomEvent.HOST_START),
      ).toBe(false);
    });

    it('should not allow FINISHED -> PLAYING via HOST_START', () => {
      expect(
        stateMachine.canTransition(RoomStatus.FINISHED, RoomEvent.HOST_START),
      ).toBe(false);
    });
  });

  describe('transition', () => {
    const createMockRoom = (overrides: Partial<RoomEntityLike> = {}): RoomEntityLike => ({
      room_id: 'ABC123',
      status: RoomStatus.WAITING,
      host_id: '1',
      max_players: 4,
      current_players: 2,
      room_players: [
        { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date('2024-01-01') },
        { user_id: '2', is_ready: true, is_ai: false, is_host: false, seat_index: 1, joined_at: new Date('2024-01-02') },
      ],
      ...overrides,
    });

    it('should transition WAITING -> READY when all players ready', () => {
      const room = createMockRoom();
      const newStatus = stateMachine.transition(room, RoomEvent.PLAYER_READY);
      expect(newStatus).toBe(RoomStatus.READY);
    });

    it('should keep WAITING when not all players ready', () => {
      const room = createMockRoom({
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date('2024-01-01') },
          { user_id: '2', is_ready: false, is_ai: false, is_host: false, seat_index: 1, joined_at: new Date('2024-01-02') },
        ],
      });
      const newStatus = stateMachine.transition(room, RoomEvent.PLAYER_READY);
      expect(newStatus).toBe(RoomStatus.WAITING);
    });

    it('should transition READY -> PLAYING via HOST_START', () => {
      const room = createMockRoom({ status: RoomStatus.READY });
      const newStatus = stateMachine.transition(room, RoomEvent.HOST_START);
      expect(newStatus).toBe(RoomStatus.PLAYING);
    });

    it('should transition PLAYING -> FINISHED via GAME_END', () => {
      const room = createMockRoom({ status: RoomStatus.PLAYING });
      const newStatus = stateMachine.transition(room, RoomEvent.GAME_END);
      expect(newStatus).toBe(RoomStatus.FINISHED);
    });

    it('should transition WAITING -> FINISHED via HOST_DISSOLVE', () => {
      const room = createMockRoom();
      const newStatus = stateMachine.transition(room, RoomEvent.HOST_DISSOLVE);
      expect(newStatus).toBe(RoomStatus.FINISHED);
    });

    it('should transition FINISHED -> WAITING via REMAKE', () => {
      const room = createMockRoom({ status: RoomStatus.FINISHED });
      const newStatus = stateMachine.transition(room, RoomEvent.REMAKE);
      expect(newStatus).toBe(RoomStatus.WAITING);
    });

    it('should transition PLAYING -> PAUSED via GAME_PAUSE', () => {
      const room = createMockRoom({ status: RoomStatus.PLAYING });
      const newStatus = stateMachine.transition(room, RoomEvent.GAME_PAUSE);
      expect(newStatus).toBe(RoomStatus.PAUSED);
    });

    it('should transition PAUSED -> PLAYING via GAME_RESUME', () => {
      const room = createMockRoom({ status: RoomStatus.PAUSED });
      const newStatus = stateMachine.transition(room, RoomEvent.GAME_RESUME);
      expect(newStatus).toBe(RoomStatus.PLAYING);
    });

    it('should keep current status on HOST_TRANSFER', () => {
      const room = createMockRoom({ status: RoomStatus.WAITING });
      const newStatus = stateMachine.transition(room, RoomEvent.HOST_TRANSFER);
      expect(newStatus).toBe(RoomStatus.WAITING);
    });

    it('should transition WAITING -> FINISHED on TIMEOUT', () => {
      const room = createMockRoom();
      const newStatus = stateMachine.transition(room, RoomEvent.TIMEOUT);
      expect(newStatus).toBe(RoomStatus.FINISHED);
    });

    it('should transition to FINISHED when all players left', () => {
      const room = createMockRoom({
        current_players: 0,
        room_players: [],
      });
      const newStatus = stateMachine.transition(room, RoomEvent.ALL_PLAYERS_LEFT);
      expect(newStatus).toBe(RoomStatus.FINISHED);
    });

    it('should throw error for unknown event', () => {
      const room = createMockRoom();
      expect(() =>
        stateMachine.transition(room, 'unknown_event' as RoomEvent),
      ).toThrow('未知事件');
    });

    it('should throw error for invalid transition', () => {
      const room = createMockRoom({ status: RoomStatus.FINISHED });
      expect(() =>
        stateMachine.transition(room, RoomEvent.HOST_START),
      ).toThrow('无效的状态转换');
    });
  });

  describe('areAllPlayersReady', () => {
    it('should return true when all non-AI players are ready', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date() },
          { user_id: '2', is_ready: true, is_ai: false, is_host: false, seat_index: 1, joined_at: new Date() },
        ],
      };
      expect(stateMachine.areAllPlayersReady(room)).toBe(true);
    });

    it('should return false when a non-AI player is not ready', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date() },
          { user_id: '2', is_ready: false, is_ai: false, is_host: false, seat_index: 1, joined_at: new Date() },
        ],
      };
      expect(stateMachine.areAllPlayersReady(room)).toBe(false);
    });

    it('should ignore AI players readiness', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date() },
          { user_id: 'AI1', is_ready: false, is_ai: true, is_host: false, seat_index: 1, joined_at: new Date() },
        ],
      };
      expect(stateMachine.areAllPlayersReady(room)).toBe(true);
    });

    it('should return false when no players exist', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 0,
        room_players: [],
      };
      expect(stateMachine.areAllPlayersReady(room)).toBe(false);
    });
  });

  describe('canStartGame', () => {
    it('should return true when in READY status with enough players all ready', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.READY,
        host_id: '1',
        max_players: 4,
        current_players: 2,
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date() },
          { user_id: '2', is_ready: true, is_ai: false, is_host: false, seat_index: 1, joined_at: new Date() },
        ],
      };
      expect(stateMachine.canStartGame(room)).toBe(true);
    });

    it('should return false when not in READY status', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.WAITING,
        host_id: '1',
        max_players: 4,
        current_players: 2,
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date() },
          { user_id: '2', is_ready: true, is_ai: false, is_host: false, seat_index: 1, joined_at: new Date() },
        ],
      };
      expect(stateMachine.canStartGame(room)).toBe(false);
    });

    it('should return false when less than min players', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.READY,
        host_id: '1',
        max_players: 4,
        current_players: 1,
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date() },
        ],
      };
      expect(stateMachine.canStartGame(room)).toBe(false);
    });

    it('should return false when not all players ready', () => {
      const room: RoomEntityLike = {
        room_id: 'ABC123',
        status: RoomStatus.READY,
        host_id: '1',
        max_players: 4,
        current_players: 2,
        room_players: [
          { user_id: '1', is_ready: true, is_ai: false, is_host: true, seat_index: 0, joined_at: new Date() },
          { user_id: '2', is_ready: false, is_ai: false, is_host: false, seat_index: 1, joined_at: new Date() },
        ],
      };
      expect(stateMachine.canStartGame(room)).toBe(false);
    });
  });

  describe('getAvailableActions', () => {
    const createMockRoom = (status: RoomStatus, isHost: boolean = false, isPlayer: boolean = true): RoomEntityLike => ({
      room_id: 'ABC123',
      status,
      host_id: isHost ? '100' : '1',
      max_players: 4,
      current_players: 2,
      room_players: isPlayer
        ? [{ user_id: '100', is_ready: false, is_ai: false, is_host: isHost, seat_index: 0, joined_at: new Date() }]
        : [],
    });

    it('should return correct actions for WAITING status as host', () => {
      const room = createMockRoom(RoomStatus.WAITING, true);
      const actions = stateMachine.getAvailableActions(room, 100);
      expect(actions).toContain(RoomAction.LEAVE_ROOM);
      expect(actions).toContain(RoomAction.READY);
      expect(actions).toContain(RoomAction.KICK_PLAYER);
      expect(actions).toContain(RoomAction.TRANSFER_HOST);
      expect(actions).toContain(RoomAction.DISSOLVE_ROOM);
    });

    it('should return correct actions for WAITING status as non-host player', () => {
      const room = createMockRoom(RoomStatus.WAITING, false);
      const actions = stateMachine.getAvailableActions(room, 100);
      expect(actions).toContain(RoomAction.LEAVE_ROOM);
      expect(actions).toContain(RoomAction.READY);
      expect(actions).not.toContain(RoomAction.KICK_PLAYER);
      expect(actions).not.toContain(RoomAction.DISSOLVE_ROOM);
    });

    it('should return correct actions for non-player', () => {
      const room = createMockRoom(RoomStatus.WAITING, false, false);
      const actions = stateMachine.getAvailableActions(room, 999);
      expect(actions).toContain(RoomAction.JOIN_ROOM);
      expect(actions).toContain(RoomAction.SPECTATE);
      expect(actions).not.toContain(RoomAction.LEAVE_ROOM);
    });

    it('should return correct actions for READY status as host', () => {
      const room = createMockRoom(RoomStatus.READY, true);
      const actions = stateMachine.getAvailableActions(room, 100);
      expect(actions).toContain(RoomAction.START_GAME);
      expect(actions).toContain(RoomAction.KICK_PLAYER);
      expect(actions).toContain(RoomAction.DISSOLVE_ROOM);
    });

    it('should return correct actions for PLAYING status as player', () => {
      const room = createMockRoom(RoomStatus.PLAYING, false);
      const actions = stateMachine.getAvailableActions(room, 100);
      expect(actions).toContain(RoomAction.LEAVE_ROOM);
      expect(actions).toContain(RoomAction.SPECTATE);
      expect(actions).not.toContain(RoomAction.READY);
      expect(actions).not.toContain(RoomAction.START_GAME);
    });

    it('should return correct actions for FINISHED status as host', () => {
      const room = createMockRoom(RoomStatus.FINISHED, true);
      const actions = stateMachine.getAvailableActions(room, 100);
      expect(actions).toContain(RoomAction.REMAKE);
      expect(actions).toContain(RoomAction.DISSOLVE_ROOM);
    });
  });
});
