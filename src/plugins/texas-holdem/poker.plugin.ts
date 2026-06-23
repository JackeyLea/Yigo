/**
 * 德州扑克插件主类
 * Texas Hold'em Poker Plugin
 *
 * 将游戏引擎封装为可插拔的游戏插件
 */

import {
  PokerState, PokerPlayer, PlayerAction, PokerPhase,
  PokerAction, ShowdownResult, SidePot, PokerPluginConfig,
  DEFAULT_POKER_CONFIG, Card, HandRanking, AIDifficulty,
} from './poker.types';
import { PokerEngine } from './poker.engine';
import { HandEvaluator } from './poker.hand-evaluator';
import { PokerAI } from './ai/poker-ai';

/** 游戏事件类型 */
export type PokerEventType =
  | 'playerJoined'
  | 'playerLeft'
  | 'handStarted'
  | 'phaseChanged'
  | 'playerAction'
  | 'cardsDealt'
  | 'showdown'
  | 'handEnded'
  | 'gameOver'
  | 'turnStarted'
  | 'turnTimeout';

/** 游戏事件 */
export interface PokerEvent {
  type: PokerEventType;
  data: Record<string, unknown>;
  timestamp: number;
}

/** 事件监听器 */
export type PokerEventListener = (event: PokerEvent) => void;

/** 游戏统计 */
export interface PlayerStats {
  playerId: string;
  handsPlayed: number;
  handsWon: number;
  totalWinnings: number;
  totalLosses: number;
  biggestPot: number;
  foldCount: number;
  callCount: number;
  raiseCount: number;
  allInCount: number;
}

export class PokerPlugin {
  private engine: PokerEngine;
  private config: PokerPluginConfig;
  private aiPlayers: Map<string, PokerAI> = new Map();
  private eventListeners: Map<PokerEventType, Set<PokerEventListener>> = new Map();
  private playerStats: Map<string, PlayerStats> = new Map();
  private handCount: number = 0;
  private isRunning: boolean = false;

  constructor(config?: Partial<PokerPluginConfig>) {
    this.config = { ...DEFAULT_POKER_CONFIG, ...config };
    this.engine = new PokerEngine(
      this.config.smallBlind,
      this.config.bigBlind,
      this.config.maxPlayers
    );
    this.initEventListeners();
  }

  // ==================== 游戏生命周期 ====================

  /** 获取当前游戏状态 */
  getState(): PokerState {
    return this.engine.getState();
  }

  /** 获取配置 */
  getConfig(): PokerPluginConfig {
    return { ...this.config };
  }

  /** 更新配置 */
  updateConfig(config: Partial<PokerPluginConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 添加玩家 */
  addPlayer(playerId: string, buyIn: number, seatIndex?: number): boolean {
    const success = this.engine.addPlayer(playerId, buyIn, seatIndex);
    if (success) {
      this.initPlayerStats(playerId);
      this.emit('playerJoined', {
        playerId,
        buyIn,
        seatIndex: seatIndex ?? this.findAvailableSeat(),
      });
    }
    return success;
  }

  /** 移除玩家 */
  removePlayer(playerId: string): void {
    this.engine.removePlayer(playerId);
    this.aiPlayers.delete(playerId);
    this.emit('playerLeft', { playerId });
  }

  /** 添加AI玩家 */
  addAIPlayer(difficulty: AIDifficulty = 'medium', buyIn?: number, seatIndex?: number): string {
    const aiId = `ai_${difficulty}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const actualBuyIn = buyIn ?? this.config.buyInMin;
    const success = this.engine.addPlayer(aiId, actualBuyIn, seatIndex);
    if (success) {
      this.aiPlayers.set(aiId, new PokerAI(difficulty));
      this.initPlayerStats(aiId);
      this.emit('playerJoined', {
        playerId: aiId,
        buyIn: actualBuyIn,
        seatIndex: seatIndex ?? this.findAvailableSeat(),
        isAI: true,
        difficulty,
      });
    }
    return aiId;
  }

  /** 开始新一局 */
  startNewHand(): boolean {
    const state = this.engine.getState();
    const activePlayers = state.players.filter(p => p.chips > 0);
    if (activePlayers.length < this.config.minPlayers) {
      return false;
    }

    this.handCount++;
    this.isRunning = true;
    this.engine.startNewHand();

    const newState = this.engine.getState();
    this.emit('handStarted', {
      handNumber: this.handCount,
      dealerSeat: newState.players.find(p => p.isDealer)?.seatIndex,
      smallBlindSeat: newState.players.find(p => p.isSmallBlind)?.seatIndex,
      bigBlindSeat: newState.players.find(p => p.isBigBlind)?.seatIndex,
    });

    // 为AI玩家自动执行行动
    this.processAITurns();

    return true;
  }

  /** 处理玩家动作 */
  handleAction(playerId: string, action: PlayerAction, amount?: number): boolean {
    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return false;

    const success = this.engine.handleAction(playerId, action, amount);
    if (success) {
      this.recordAction(playerId, action, amount);
      this.emit('playerAction', {
        playerId,
        action,
        amount,
        phase: this.engine.getState().phase,
      });

      // 阶段变化事件
      const newState = this.engine.getState();
      if (newState.phase !== state.phase) {
        this.emit('phaseChanged', {
          from: state.phase,
          to: newState.phase,
          communityCards: newState.communityCards,
        });
      }

      // 摊牌事件
      if (newState.phase === 'showdown' || newState.phase === 'ended') {
        this.emit('showdown', {
          results: newState.showdownResults,
          communityCards: newState.communityCards,
        });
        this.isRunning = false;
        this.emit('handEnded', {
          handNumber: this.handCount,
          results: newState.showdownResults,
        });
      }

      // 处理AI回合
      if (this.isRunning && newState.phase !== 'ended') {
        this.processAITurns();
      }
    }

    return success;
  }

  /** 检查动作是否合法 */
  isValidAction(playerId: string, action: PlayerAction, amount?: number): boolean {
    return this.engine.isValidAction(playerId, action, amount);
  }

  /** 获取当前玩家可选动作 */
  getValidActions(playerId: string): PlayerAction[] {
    return this.engine.getValidActions(playerId);
  }

  /** 获取当前应行动的玩家 */
  getCurrentPlayer(): PokerPlayer | undefined {
    const state = this.engine.getState();
    return state.players[state.currentPlayerIndex];
  }

  /** 计算最小加注额 */
  calculateMinRaise(): number {
    return this.engine.calculateMinRaise();
  }

  // ==================== 牌型评估 ====================

  /** 评估手牌（仅展示用，实际游戏中不应暴露他人底牌） */
  evaluateHand(playerId: string): HandRanking | null {
    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player || player.holeCards.length === 0) return null;
    return HandEvaluator.evaluateBestHand(player.holeCards, state.communityCards);
  }

  /** 比较两手牌 */
  compareHands(handA: HandRanking, handB: HandRanking): number {
    return HandEvaluator.compareHands(handA, handB);
  }

  // ==================== 事件系统 ====================

  /** 订阅事件 */
  on(eventType: PokerEventType, listener: PokerEventListener): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);
    // 返回取消订阅函数
    return () => {
      this.eventListeners.get(eventType)?.delete(listener);
    };
  }

  /** 订阅所有事件 */
  onAny(listener: PokerEventListener): () => void {
    const unsubscribers: (() => void)[] = [];
    const allTypes: PokerEventType[] = [
      'playerJoined', 'playerLeft', 'handStarted', 'phaseChanged',
      'playerAction', 'cardsDealt', 'showdown', 'handEnded',
      'gameOver', 'turnStarted', 'turnTimeout',
    ];
    for (const type of allTypes) {
      unsubscribers.push(this.on(type, listener));
    }
    return () => unsubscribers.forEach(fn => fn());
  }

  /** 触发事件 */
  private emit(type: PokerEventType, data: Record<string, unknown>): void {
    const event: PokerEvent = { type, data, timestamp: Date.now() };
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (e) {
          console.error(`Error in poker event listener for ${type}:`, e);
        }
      }
    }
  }

  // ==================== 统计信息 ====================

  /** 获取玩家统计 */
  getPlayerStats(playerId: string): PlayerStats | undefined {
    return this.playerStats.get(playerId);
  }

  /** 获取所有玩家统计 */
  getAllStats(): PlayerStats[] {
    return Array.from(this.playerStats.values());
  }

  /** 获取已进行的手牌数 */
  getHandCount(): number {
    return this.handCount;
  }

  /** 重置统计 */
  resetStats(): void {
    this.playerStats.clear();
    for (const player of this.engine.getState().players) {
      this.initPlayerStats(player.playerId);
    }
  }

  // ==================== 工具方法 ====================

  /** 检查游戏是否进行中 */
  isGameRunning(): boolean {
    return this.isRunning;
  }

  /** 获取AI玩家列表 */
  getAIPlayers(): string[] {
    return Array.from(this.aiPlayers.keys());
  }

  /** 移除AI玩家 */
  removeAIPlayer(aiId: string): void {
    this.aiPlayers.delete(aiId);
    this.removePlayer(aiId);
  }

  /** 清除所有AI玩家 */
  clearAIPlayers(): void {
    for (const aiId of this.aiPlayers.keys()) {
      this.removePlayer(aiId);
    }
    this.aiPlayers.clear();
  }

  /** 重置整个游戏 */
  reset(): void {
    this.engine.reset();
    this.aiPlayers.clear();
    this.playerStats.clear();
    this.handCount = 0;
    this.isRunning = false;
    this.emit('gameOver', {});
  }

  /** 序列化游戏状态 */
  serialize(): string {
    return JSON.stringify({
      state: this.engine.getState(),
      config: this.config,
      handCount: this.handCount,
      isRunning: this.isRunning,
      stats: Array.from(this.playerStats.entries()),
    });
  }

  /** 反序列化游戏状态（仅恢复统计和配置，不恢复牌局状态） */
  deserialize(data: string): void {
    const parsed = JSON.parse(data);
    if (parsed.config) this.config = { ...DEFAULT_POKER_CONFIG, ...parsed.config };
    if (parsed.handCount) this.handCount = parsed.handCount;
    if (parsed.isRunning !== undefined) this.isRunning = parsed.isRunning;
    if (parsed.stats) {
      this.playerStats = new Map(parsed.stats);
    }
  }

  // ==================== 私有方法 ====================

  private initEventListeners(): void {
    // 初始化所有事件类型的监听器集合
    const allTypes: PokerEventType[] = [
      'playerJoined', 'playerLeft', 'handStarted', 'phaseChanged',
      'playerAction', 'cardsDealt', 'showdown', 'handEnded',
      'gameOver', 'turnStarted', 'turnTimeout',
    ];
    for (const type of allTypes) {
      this.eventListeners.set(type, new Set());
    }
  }

  private initPlayerStats(playerId: string): void {
    if (!this.playerStats.has(playerId)) {
      this.playerStats.set(playerId, {
        playerId,
        handsPlayed: 0,
        handsWon: 0,
        totalWinnings: 0,
        totalLosses: 0,
        biggestPot: 0,
        foldCount: 0,
        callCount: 0,
        raiseCount: 0,
        allInCount: 0,
      });
    }
  }

  private recordAction(playerId: string, action: PlayerAction, amount?: number): void {
    const stats = this.playerStats.get(playerId);
    if (!stats) return;

    stats.handsPlayed = this.handCount;

    switch (action) {
      case 'fold':
        stats.foldCount++;
        break;
      case 'call':
        stats.callCount++;
        stats.totalLosses += amount ?? 0;
        break;
      case 'bet':
      case 'raise':
        stats.raiseCount++;
        stats.totalLosses += amount ?? 0;
        break;
      case 'allin':
        stats.allInCount++;
        stats.totalLosses += amount ?? 0;
        break;
    }

    // 记录赢牌
    const state = this.engine.getState();
    if (state.showdownResults) {
      const result = state.showdownResults.find(r => r.playerId === playerId);
      if (result && result.wonAmount > 0) {
        stats.handsWon++;
        stats.totalWinnings += result.wonAmount;
        if (result.wonAmount > stats.biggestPot) {
          stats.biggestPot = result.wonAmount;
        }
      }
    }
  }

  private processAITurns(): void {
    // 使用setTimeout避免阻塞，最多处理10个AI回合防止死循环
    let safetyCounter = 0;
    const processNext = () => {
      if (safetyCounter++ > 30) return; // 安全检查

      const state = this.engine.getState();
      if (state.phase === 'ended' || state.phase === 'showdown' || state.gameOver) {
        return;
      }

      const currentPlayer = state.players[state.currentPlayerIndex];
      if (!currentPlayer) return;

      const ai = this.aiPlayers.get(currentPlayer.playerId);
      if (!ai) return; // 当前不是AI的回合

      const decision = ai.getAction(state, currentPlayer.playerId);
      const success = this.handleAction(currentPlayer.playerId, decision.action, decision.amount);

      if (!success) {
        // AI决策失败，尝试fold
        this.handleAction(currentPlayer.playerId, 'fold');
      }

      // 如果还是AI的回合，继续处理
      const newState = this.engine.getState();
      const newCurrentPlayer = newState.players[newState.currentPlayerIndex];
      if (newCurrentPlayer && this.aiPlayers.has(newCurrentPlayer.playerId)) {
        processNext();
      }
    };

    processNext();
  }

  private findAvailableSeat(): number {
    const state = this.engine.getState();
    const usedSeats = new Set(state.players.map(p => p.seatIndex));
    for (let i = 0; i < this.config.maxPlayers; i++) {
      if (!usedSeats.has(i)) return i;
    }
    return -1;
  }
}

// 导出所有类型和类
export * from './poker.types';
export { PokerEngine } from './poker.engine';
export { HandEvaluator } from './poker.hand-evaluator';
export { PokerAI } from './ai/poker-ai';
