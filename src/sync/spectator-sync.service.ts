/**
 * SpectatorSyncService - 观战同步服务
 *
 * 核心功能：
 * 1. 环形缓冲区实现观战延迟（15秒）
 * 2. 观战者聊天隔离（观战者只能互相聊天）
 * 3. 观战视角切换（可切换看不同玩家的手牌，仅在Showdown阶段）
 * 4. 观战数据流管理
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ==================== 类型定义 ====================

/** 游戏事件 */
export interface GameEvent {
  id: string;
  type: string;
  timestamp: number;      // 事件发生时间
  emitTimestamp: number;  // 计划发送时间（实际事件时间 + 延迟）
  roomId: string;
  payload: any;
  visibility: 'public' | 'player_only' | 'showdown_only'; // 可见性
  targetPlayerId?: string; // 针对特定玩家的事件（如手牌）
}

/** 观战者信息 */
export interface SpectatorInfo {
  userId: number;
  socketId: string;
  joinedAt: number;
  perspectivePlayerId?: string; // 当前视角切换到的玩家ID
  isChatEnabled: boolean;
}

/** 环形缓冲区节点 */
interface RingBufferNode {
  event: GameEvent;
  next: RingBufferNode | null;
}

/** 环形缓冲区 */
export class RingBuffer {
  private head: RingBufferNode | null = null;
  private tail: RingBufferNode | null = null;
  private size: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** 写入事件 */
  write(event: GameEvent): void {
    const node: RingBufferNode = { event, next: null };

    if (!this.head) {
      this.head = node;
      this.tail = node;
      this.size = 1;
      return;
    }

    // 写入尾部
    this.tail!.next = node;
    this.tail = node;
    this.size++;

    // 超过容量时移除头部
    if (this.size > this.capacity) {
      this.head = this.head!.next;
      this.size--;
    }
  }

  /** 读取所有可发送的事件（emitTimestamp <= now） */
  readReady(now: number): GameEvent[] {
    const events: GameEvent[] = [];
    let current = this.head;
    let prev: RingBufferNode | null = null;

    while (current) {
      const next = current.next;
      if (current.event.emitTimestamp <= now) {
        events.push(current.event);
        // 移除该节点（prev 保持不变，仍然指向已移除节点的前驱）
        if (prev) {
          prev.next = next;
        } else {
          this.head = next;
        }
        if (!next) {
          this.tail = prev;
        }
        this.size--;
      } else {
        // 未 ready 的节点保留，继续向后扫描（缓冲区按写入顺序而非 ready 时间排列）
        prev = current;
      }
      current = next;
    }

    return events;
  }

  /** 获取当前大小 */
  getSize(): number {
    return this.size;
  }

  /** 清空 */
  clear(): void {
    this.head = null;
    this.tail = null;
    this.size = 0;
  }

  /** 获取所有事件（调试用） */
  getAllEvents(): GameEvent[] {
    const events: GameEvent[] = [];
    let current = this.head;
    while (current) {
      events.push(current.event);
      current = current.next;
    }
    return events;
  }
}

/** 聊天消息 */
export interface SpectatorChatMessage {
  id: string;
  roomId: string;
  userId: number;
  username: string;
  message: string;
  timestamp: number;
}

/** 观战房间状态 */
interface SpectatorRoomState {
  roomId: string;
  ringBuffer: RingBuffer;
  spectators: Map<number, SpectatorInfo>; // userId -> info
  chatHistory: SpectatorChatMessage[];
  isShowdownPhase: boolean;
  playerIds: string[];
}

// ==================== 常量 ====================

/** 默认观战延迟（毫秒）- 15秒 */
const DEFAULT_SPECTATOR_DELAY_MS = 15000;
/** 环形缓冲区容量（最多缓存多少条延迟事件） */
const RING_BUFFER_CAPACITY = 5000;
/** 观战聊天历史保留条数 */
const MAX_CHAT_HISTORY = 100;

@Injectable()
export class SpectatorSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(SpectatorSyncService.name);
  private readonly delayMs: number;
  private readonly flushIntervalMs: number;

  /** 房间观战状态映射 */
  private roomStates: Map<string, SpectatorRoomState> = new Map();

  /** 定时刷新句柄 */
  private flushInterval: NodeJS.Timeout | null = null;

  /** 观战聊天隔离：仅观战者可用的聊天室 */
  private spectatorChatRooms: Map<string, Set<number>> = new Map(); // roomId -> Set<userId>

  constructor(private readonly configService: ConfigService) {
    this.delayMs = this.configService.get<number>(
      'SPECTATOR_DELAY_MS',
      DEFAULT_SPECTATOR_DELAY_MS,
    );
    this.flushIntervalMs = Math.min(100, this.delayMs / 10); // 每100ms或延迟的1/10刷新一次

    // 启动定时刷新任务
    this.flushInterval = setInterval(() => {
      this.flushReadyEvents();
    }, this.flushIntervalMs);

    this.logger.log(`SpectatorSyncService initialized: delay=${this.delayMs}ms, flushInterval=${this.flushIntervalMs}ms`);
  }

  // ==================== 房间管理 ====================

  /**
   * 注册观战房间
   * - 创建环形缓冲区
   * - 初始化观战者列表
   */
  registerRoom(roomId: string, playerIds: string[]): void {
    if (this.roomStates.has(roomId)) {
      // 更新玩家列表
      const state = this.roomStates.get(roomId)!;
      state.playerIds = playerIds;
      this.logger.debug(`Room ${roomId} player list updated: ${playerIds.join(',')}`);
      return;
    }

    const state: SpectatorRoomState = {
      roomId,
      ringBuffer: new RingBuffer(RING_BUFFER_CAPACITY),
      spectators: new Map(),
      chatHistory: [],
      isShowdownPhase: false,
      playerIds,
    };

    this.roomStates.set(roomId, state);
    this.spectatorChatRooms.set(roomId, new Set());

    this.logger.log(`Room ${roomId} registered for spectator sync with ${playerIds.length} players`);
  }

  /**
   * 注销观战房间
   * - 清理环形缓冲区
   * - 移除所有观战者
   */
  unregisterRoom(roomId: string): void {
    const state = this.roomStates.get(roomId);
    if (state) {
      state.ringBuffer.clear();
      state.spectators.clear();
      this.roomStates.delete(roomId);
    }

    this.spectatorChatRooms.delete(roomId);
    this.logger.log(`Room ${roomId} unregistered from spectator sync`);
  }

  // ==================== 观战者管理 ====================

  /**
   * 添加观战者
   */
  addSpectator(
    roomId: string,
    userId: number,
    socketId: string,
  ): void {
    const state = this.roomStates.get(roomId);
    if (!state) {
      this.logger.warn(`Cannot add spectator: room ${roomId} not registered`);
      return;
    }

    const info: SpectatorInfo = {
      userId,
      socketId,
      joinedAt: Date.now(),
      isChatEnabled: true,
    };

    state.spectators.set(userId, info);

    // 添加到观战者聊天室
    const chatRoom = this.spectatorChatRooms.get(roomId);
    if (chatRoom) {
      chatRoom.add(userId);
    }

    this.logger.debug(`Spectator ${userId} added to room ${roomId}`);
  }

  /**
   * 移除观战者
   */
  removeSpectator(roomId: string, userId: number): void {
    const state = this.roomStates.get(roomId);
    if (state) {
      state.spectators.delete(userId);
    }

    const chatRoom = this.spectatorChatRooms.get(roomId);
    if (chatRoom) {
      chatRoom.delete(userId);
    }

    this.logger.debug(`Spectator ${userId} removed from room ${roomId}`);
  }

  /**
   * 获取房间观战者数量
   */
  getSpectatorCount(roomId: string): number {
    const state = this.roomStates.get(roomId);
    return state ? state.spectators.size : 0;
  }

  /**
   * 获取房间观战者列表
   */
  getSpectators(roomId: string): SpectatorInfo[] {
    const state = this.roomStates.get(roomId);
    return state ? Array.from(state.spectators.values()) : [];
  }

  // ==================== 事件缓冲（15秒延迟） ====================

  /**
   * 缓冲游戏事件
   * - 将事件写入环形缓冲区
   * - 设置延迟后的发送时间
   */
  bufferEvent(roomId: string, event: Omit<GameEvent, 'emitTimestamp'>): void {
    const state = this.roomStates.get(roomId);
    if (!state) {
      this.logger.warn(`Cannot buffer event: room ${roomId} not registered`);
      return;
    }

    const delayedEvent: GameEvent = {
      ...event,
      emitTimestamp: event.timestamp + this.delayMs,
    };

    state.ringBuffer.write(delayedEvent);
  }

  /**
   * 批量缓冲游戏事件
   */
  bufferEvents(roomId: string, events: Omit<GameEvent, 'emitTimestamp'>[]): void {
    const state = this.roomStates.get(roomId);
    if (!state) return;

    for (const event of events) {
      state.ringBuffer.write({
        ...event,
        emitTimestamp: event.timestamp + this.delayMs,
      });
    }
  }

  /**
   * 刷新可发送事件
   * - 由定时任务调用
   * - 返回需要发送给观战者的事件列表
   */
  flushReadyEvents(): Array<{ roomId: string; events: GameEvent[] }> {
    const now = Date.now();
    const result: Array<{ roomId: string; events: GameEvent[] }> = [];

    for (const [roomId, state] of this.roomStates) {
      if (state.spectators.size === 0) continue; // 没有观战者时跳过

      const readyEvents = state.ringBuffer.readReady(now);

      if (readyEvents.length > 0) {
        // 过滤可见性
        const filteredEvents = this.filterEventsByVisibility(state, readyEvents);
        if (filteredEvents.length > 0) {
          result.push({ roomId, events: filteredEvents });
        }
      }
    }

    return result;
  }

  /**
   * 立即清除缓冲区并发送所有事件
   * - 房间结束时调用
   */
  flushAll(roomId: string): GameEvent[] {
    const state = this.roomStates.get(roomId);
    if (!state) return [];

    const allEvents = state.ringBuffer.getAllEvents();
    state.ringBuffer.clear();
    return this.filterEventsByVisibility(state, allEvents);
  }

  /**
   * 获取缓冲区状态（监控用）
   */
  getBufferStatus(roomId: string): { size: number; capacity: number; delayMs: number } | null {
    const state = this.roomStates.get(roomId);
    if (!state) return null;

    return {
      size: state.ringBuffer.getSize(),
      capacity: RING_BUFFER_CAPACITY,
      delayMs: this.delayMs,
    };
  }

  // ==================== 可见性过滤 ====================

  /**
   * 根据可见性过滤事件
   * - public: 所有观战者可见
   * - player_only: 仅当视角切换到该玩家时可见
   * - showdown_only: 仅在Showdown阶段可见
   */
  private filterEventsByVisibility(
    state: SpectatorRoomState,
    events: GameEvent[],
  ): GameEvent[] {
    return events.filter((event) => {
      switch (event.visibility) {
        case 'public':
          return true;

        case 'player_only':
          // 仅当观战者切换到该玩家视角时可见
          // 如果未指定targetPlayerId，则默认不可见
          if (!event.targetPlayerId) return false;
          // 检查是否有观战者切换到了该视角
          for (const spectator of state.spectators.values()) {
            if (spectator.perspectivePlayerId === event.targetPlayerId) {
              return true;
            }
          }
          return false;

        case 'showdown_only':
          // 仅在Showdown阶段可见
          return state.isShowdownPhase;

        default:
          return true;
      }
    });
  }

  // ==================== 阶段管理 ====================

  /**
   * 设置游戏阶段
   * - 进入Showdown阶段时，showdown_only事件变得可见
   */
  setGamePhase(roomId: string, phase: string): void {
    const state = this.roomStates.get(roomId);
    if (!state) return;

    const wasShowdown = state.isShowdownPhase;
    state.isShowdownPhase = (phase === 'showdown' || phase === 'SHOWDOWN');

    if (!wasShowdown && state.isShowdownPhase) {
      this.logger.log(`Room ${roomId} entered SHOWDOWN phase - showdown events now visible`);
    }
  }

  // ==================== 视角切换 ====================

  /**
   * 切换观战视角
   * - 观战者可选择查看特定玩家的手牌
   * - 仅在Showdown阶段生效
   */
  switchPerspective(
    roomId: string,
    userId: number,
    targetPlayerId: string | null,
  ): boolean {
    const state = this.roomStates.get(roomId);
    if (!state) {
      this.logger.warn(`Cannot switch perspective: room ${roomId} not registered`);
      return false;
    }

    const spectator = state.spectators.get(userId);
    if (!spectator) {
      this.logger.warn(`Cannot switch perspective: spectator ${userId} not in room ${roomId}`);
      return false;
    }

    // 如果不在Showdown阶段，不允许切换视角看手牌
    if (targetPlayerId && !state.isShowdownPhase) {
      this.logger.warn(`Perspective switch rejected: room ${roomId} is not in showdown phase`);
      return false;
    }

    // 验证目标玩家是否在游戏中
    if (targetPlayerId && !state.playerIds.includes(targetPlayerId)) {
      this.logger.warn(`Perspective switch rejected: player ${targetPlayerId} not in room ${roomId}`);
      return false;
    }

    spectator.perspectivePlayerId = targetPlayerId || undefined;

    this.logger.log(
      `Spectator ${userId} switched perspective to ${targetPlayerId || 'default'} in room ${roomId}`,
    );

    return true;
  }

  /**
   * 获取观战者当前视角
   */
  getPerspective(roomId: string, userId: number): string | null {
    const state = this.roomStates.get(roomId);
    if (!state) return null;

    const spectator = state.spectators.get(userId);
    return spectator?.perspectivePlayerId || null;
  }

  // ==================== 观战者聊天隔离 ====================

  /**
   * 发送观战者聊天消息
   * - 消息仅在观战者之间传播
   * - 玩家看不到观战者聊天
   */
  sendSpectatorChat(roomId: string, message: SpectatorChatMessage): void {
    const chatRoom = this.spectatorChatRooms.get(roomId);
    if (!chatRoom || chatRoom.size === 0) {
      return;
    }

    const state = this.roomStates.get(roomId);
    if (state) {
      state.chatHistory.push(message);
      // 限制历史记录长度
      if (state.chatHistory.length > MAX_CHAT_HISTORY) {
        state.chatHistory = state.chatHistory.slice(-MAX_CHAT_HISTORY);
      }
    }

    this.logger.debug(
      `Spectator chat in room ${roomId}: ${message.username}: ${message.message}`,
    );
  }

  /**
   * 获取观战者聊天历史
   */
  getSpectatorChatHistory(roomId: string, limit: number = 50): SpectatorChatMessage[] {
    const state = this.roomStates.get(roomId);
    if (!state) return [];

    return state.chatHistory.slice(-limit);
  }

  /**
   * 检查用户是否可以发送观战聊天
   */
  canSendSpectatorChat(roomId: string, userId: number): boolean {
    const chatRoom = this.spectatorChatRooms.get(roomId);
    return chatRoom ? chatRoom.has(userId) : false;
  }

  /**
   * 获取观战者聊天室成员
   */
  getSpectatorChatMembers(roomId: string): number[] {
    const chatRoom = this.spectatorChatRooms.get(roomId);
    return chatRoom ? Array.from(chatRoom) : [];
  }

  /**
   * 禁言观战者
   */
  muteSpectator(roomId: string, userId: number): void {
    const state = this.roomStates.get(roomId);
    if (!state) return;

    const spectator = state.spectators.get(userId);
    if (spectator) {
      spectator.isChatEnabled = false;
      this.logger.log(`Spectator ${userId} muted in room ${roomId}`);
    }
  }

  /**
   * 解除禁言
   */
  unmuteSpectator(roomId: string, userId: number): void {
    const state = this.roomStates.get(roomId);
    if (!state) return;

    const spectator = state.spectators.get(userId);
    if (spectator) {
      spectator.isChatEnabled = true;
      this.logger.log(`Spectator ${userId} unmuted in room ${roomId}`);
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 生成唯一事件ID
   */
  generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 生成唯一消息ID
   */
  generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 服务销毁时清理
   */
  onModuleDestroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // 清理所有房间状态
    for (const [roomId, state] of this.roomStates) {
      state.ringBuffer.clear();
      state.spectators.clear();
    }
    this.roomStates.clear();
    this.spectatorChatRooms.clear();

    this.logger.log('SpectatorSyncService destroyed');
  }
}
