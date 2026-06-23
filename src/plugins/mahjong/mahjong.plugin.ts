/**
 * 麻将插件 - 主入口
 * Mahjong Plugin - Main Entry Point
 *
 * 作为游戏平台的麻将插件，提供完整的立直麻将游戏体验。
 * 集成引擎、AI、设置管理于一体。
 */

import {
  MahjongState,
  MahjongPlayer,
  MahjongWinResult,
  MahjongSettings,
  MahjongEngineConfig,
  Tile,
  Meld,
  ResponseType,
  AIDifficulty,
  DEFAULT_SETTINGS,
  GamePhase,
  TileUtils,
} from './mahjong.types';

import { MahjongEngine } from './mahjong.engine';
import { HandEvaluator, WinEvaluation } from './mahjong.hand-evaluator';
import { MahjongAI } from './ai/mahjong-ai';
import { MahjongSettingsManager, PRESET_CONFIGS } from './mahjong.settings';

/** 游戏事件类型 */
export type MahjongEventType =
  | 'game_started'
  | 'tiles_dealt'
  | 'tile_drawn'
  | 'tile_discarded'
  | 'chow_called'
  | 'pong_called'
  | 'kong_called'
  | 'riichi_declared'
  | 'win_declared'
  | 'ron_called'
  | 'exhaustive_draw'
  | 'dora_flipped'
  | 'turn_changed'
  | 'game_ended'
  | 'response_requested'
  | 'phase_changed';

/** 游戏事件 */
export interface MahjongEvent {
  type: MahjongEventType;
  playerId?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

/** 事件监听器 */
export type EventListener = (event: MahjongEvent) => void;

/** 游戏统计 */
export interface MahjongStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  totalScoreChange: number;
  riichiCount: number;
  winByTsumo: number;
  winByRon: number;
  averageFan: number;
  biggestWin: number;
}

export class MahjongPlugin {
  private engine: MahjongEngine;
  private settingsManager: MahjongSettingsManager;
  private aiPlayers: Map<string, MahjongAI> = new Map();
  private eventListeners: EventListener[] = [];
  private stats: Map<string, MahjongStats> = new Map();
  private gameLog: MahjongEvent[] = [];
  private isRunning: boolean = false;

  constructor(settings?: Partial<MahjongSettings>) {
    this.settingsManager = new MahjongSettingsManager(settings);
    const engineConfig = this.settingsManager.getEngineConfig();
    this.engine = new MahjongEngine(engineConfig);

    // 为AI玩家创建AI实例
    this.initializeAIPlayers();
  }

  // ==================== 初始化 ====================

  /** 初始化AI玩家 */
  private initializeAIPlayers(): void {
    const settings = this.settingsManager.getSettings();
    const state = this.engine.getState();

    for (const player of state.players) {
      if (player.isAI) {
        const ai = new MahjongAI(settings.aiDifficulty);
        this.aiPlayers.set(player.playerId, ai);
      }
    }
  }

  // ==================== 核心游戏流程 ====================

  /** 开始新游戏 */
  startGame(): void {
    this.isRunning = true;
    this.engine.reset();
    this.initializeAIPlayers();

    this.emitEvent({
      type: 'game_started',
      timestamp: Date.now(),
    });

    // 洗牌发牌
    this.engine.dealTiles();

    const state = this.engine.getState();

    this.emitEvent({
      type: 'tiles_dealt',
      timestamp: Date.now(),
      data: {
        roundWind: state.roundWind,
        dealer: state.players.find(p => p.isDealer)?.playerId,
      },
    });

    // 如果发牌后直接流局（九种九牌）
    if (state.phase === 'exhaust') {
      this.emitEvent({
        type: 'exhaustive_draw',
        timestamp: Date.now(),
        data: { reason: '九种九牌' },
      });
      this.endGame();
      return;
    }

    // 开始第一个玩家的回合
    this.processTurn();
  }

  /** 处理回合 */
  private processTurn(): void {
    const state = this.engine.getState();

    if (state.gameOver) {
      this.endGame();
      return;
    }

    // 检查流局
    if (state.wall.length === 0) {
      this.engine.checkExhaustiveDraw();
      this.emitEvent({
        type: 'exhaustive_draw',
        timestamp: Date.now(),
      });
      this.endGame();
      return;
    }

    const currentPlayer = state.players[state.currentPlayerIndex];

    this.emitEvent({
      type: 'turn_changed',
      playerId: currentPlayer.playerId,
      timestamp: Date.now(),
      data: {
        seatIndex: currentPlayer.seatIndex,
        isDealer: currentPlayer.isDealer,
      },
    });

    // 摸牌
    try {
      const drawnTile = this.engine.drawTile();
      this.emitEvent({
        type: 'tile_drawn',
        playerId: currentPlayer.playerId,
        timestamp: Date.now(),
        data: {
          tile: drawnTile,
          wallRemaining: state.wall.length - 1,
        },
      });
    } catch (e) {
      // 牌山为空，流局
      this.engine.checkExhaustiveDraw();
      this.emitEvent({
        type: 'exhaustive_draw',
        timestamp: Date.now(),
      });
      this.endGame();
      return;
    }

    // 如果是AI玩家，自动执行
    if (currentPlayer.isAI) {
      this.processAITurn(currentPlayer.playerId);
    }
  }

  /** 处理AI回合 */
  private processAITurn(playerId: string): void {
    const ai = this.aiPlayers.get(playerId);
    if (!ai) return;

    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return;

    // 检查是否可以立直
    if (ai.shouldRiichi(state)) {
      // 找到要打的牌（立直需要打出一张牌）
      const discardTile = ai.getDiscard(state);
      const success = this.engine.declareRiichi(playerId, discardTile.uniqueId);
      if (success) {
        this.emitEvent({
          type: 'riichi_declared',
          playerId,
          timestamp: Date.now(),
          data: { discardTile },
        });

        // 检查其他玩家是否需要响应立直打出的牌
        this.processResponses();
        return;
      }
    }

    // 检查是否可以自摸
    if (this.engine.canWin(player.hand)) {
      const result = this.engine.declareWin(playerId);
      if (result) {
        this.emitEvent({
          type: 'win_declared',
          playerId,
          timestamp: Date.now(),
          data: { result },
        });
        this.updateStats(result);
        this.endGame();
        return;
      }
    }

    // AI 打牌决策
    const discardTile = ai.getDiscard(state);
    this.playerDiscard(playerId, discardTile.uniqueId);
  }

  /** 玩家打牌 */
  playerDiscard(playerId: string, tileId: string): boolean {
    const success = this.engine.discardTile(playerId, tileId);
    if (!success) return false;

    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    const discardedTile = player?.discardPile[player.discardPile.length - 1];

    this.emitEvent({
      type: 'tile_discarded',
      playerId,
      timestamp: Date.now(),
      data: { tile: discardedTile },
    });

    // 检查其他玩家是否可以响应
    this.processResponses();
    return true;
  }

  /** 处理响应阶段 */
  private processResponses(): void {
    const state = this.engine.getState();

    if (!state.lastDiscard) {
      // 没有待响应的牌，直接进入下一家
      this.engine.nextPlayer();
      this.processTurn();
      return;
    }

    const lastDiscard = state.lastDiscard;

    // 收集所有玩家的响应
    const responses: { playerId: string; response: ResponseType | null; priority: number }[] = [];

    for (const player of state.players) {
      // 跳过打牌的玩家自己
      if (player.seatIndex === state.lastDiscardPlayer) continue;

      const availableResponses = this.engine.getAvailableResponses(player.playerId, lastDiscard);

      if (availableResponses.length > 0) {
        this.emitEvent({
          type: 'response_requested',
          playerId: player.playerId,
          timestamp: Date.now(),
          data: {
            availableResponses,
            targetTile: lastDiscard,
          },
        });

        let response: ResponseType | null;

        if (player.isAI) {
          const ai = this.aiPlayers.get(player.playerId);
          response = ai?.getResponse(state, availableResponses) || 'pass';
        } else {
          // 人类玩家需要外部输入，这里先pass
          response = 'pass';
        }

        const priority = this.engine.getResponsePriority(response as ResponseType);
        responses.push({ playerId: player.playerId, response, priority });
      }
    }

    // 按优先级排序
    responses.sort((a, b) => b.priority - a.priority);

    // 执行最高优先级的非pass响应
    for (const resp of responses) {
      if (resp.response === 'pass') continue;

      this.executeResponse(resp.playerId, resp.response as ResponseType);
      return; // 只执行最高优先级的响应
    }

    // 所有人都pass
    this.engine.nextPlayer();
    this.processTurn();
  }

  /** 执行响应 */
  private executeResponse(playerId: string, response: ResponseType): void {
    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return;

    switch (response) {
      case 'ron': {
        const result = this.engine.ron(playerId);
        if (result) {
          this.emitEvent({
            type: 'ron_called',
            playerId,
            timestamp: Date.now(),
            data: { result },
          });
          this.updateStats(result);
          this.endGame();
        }
        break;
      }
      case 'pong': {
        // 找到两张相同的牌
        const targetTile = state.lastDiscard!;
        const sameTiles = player.hand
          .filter(t => TileUtils.equals(t, targetTile))
          .slice(0, 2);
        const tileIds = sameTiles.map(t => t.uniqueId);

        if (tileIds.length === 2) {
          this.engine.pong(playerId, tileIds);
          this.emitEvent({
            type: 'pong_called',
            playerId,
            timestamp: Date.now(),
          });

          // 碰后继续打牌
          if (player.isAI) {
            const ai = this.aiPlayers.get(playerId);
            if (ai) {
              const newState = this.engine.getState();
              const discardTile = ai.getDiscard(newState);
              this.playerDiscard(playerId, discardTile.uniqueId);
            }
          }
        }
        break;
      }
      case 'chow': {
        const targetTile = state.lastDiscard!;
        const rank = typeof targetTile.rank === 'number' ? targetTile.rank : parseInt(targetTile.rank);
        const suit = targetTile.suit;

        // 找到可以组成顺子的两张牌
        let tileIds: string[] = [];
        const possibilities = [
          [rank - 2, rank - 1],
          [rank - 1, rank + 1],
          [rank + 1, rank + 2],
        ];

        for (const [r1, r2] of possibilities) {
          if (r1 >= 1 && r2 <= 9) {
            const t1 = player.hand.find(t => t.suit === suit && t.rank === r1);
            const t2 = player.hand.find(t => t.suit === suit && t.rank === r2);
            if (t1 && t2) {
              tileIds = [t1.uniqueId, t2.uniqueId];
              break;
            }
          }
        }

        if (tileIds.length === 2) {
          this.engine.chow(playerId, tileIds);
          this.emitEvent({
            type: 'chow_called',
            playerId,
            timestamp: Date.now(),
          });

          if (player.isAI) {
            const ai = this.aiPlayers.get(playerId);
            if (ai) {
              const newState = this.engine.getState();
              const discardTile = ai.getDiscard(newState);
              this.playerDiscard(playerId, discardTile.uniqueId);
            }
          }
        }
        break;
      }
      case 'kong': {
        const targetTile = state.lastDiscard!;
        const sameTiles = player.hand
          .filter(t => TileUtils.equals(t, targetTile))
          .slice(0, 3);
        const tileIds = sameTiles.map(t => t.uniqueId);

        if (tileIds.length === 3) {
          this.engine.kong(playerId, tileIds);
          this.emitEvent({
            type: 'kong_called',
            playerId,
            timestamp: Date.now(),
          });

          if (player.isAI) {
            const ai = this.aiPlayers.get(playerId);
            if (ai) {
              const newState = this.engine.getState();
              const discardTile = ai.getDiscard(newState);
              this.playerDiscard(playerId, discardTile.uniqueId);
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // ==================== 玩家交互接口 ====================

  /**
   * 人类玩家执行操作
   */
  playerAction(playerId: string, action: ResponseType, tileIds?: string[]): boolean {
    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player || player.isAI) return false;

    switch (action) {
      case 'ron':
        return this.engine.ron(playerId) !== null;
      case 'pong':
        return tileIds ? this.engine.pong(playerId, tileIds) : false;
      case 'chow':
        return tileIds ? this.engine.chow(playerId, tileIds) : false;
      case 'kong':
        return tileIds ? this.engine.kong(playerId, tileIds) : false;
      case 'pass':
        this.engine.pass(playerId);
        return true;
      default:
        return false;
    }
  }

  /**
   * 人类玩家自摸
   */
  playerTsumo(playerId: string): MahjongWinResult | null {
    return this.engine.declareWin(playerId);
  }

  /**
   * 人类玩家立直
   */
  playerRiichi(playerId: string, discardTileId: string): boolean {
    return this.engine.declareRiichi(playerId, discardTileId);
  }

  // ==================== 查询接口 ====================

  /** 获取当前状态 */
  getState(): MahjongState {
    return this.engine.getState();
  }

  /** 获取当前玩家ID */
  getCurrentPlayerId(): string {
    const state = this.engine.getState();
    return state.players[state.currentPlayerIndex].playerId;
  }

  /** 检查某玩家是否可以胡 */
  canPlayerWin(playerId: string): boolean {
    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return false;
    return this.engine.canWin(player.hand);
  }

  /** 获取某玩家的可用响应 */
  getAvailableResponses(playerId: string): ResponseType[] {
    const state = this.engine.getState();
    if (!state.lastDiscard) return [];
    return this.engine.getAvailableResponses(playerId, state.lastDiscard);
  }

  /** 获取向听数 */
  getShanten(playerId: string): number {
    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return Infinity;
    return this.engine.calculateShanten(player.hand);
  }

  /** 获取待牌 */
  getWaits(playerId: string): Tile[] {
    const state = this.engine.getState();
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return [];
    return this.engine.getWaits(player.hand);
  }

  // ==================== 设置管理 ====================

  /** 获取设置 */
  getSettings(): MahjongSettings {
    return this.settingsManager.getSettings();
  }

  /** 更新设置 */
  updateSettings(settings: Partial<MahjongSettings>): void {
    this.settingsManager.updateSettings(settings);
    // 重新创建引擎
    const engineConfig = this.settingsManager.getEngineConfig();
    this.engine = new MahjongEngine(engineConfig);
  }

  /** 设置AI难度 */
  setAIDifficulty(difficulty: AIDifficulty): void {
    this.settingsManager.setAIDifficulty(difficulty);
    this.initializeAIPlayers();
  }

  /** 加载预设配置 */
  loadPreset(presetName: 'standard' | 'quick' | 'competitive' | 'practice'): void {
    const preset = PRESET_CONFIGS[presetName];
    if (preset) {
      this.settingsManager.updateSettings(preset);
      const engineConfig = this.settingsManager.getEngineConfig();
      this.engine = new MahjongEngine(engineConfig);
      this.initializeAIPlayers();
    }
  }

  // ==================== 事件系统 ====================

  /** 订阅事件 */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== listener);
    };
  }

  private emitEvent(event: MahjongEvent): void {
    this.gameLog.push(event);
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  /** 获取游戏日志 */
  getGameLog(): MahjongEvent[] {
    return [...this.gameLog];
  }

  // ==================== 统计 ====================

  /** 获取统计 */
  getStats(playerId?: string): MahjongStats | Map<string, MahjongStats> {
    if (playerId) {
      return this.stats.get(playerId) || this.createEmptyStats();
    }
    return new Map(this.stats);
  }

  private updateStats(result: MahjongWinResult): void {
    // 更新赢家的统计
    const winnerStats = this.stats.get(result.playerId) || this.createEmptyStats();
    winnerStats.gamesPlayed++;
    winnerStats.wins++;
    winnerStats.totalScoreChange += result.score;
    if (result.isTsumo) winnerStats.winByTsumo++;
    else winnerStats.winByRon++;
    winnerStats.averageFan = (winnerStats.averageFan * (winnerStats.wins - 1) + result.fan) / winnerStats.wins;
    winnerStats.biggestWin = Math.max(winnerStats.biggestWin, result.score);
    this.stats.set(result.playerId, winnerStats);

    // 更新其他玩家的统计
    const state = this.engine.getState();
    for (const player of state.players) {
      if (player.playerId === result.playerId) continue;
      const stats = this.stats.get(player.playerId) || this.createEmptyStats();
      stats.gamesPlayed++;
      stats.losses++;
      // 荣胡时放铳者扣分更多
      if (!result.isTsumo && state.lastDiscardPlayer === player.seatIndex) {
        stats.totalScoreChange -= result.score;
      } else if (result.isTsumo) {
        stats.totalScoreChange -= Math.floor(result.score / 3);
      }
      this.stats.set(player.playerId, stats);
    }
  }

  private createEmptyStats(): MahjongStats {
    return {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      totalScoreChange: 0,
      riichiCount: 0,
      winByTsumo: 0,
      winByRon: 0,
      averageFan: 0,
      biggestWin: 0,
    };
  }

  // ==================== 游戏生命周期 ====================

  /** 结束游戏 */
  private endGame(): void {
    this.isRunning = false;
    this.emitEvent({
      type: 'game_ended',
      timestamp: Date.now(),
      data: {
        finalState: this.engine.getState(),
      },
    });
  }

  /** 游戏是否进行中 */
  isGameRunning(): boolean {
    return this.isRunning;
  }

  /** 重置所有统计 */
  resetStats(): void {
    this.stats.clear();
  }

  // ==================== 工具方法 ====================

  /** 获取牌面字符串 */
  static tileToString(tile: Tile): string {
    return TileUtils.toString(tile);
  }

  /** 排序手牌 */
  static sortHand(hand: Tile[]): Tile[] {
    return TileUtils.sortHand(hand);
  }

  /** 创建标准牌组 */
  static createStandardDeck(): Tile[] {
    return TileUtils.createStandardDeck();
  }

  /** 评估和牌 */
  static evaluateHand(hand: Tile[], winTile: Tile, context: import('./mahjong.types').YakuContext): WinEvaluation {
    return HandEvaluator.evaluateWinningHand(hand, winTile, context);
  }

  /** 检查是否可以胡 */
  static canWin(hand: Tile[], tile?: Tile): boolean {
    return HandEvaluator.canWin(hand, tile);
  }
}

// 导出所有子模块
export { MahjongEngine, HandEvaluator, MahjongAI, MahjongSettingsManager };
export * from './mahjong.types';
export * from './mahjong.hand-evaluator';
export * from './mahjong.settings';
export * from './ai/mahjong-ai';
