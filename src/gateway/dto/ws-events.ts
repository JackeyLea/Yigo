/**
 * WebSocket 事件类型常量
 *
 * 定义所有客户端→服务端和服务端→客户端的WebSocket事件名称。
 * 使用 const assertion 确保类型安全。
 */
export const WS_EVENTS = {
  // ========== 客户端→服务端 ==========
  /** 加入房间 */
  C_JOIN_ROOM: 'room:join',
  /** 离开房间 */
  C_LEAVE_ROOM: 'room:leave',
  /** 游戏操作 */
  C_GAME_ACTION: 'game:action',
  /** 观战加入 */
  C_SPECTATE_JOIN: 'spectate:join',
  /** 观战离开 */
  C_SPECTATE_LEAVE: 'spectate:leave',
  /** 聊天消息 */
  C_CHAT_MESSAGE: 'chat:message',
  /** 准备/取消准备 */
  C_READY_TOGGLE: 'room:ready',
  /** 心跳 */
  C_HEARTBEAT: 'heartbeat',

  // ========== 服务端→客户端 ==========
  /** 玩家加入 */
  S_PLAYER_JOINED: 'player:joined',
  /** 玩家离开 */
  S_PLAYER_LEFT: 'player:left',
  /** 玩家准备状态变更 */
  S_PLAYER_READY: 'player:ready',
  /** 游戏开始 */
  S_GAME_STARTED: 'game:started',
  /** 游戏状态同步 */
  S_GAME_STATE: 'game:state',
  /** 游戏操作结果 */
  S_GAME_ACTION_RESULT: 'game:action:result',
  /** 聊天消息广播 */
  S_CHAT_MESSAGE: 'chat:message',
  /** 错误 */
  S_ERROR: 'error',
  /** 房间解散 */
  S_ROOM_DISSOLVED: 'room:dissolved',
  /** 房主变更 */
  S_HOST_CHANGED: 'host:changed',
} as const;

/** WebSocket 事件类型 */
export type WSEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// ========== 客户端→服务端 Payload 类型 ==========

/** 加入房间请求 */
export interface JoinRoomPayload {
  roomId: string;
  password?: string;
  seatIndex?: number;
}

/** 离开房间请求 */
export interface LeaveRoomPayload {
  roomId: string;
}

/** 游戏操作请求 */
export interface GameActionPayload {
  roomId: string;
  action: Record<string, any>;
}

/** 观战请求 */
export interface SpectatePayload {
  roomId: string;
}

/** 聊天消息请求 */
export interface ChatMessagePayload {
  roomId: string;
  message: string;
}

/** 准备切换请求 */
export interface ReadyTogglePayload {
  roomId: string;
}

// ========== 服务端→客户端 Payload 类型 ==========

/** 玩家加入通知 */
export interface PlayerJoinedEvent {
  roomId: string;
  userId: number;
  username: string;
  nickname: string;
  seatIndex: number;
  avatarUrl?: string;
}

/** 玩家离开通知 */
export interface PlayerLeftEvent {
  roomId: string;
  userId: number;
  isHost: boolean;
  reason?: string;
}

/** 玩家准备状态变更 */
export interface PlayerReadyEvent {
  roomId: string;
  userId: number;
  isReady: boolean;
}

/** 游戏开始通知 */
export interface GameStartedEvent {
  roomId: string;
  gameType: string;
  players: Array<{
    userId: number;
    seatIndex: number;
  }>;
}

/** 游戏状态同步 */
export interface GameStateEvent {
  roomId: string;
  state: Record<string, any>;
  timestamp: number;
}

/** 游戏操作结果 */
export interface GameActionResultEvent {
  roomId: string;
  userId: number;
  action: Record<string, any>;
  result: 'success' | 'failure' | 'invalid';
  stateSnapshot?: Record<string, any>;
  message?: string;
}

/** 聊天消息广播 */
export interface ChatMessageEvent {
  roomId: string;
  userId: number;
  username: string;
  message: string;
  timestamp: number;
}

/** 错误通知 */
export interface ErrorEvent {
  code: string;
  message: string;
  details?: Record<string, any>;
}

/** 房间解散通知 */
export interface RoomDissolvedEvent {
  roomId: string;
  reason: string;
}

/** 房主变更通知 */
export interface HostChangedEvent {
  roomId: string;
  oldHostId: number;
  newHostId: number;
  newHostName: string;
}
