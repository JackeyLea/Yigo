/**
 * Room State Machine - 房间状态机
 * 管理房间状态转换规则与可用操作
 */
import { Injectable } from '@nestjs/common';
import { Room, RoomStatus } from '../common/entities/room.entity';
import { RoomPlayer } from '../common/entities/room-player.entity';

/** 房间事件类型 */
export enum RoomEvent {
  PLAYER_JOINED = 'player_joined',
  PLAYER_LEFT = 'player_left',
  PLAYER_READY = 'player_ready',
  PLAYER_UNREADY = 'player_unready',
  HOST_START = 'host_start',
  HOST_DISSOLVE = 'host_dissolve',
  HOST_TRANSFER = 'host_transfer',
  GAME_END = 'game_end',
  GAME_PAUSE = 'game_pause',
  GAME_RESUME = 'game_resume',
  TIMEOUT = 'timeout',
  ALL_PLAYERS_LEFT = 'all_players_left',
  REMAKE = 'remake',
}

/** 房间动作 */
export enum RoomAction {
  START_GAME = 'start_game',
  READY = 'ready',
  UNREADY = 'unready',
  KICK_PLAYER = 'kick_player',
  TRANSFER_HOST = 'transfer_host',
  DISSOLVE_ROOM = 'dissolve_room',
  LEAVE_ROOM = 'leave_room',
  JOIN_ROOM = 'join_room',
  SPECTATE = 'spectate',
  REMAKE = 'remake',
}

/** 状态转换定义 */
interface TransitionRule {
  from: RoomStatus[];
  to: RoomStatus;
  condition?: (room: RoomEntityLike, event?: RoomEvent, payload?: any) => boolean;
}

/** 与Room Entity兼容的接口 */
export interface RoomEntityLike {
  room_id: string;
  status: RoomStatus;
  host_id: string;
  max_players: number;
  current_players: number;
  room_players?: Array<{
    user_id: string;
    is_ready: boolean;
    is_ai: boolean;
    is_host: boolean;
    seat_index: number;
    joined_at: Date;
  }>;
}

/** 状态转换规则表 */
const TRANSITION_RULES: Record<RoomEvent, TransitionRule> = {
  [RoomEvent.PLAYER_JOINED]: {
    from: [RoomStatus.WAITING, RoomStatus.PAUSED],
    to: RoomStatus.WAITING,
  },
  [RoomEvent.PLAYER_LEFT]: {
    from: [RoomStatus.WAITING, RoomStatus.READY],
    to: RoomStatus.WAITING,
  },
  [RoomEvent.PLAYER_READY]: {
    from: [RoomStatus.WAITING],
    to: RoomStatus.READY,
    condition: (room) => {
      const players = room.room_players || [];
      const nonAiPlayers = players.filter((p) => !p.is_ai && !p.is_host);
      const allReady = nonAiPlayers.length > 0 && nonAiPlayers.every((p) => p.is_ready);
      const minPlayers = 2;
      return allReady && players.length >= minPlayers;
    },
  },
  [RoomEvent.PLAYER_UNREADY]: {
    from: [RoomStatus.READY],
    to: RoomStatus.WAITING,
    condition: (room) => {
      const players = room.room_players || [];
      const nonAiPlayers = players.filter((p) => !p.is_ai && !p.is_host);
      return nonAiPlayers.some((p) => !p.is_ready);
    },
  },
  [RoomEvent.HOST_START]: {
    from: [RoomStatus.READY],
    to: RoomStatus.PLAYING,
    condition: (room) => {
      const playerCount = room.current_players;
      return playerCount >= 2 && playerCount <= room.max_players;
    },
  },
  [RoomEvent.HOST_DISSOLVE]: {
    from: [RoomStatus.WAITING, RoomStatus.READY, RoomStatus.PLAYING, RoomStatus.PAUSED],
    to: RoomStatus.FINISHED,
  },
  [RoomEvent.HOST_TRANSFER]: {
    from: [RoomStatus.WAITING, RoomStatus.READY, RoomStatus.PLAYING, RoomStatus.PAUSED],
    to: undefined as any,
  },
  [RoomEvent.GAME_END]: {
    from: [RoomStatus.PLAYING, RoomStatus.PAUSED],
    to: RoomStatus.FINISHED,
  },
  [RoomEvent.GAME_PAUSE]: {
    from: [RoomStatus.PLAYING],
    to: RoomStatus.PAUSED,
  },
  [RoomEvent.GAME_RESUME]: {
    from: [RoomStatus.PAUSED],
    to: RoomStatus.PLAYING,
  },
  [RoomEvent.TIMEOUT]: {
    from: [RoomStatus.WAITING],
    to: RoomStatus.FINISHED,
  },
  [RoomEvent.ALL_PLAYERS_LEFT]: {
    from: [RoomStatus.WAITING, RoomStatus.READY],
    to: RoomStatus.FINISHED,
    condition: (room) => room.current_players === 0,
  },
  [RoomEvent.REMAKE]: {
    from: [RoomStatus.FINISHED],
    to: RoomStatus.WAITING,
  },
};

@Injectable()
export class RoomStateMachine {
  /**
   * 检查状态转换是否允许
   */
  canTransition(current: RoomStatus, event: RoomEvent): boolean {
    const rule = TRANSITION_RULES[event];
    if (!rule) return false;
    return rule.from.includes(current);
  }

  /**
   * 执行状态转换，返回新状态
   */
  transition(room: RoomEntityLike, event: RoomEvent, payload?: any): RoomStatus {
    const current = room.status;
    const rule = TRANSITION_RULES[event];

    if (!rule) {
      throw new Error(`未知事件: ${event}`);
    }

    if (!rule.from.includes(current)) {
      throw new Error(
        `无效的状态转换: ${current} -> ${rule.to} via ${event}`,
      );
    }

    // 检查转换条件
    if (rule.condition && !rule.condition(room, event, payload)) {
      // 条件不满足时保持当前状态（除了必须转换的事件）
      if (event === RoomEvent.ALL_PLAYERS_LEFT || event === RoomEvent.TIMEOUT) {
        return RoomStatus.FINISHED;
      }
      if (event === RoomEvent.PLAYER_UNREADY) {
        return RoomStatus.WAITING;
      }
      return current;
    }

    // 对于HOST_TRANSFER，状态不变化
    if (event === RoomEvent.HOST_TRANSFER) {
      return current;
    }

    return rule.to ?? current;
  }

  /**
   * 获取玩家在房间中可执行的操作列表
   */
  getAvailableActions(room: RoomEntityLike, userId: number): RoomAction[] {
    const actions: RoomAction[] = [];
    const uid = String(userId);
    const isHost = room.host_id === uid;
    const players = room.room_players || [];
    const isPlayer = players.some((p) => p.user_id === uid);

    switch (room.status) {
      case RoomStatus.WAITING:
        if (isPlayer) {
          actions.push(RoomAction.LEAVE_ROOM);
          actions.push(RoomAction.READY);
        } else {
          actions.push(RoomAction.JOIN_ROOM);
          actions.push(RoomAction.SPECTATE);
        }
        if (isHost) {
          actions.push(RoomAction.KICK_PLAYER);
          actions.push(RoomAction.TRANSFER_HOST);
          actions.push(RoomAction.DISSOLVE_ROOM);
        }
        break;

      case RoomStatus.READY:
        if (isPlayer) {
          const player = players.find((p) => p.user_id === uid);
          if (player?.is_ready) {
            actions.push(RoomAction.UNREADY);
          } else {
            actions.push(RoomAction.READY);
          }
          actions.push(RoomAction.LEAVE_ROOM);
        } else {
          actions.push(RoomAction.JOIN_ROOM);
          actions.push(RoomAction.SPECTATE);
        }
        if (isHost) {
          actions.push(RoomAction.START_GAME);
          actions.push(RoomAction.KICK_PLAYER);
          actions.push(RoomAction.TRANSFER_HOST);
          actions.push(RoomAction.DISSOLVE_ROOM);
        }
        break;

      case RoomStatus.PLAYING:
      case RoomStatus.PAUSED:
        if (isPlayer) {
          actions.push(RoomAction.LEAVE_ROOM);
        }
        actions.push(RoomAction.SPECTATE);
        if (isHost) {
          actions.push(RoomAction.DISSOLVE_ROOM);
        }
        break;

      case RoomStatus.FINISHED:
        if (isHost) {
          actions.push(RoomAction.REMAKE);
          actions.push(RoomAction.DISSOLVE_ROOM);
        }
        actions.push(RoomAction.LEAVE_ROOM);
        break;
    }

    return [...new Set(actions)];
  }

  /**
   * 检查房间是否所有非AI玩家都已准备
   */
  areAllPlayersReady(room: RoomEntityLike): boolean {
    const players = room.room_players || [];
    if (players.length === 0) return false;
    const nonAiPlayers = players.filter((p) => !p.is_ai);
    if (nonAiPlayers.length === 0) return false;
    return nonAiPlayers.every((p) => p.is_ready || p.is_host);
  }

  /**
   * 检查是否满足开始游戏条件
   */
  canStartGame(room: RoomEntityLike): boolean {
    const playerCount = room.current_players;
    return (
      room.status === RoomStatus.READY &&
      playerCount >= 2 &&
      playerCount <= room.max_players &&
      this.areAllPlayersReady(room)
    );
  }
}
