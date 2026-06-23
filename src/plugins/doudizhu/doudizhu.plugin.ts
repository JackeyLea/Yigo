/**
 * 斗地主插件主类
 * 实现游戏生命周期管理、玩家管理、AI控制、事件分发
 */

import {
  type Card,
  type CardCombo,
  type DoudizhuState,
  type DoudizhuPlayer,
  type DoudizhuEvent,
  type DoudizhuConfig,
  type ActionResult,
  type Difficulty,
  type WinnerSide,
  type GamePhase,
  DEFAULT_DOUDIZHU_CONFIG,
} from './doudizhu.types';

import { DoudizhuEngine, RANK_VALUE } from './doudizhu.engine';
import { DoudizhuAI } from './ai/doudizhu-ai';
import { mergeConfig } from './doudizhu.settings';

// ==================== 插件事件 ====================

/** 插件级别的事件 */
export interface PluginEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

/** 游戏房间状态 */
export interface RoomState {
  roomId: string;
  players: RoomPlayer[];
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'finished';
  engine: DoudizhuEngine | null;
  config: DoudizhuConfig;
  createdAt: number;
}

/** 房间玩家 */
export interface RoomPlayer {
  playerId: string;
  name: string;
  isReady: boolean;
  isAI: boolean;
  seatIndex: number;
  joinedAt: number;
}

/** 插件配置选项 */
export interface PluginOptions {
  roomId?: string;
  config?: Partial<DoudizhuConfig>;
  onEvent?: (event: PluginEvent) => void;
  onStateChange?: (state: DoudizhuState) => void;
  onGameOver?: (winner: WinnerSide, scores: Record<string, number>) => void;
}

// ==================== 斗地主插件主类 ====================

export class DoudizhuPlugin {
  readonly name = 'doudizhu';
  readonly version = '1.0.0';
  readonly displayName = '斗地主';
  readonly description = '经典三人斗地主游戏，支持AI对战';
  readonly minPlayers = 3;
  readonly maxPlayers = 3;

  private engine: DoudizhuEngine | null = null;
  private aiPlayers: Map<string, DoudizhuAI> = new Map();
  private config: DoudizhuConfig;
  private options: PluginOptions;

  // 房间状态
  private room: RoomState;
  private eventListeners: Array<(event: PluginEvent) => void> = [];
  private gameHistory: DoudizhuState[] = [];

  // 游戏事件回调
  private onEvent?: (event: PluginEvent) => void;
  private onStateChange?: (state: DoudizhuState) => void;
  private onGameOver?: (winner: WinnerSide, scores: Record<string, number>) => void;

  constructor(options: PluginOptions = {}) {
    this.options = options;
    this.config = mergeConfig(options.config);
    this.onEvent = options.onEvent;
    this.onStateChange = options.onStateChange;
    this.onGameOver = options.onGameOver;

    this.room = {
      roomId: options.roomId ?? this.generateRoomId(),
      players: [],
      maxPlayers: 3,
      status: 'waiting',
      engine: null,
      config: this.config,
      createdAt: Date.now(),
    };
  }

  // ==================== 生命周期方法 ====================

  /** 初始化插件 */
  async init(): Promise<boolean> {
    this.emitPluginEvent('plugin_initialized', { roomId: this.room.roomId });
    return true;
  }

  /** 销毁插件 */
  destroy(): void {
    this.engine = null;
    this.aiPlayers.clear();
    this.eventListeners = [];
    this.gameHistory = [];
    this.emitPluginEvent('plugin_destroyed', { roomId: this.room.roomId });
  }

  /** 重置插件状态 */
  reset(): void {
    this.engine?.reset();
    this.aiPlayers.forEach((ai) => ai.clearMemory());
    this.gameHistory = [];
    this.room.status = 'waiting';
    this.emitPluginEvent('plugin_reset', { roomId: this.room.roomId });
  }

  // ==================== 房间管理 ====================

  /** 获取房间ID */
  getRoomId(): string {
    return this.room.roomId;
  }

  /** 获取房间状态 */
  getRoomState(): RoomState {
    return { ...this.room, engine: this.engine };
  }

  /** 加入房间 */
  joinRoom(playerId: string, name: string, isAI = false): ActionResult {
    if (this.room.players.length >= this.maxPlayers) {
      return { success: false, message: '房间已满' };
    }

    if (this.room.players.some((p) => p.playerId === playerId)) {
      return { success: false, message: '玩家已在房间中' };
    }

    const seatIndex = this.room.players.length;
    this.room.players.push({
      playerId,
      name,
      isReady: isAI, // AI自动准备
      isAI,
      seatIndex,
      joinedAt: Date.now(),
    });

    // 如果是AI玩家，创建AI实例
    if (isAI) {
      const ai = new DoudizhuAI(this.config.aiDifficulty);
      this.aiPlayers.set(playerId, ai);
    }

    this.emitPluginEvent('player_joined', { playerId, name, isAI, seatIndex });

    // 如果满员且都准备好了，自动开始
    if (this.room.players.length === this.maxPlayers && this.areAllPlayersReady()) {
      this.startGame();
    }

    return { success: true };
  }

  /** 离开房间 */
  leaveRoom(playerId: string): ActionResult {
    const idx = this.room.players.findIndex((p) => p.playerId === playerId);
    if (idx === -1) {
      return { success: false, message: '玩家不在房间中' };
    }

    this.room.players.splice(idx, 1);
    this.aiPlayers.delete(playerId);

    // 如果游戏进行中，标记游戏结束
    if (this.room.status === 'playing') {
      this.room.status = 'finished';
    }

    this.emitPluginEvent('player_left', { playerId });
    return { success: true };
  }

  /** 玩家准备 */
  playerReady(playerId: string): ActionResult {
    const player = this.room.players.find((p) => p.playerId === playerId);
    if (!player) {
      return { success: false, message: '玩家不在房间中' };
    }

    player.isReady = true;
    this.emitPluginEvent('player_ready', { playerId });

    // 检查是否所有人就绪
    if (this.areAllPlayersReady() && this.room.players.length === this.maxPlayers) {
      this.startGame();
    }

    return { success: true };
  }

  /** 添加AI玩家 */
  addAIPlayer(difficulty?: Difficulty): string {
    const aiId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const diff = difficulty ?? this.config.aiDifficulty;
    const aiName = `电脑${this.room.players.filter((p) => p.isAI).length + 1}`;

    this.joinRoom(aiId, aiName, true);

    // 设置AI难度
    const ai = this.aiPlayers.get(aiId);
    if (ai) {
      ai.setDifficulty(diff);
    }

    return aiId;
  }

  /** 移除AI玩家 */
  removeAIPlayer(): ActionResult {
    const aiPlayer = this.room.players.find((p) => p.isAI);
    if (!aiPlayer) {
      return { success: false, message: '没有AI玩家可移除' };
    }
    return this.leaveRoom(aiPlayer.playerId);
  }

  /** 检查是否所有玩家已准备 */
  areAllPlayersReady(): boolean {
    return this.room.players.length > 0 && this.room.players.every((p) => p.isReady);
  }

  /** 获取玩家列表 */
  getPlayers(): RoomPlayer[] {
    return [...this.room.players];
  }

  // ==================== 游戏控制 ====================

  /** 开始游戏 */
  startGame(): ActionResult {
    if (this.room.players.length !== this.maxPlayers) {
      return { success: false, message: `需要${this.maxPlayers}名玩家才能开始` };
    }

    if (!this.areAllPlayersReady()) {
      return { success: false, message: '还有玩家未准备' };
    }

    const playerIds = this.room.players.map((p) => p.playerId);
    this.engine = new DoudizhuEngine(playerIds);

    // 绑定引擎事件
    this.engine.addEventListener((event) => {
      this.handleEngineEvent(event as DoudizhuEvent);
    });

    this.room.status = 'playing';
    this.room.engine = this.engine;

    // 发牌
    this.engine.dealCards();

    this.emitPluginEvent('game_started', {
      roomId: this.room.roomId,
      players: playerIds,
    });

    // 触发AI叫分
    this.processAITurn();

    return { success: true };
  }

  /** 叫分 */
  placeBid(playerId: string, bid: number | null): ActionResult {
    if (!this.engine) {
      return { success: false, message: '游戏尚未开始' };
    }

    const success = this.engine.placeBid(playerId, bid);
    if (!success) {
      return { success: false, message: '叫分失败' };
    }

    this.saveStateSnapshot();
    this.notifyStateChange();

    // 触发AI回合
    setTimeout(() => this.processAITurn(), 100);

    return { success: true };
  }

  /** 出牌 */
  playCards(playerId: string, cards: Card[]): ActionResult {
    if (!this.engine) {
      return { success: false, message: '游戏尚未开始' };
    }

    const success = this.engine.playCards(playerId, cards);
    if (!success) {
      return { success: false, message: '出牌失败' };
    }

    this.saveStateSnapshot();
    this.notifyStateChange();

    // 检查游戏结束
    if (this.engine.isGameOver()) {
      this.handleGameOver();
      return { success: true };
    }

    // 触发AI回合
    setTimeout(() => this.processAITurn(), 300);

    return { success: true };
  }

  /** 不出（Pass） */
  pass(playerId: string): ActionResult {
    if (!this.engine) {
      return { success: false, message: '游戏尚未开始' };
    }

    const success = this.engine.pass(playerId);
    if (!success) {
      return { success: false, message: 'Pass失败' };
    }

    this.saveStateSnapshot();
    this.notifyStateChange();

    // 触发AI回合
    setTimeout(() => this.processAITurn(), 300);

    return { success: true };
  }

  /** 获取当前游戏状态 */
  getGameState(): DoudizhuState | null {
    return this.engine?.getState() ?? null;
  }

  /** 获取当前应该操作的玩家ID */
  getCurrentPlayerId(): string | null {
    return this.engine?.getCurrentPlayerId() ?? null;
  }

  /** 获取当前阶段 */
  getPhase(): GamePhase | null {
    return this.engine?.getPhase() ?? null;
  }

  /** 获取某玩家的合法出牌 */
  getLegalPlays(playerId: string): CardCombo[] {
    if (!this.engine) return [];
    return this.engine.getLegalPlays(playerId);
  }

  /** 识别牌型 */
  identifyCombo(cards: Card[]): CardCombo | null {
    if (!this.engine) return null;
    return this.engine.identifyCombo(cards);
  }

  /** 比较牌型 */
  canBeat(comboA: CardCombo, comboB: CardCombo): boolean {
    if (!this.engine) return false;
    return this.engine.canBeat(comboA, comboB);
  }

  // ==================== AI控制 ====================

  /** 处理AI回合 */
  private processAITurn(): void {
    if (!this.engine || this.engine.isGameOver()) return;

    const currentPlayerId = this.engine.getCurrentPlayerId();
    const ai = this.aiPlayers.get(currentPlayerId);
    if (!ai) return; // 不是AI的回合

    const state = this.engine.getState();

    switch (state.phase) {
      case 'bid': {
        // AI叫分
        const bid = ai.getBid(state, currentPlayerId);
        this.placeBid(currentPlayerId, bid);
        break;
      }
      case 'play': {
        // AI出牌
        const cards = ai.getPlay(state, currentPlayerId);
        if (cards && cards.length > 0) {
          this.playCards(currentPlayerId, cards);
        } else {
          this.pass(currentPlayerId);
        }
        break;
      }
    }
  }

  /** 设置AI难度 */
  setAIDifficulty(playerId: string, difficulty: Difficulty): ActionResult {
    const ai = this.aiPlayers.get(playerId);
    if (!ai) {
      return { success: false, message: '指定玩家不是AI' };
    }
    ai.setDifficulty(difficulty);
    return { success: true };
  }

  // ==================== 配置管理 ====================

  /** 更新配置 */
  updateConfig(newConfig: Partial<DoudizhuConfig>): ActionResult {
    this.config = mergeConfig({ ...this.config, ...newConfig });
    this.room.config = this.config;
    this.emitPluginEvent('config_updated', { config: this.config });
    return { success: true };
  }

  /** 获取当前配置 */
  getConfig(): DoudizhuConfig {
    return { ...this.config };
  }

  // ==================== 事件系统 ====================

  /** 添加事件监听器 */
  addEventListener(listener: (event: PluginEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /** 移除事件监听器 */
  removeEventListener(listener: (event: PluginEvent) => void): void {
    this.eventListeners = this.eventListeners.filter((l) => l !== listener);
  }

  /** 处理引擎事件 */
  private handleEngineEvent(event: DoudizhuEvent): void {
    switch (event.type) {
      case 'bid':
        this.emitPluginEvent('bid', {
          playerId: event.playerId,
          bid: event.bid,
        });
        break;
      case 'landlord_confirm':
        this.emitPluginEvent('landlord_confirm', {
          landlordId: event.landlordId,
          bottomCards: event.bottomCards,
        });
        break;
      case 'play':
        this.emitPluginEvent('play', {
          playerId: event.playerId,
          combo: event.combo,
          remainingCards: event.remainingCards,
        });
        break;
      case 'pass':
        this.emitPluginEvent('pass', { playerId: event.playerId });
        break;
      case 'game_over':
        this.emitPluginEvent('game_over', {
          winner: event.winner,
          multiplier: event.multiplier,
          isSpring: event.isSpring,
          scores: event.scores,
        });
        break;
    }
  }

  /** 发送插件事件 */
  private emitPluginEvent(type: string, data: unknown): void {
    const event: PluginEvent = { type, timestamp: Date.now(), data };

    // 调用选项回调
    this.onEvent?.(event);

    // 通知监听器
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    }
  }

  // ==================== 游戏结束处理 ====================

  private handleGameOver(): void {
    if (!this.engine) return;

    const state = this.engine.getState();
    this.room.status = 'finished';

    const scores = this.calculateScores();

    this.emitPluginEvent('game_over', {
      winner: state.winner,
      multiplier: state.multiplier,
      isSpring: state.isSpring,
      scores,
    });

    this.onGameOver?.(state.winner, scores);
  }

  private calculateScores(): Record<string, number> {
    if (!this.engine) return {};
    const state = this.engine.getState();
    const scores: Record<string, number> = {};
    const baseScore = this.config.baseScore * state.multiplier;

    if (state.winner === 'landlord') {
      for (const player of state.players) {
        scores[player.playerId] = player.isLandlord ? baseScore * 2 : -baseScore;
      }
    } else if (state.winner === 'peasant') {
      for (const player of state.players) {
        scores[player.playerId] = player.isLandlord ? -baseScore * 2 : baseScore;
      }
    }

    return scores;
  }

  // ==================== 状态快照 ====================

  /** 保存状态快照 */
  private saveStateSnapshot(): void {
    const state = this.engine?.getState();
    if (state) {
      this.gameHistory.push(JSON.parse(JSON.stringify(state)) as DoudizhuState);
    }
  }

  /** 通知状态变更 */
  private notifyStateChange(): void {
    const state = this.engine?.getState();
    if (state) {
      this.onStateChange?.(state);
    }
  }

  /** 获取游戏历史 */
  getGameHistory(): DoudizhuState[] {
    return [...this.gameHistory];
  }

  // ==================== 工具方法 ====================

  /** 生成房间ID */
  private generateRoomId(): string {
    return `ddz_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /** 检查是否是AI玩家 */
  isAIPlayer(playerId: string): boolean {
    return this.aiPlayers.has(playerId);
  }

  /** 获取玩家信息 */
  getPlayerInfo(playerId: string): RoomPlayer | undefined {
    return this.room.players.find((p) => p.playerId === playerId);
  }

  /** 获取当前操作玩家的信息 */
  getCurrentPlayerInfo(): RoomPlayer | undefined {
    const currentId = this.getCurrentPlayerId();
    if (!currentId) return undefined;
    return this.getPlayerInfo(currentId);
  }

  /** 判断游戏是否进行中 */
  isPlaying(): boolean {
    return this.room.status === 'playing';
  }

  /** 判断游戏是否已结束 */
  isGameOver(): boolean {
    return this.engine?.isGameOver() ?? false;
  }

  /** 获取游戏结果 */
  getGameResult(): {
    winner: WinnerSide;
    scores: Record<string, number>;
    multiplier: number;
    isSpring: boolean;
  } | null {
    if (!this.engine || !this.engine.isGameOver()) return null;
    const state = this.engine.getState();
    return {
      winner: state.winner,
      scores: this.calculateScores(),
      multiplier: state.multiplier,
      isSpring: state.isSpring,
    };
  }

  /** 导出游戏记录 */
  exportGameRecord(): string {
    const record = {
      roomId: this.room.roomId,
      config: this.config,
      history: this.gameHistory.map((s, i) => ({
        step: i,
        phase: s.phase,
        currentPlayer: s.currentPlayerId,
        lastPlayed: s.lastPlayedCombo?.type ?? null,
        landlord: s.landlordId,
        multiplier: s.multiplier,
      })),
      result: this.getGameResult(),
      timestamp: Date.now(),
    };
    return JSON.stringify(record, null, 2);
  }

  /** 获取调试信息 */
  getDebugInfo(): Record<string, unknown> {
    return {
      pluginName: this.name,
      version: this.version,
      roomId: this.room.roomId,
      roomStatus: this.room.status,
      playerCount: this.room.players.length,
      aiCount: this.aiPlayers.size,
      engineInitialized: this.engine !== null,
      config: this.config,
      historyLength: this.gameHistory.length,
    };
  }
}

export default DoudizhuPlugin;
