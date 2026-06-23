/**
 * 五子棋插件主类
 *
 * 实现插件接口，整合游戏引擎与AI，对外提供统一的游戏交互能力。
 */

import type {
  GomokuState,
  Position,
  BoardSize,
  AIDifficulty,
  PluginMeta,
} from './gomoku.types';
import { GomokuEngine } from './gomoku.engine';
import { GomokuAI } from './gomoku-ai';
import type { GomokuSettings } from './gomoku.settings';
import { defaultGomokuSettings } from './gomoku.settings';

/** 插件元信息 */
export const GOMOKU_PLUGIN_META: PluginMeta = {
  pluginId: 'gomoku',
  name: '五子棋',
  version: '1.0.0',
  gameType: 'gomoku',
  category: 'board',
  minPlayers: 2,
  maxPlayers: 2,
  entryClass: 'GomokuPlugin',
  supportedModes: ['normal'],
};

/** 玩家动作类型 */
export interface GomokuAction {
  /** 动作类型 */
  type: 'move' | 'undo' | 'resign';
  /** 落子坐标（仅 move 类型需要） */
  position?: Position;
}

/** 游戏模式 */
export type GameMode = 'pvp' | 'pve';

export class GomokuPlugin {
  static readonly meta = GOMOKU_PLUGIN_META;

  private engine: GomokuEngine;
  private ai: GomokuAI | null = null;
  private settings: GomokuSettings;
  private gameMode: GameMode = 'pvp';
  private playerIds: string[] = [];
  private playerColors: Map<string, 1 | 2> = new Map(); // playerId -> 棋子颜色

  constructor() {
    this.settings = { ...defaultGomokuSettings };
    this.engine = new GomokuEngine(this.settings.boardSize, this.settings.useForbidden);
  }

  // ==================== 插件生命周期 ====================

  /**
   * 初始化插件。
   *
   * @param config - 配置对象，可包含 boardSize, useForbidden, aiDifficulty 等
   */
  initialize(config: Record<string, any> = {}): void {
    this.settings = {
      boardSize: (config.boardSize as BoardSize) ?? defaultGomokuSettings.boardSize,
      useForbidden: config.useForbidden ?? defaultGomokuSettings.useForbidden,
      thinkTime: config.thinkTime ?? defaultGomokuSettings.thinkTime,
      aiDifficulty: (config.aiDifficulty as AIDifficulty) ?? defaultGomokuSettings.aiDifficulty,
    };

    this.engine = new GomokuEngine(this.settings.boardSize, this.settings.useForbidden);

    // 如果是人机模式，创建AI
    if (config.gameMode === 'pve') {
      this.gameMode = 'pve';
      this.ai = new GomokuAI(this.settings.aiDifficulty);
    } else {
      this.gameMode = 'pvp';
      this.ai = null;
    }

    this.playerIds = [];
    this.playerColors.clear();
  }

  /**
   * 玩家加入游戏。
   *
   * @param playerId - 玩家唯一标识
   * @returns 分配到的棋子颜色（1=黑, 2=白），null 表示加入失败
   */
  joinGame(playerId: string): 1 | 2 | null {
    if (this.playerIds.length >= 2) return null;
    if (this.playerIds.includes(playerId)) {
      return this.playerColors.get(playerId) ?? null;
    }

    this.playerIds.push(playerId);
    const color = this.playerIds.length === 1 ? 1 : 2;
    this.playerColors.set(playerId, color);
    return color;
  }

  /**
   * 处理玩家动作。
   *
   * @param playerId - 发起动作的玩家
   * @param action - 动作对象
   * @returns 更新后的游戏状态
   */
  handleAction(playerId: string, action: GomokuAction): GomokuState {
    const playerColor = this.playerColors.get(playerId);
    if (!playerColor) {
      throw new Error(`玩家 ${playerId} 未加入游戏`);
    }

    switch (action.type) {
      case 'move': {
        if (!action.position) {
          throw new Error('落子动作需要提供坐标');
        }

        // 检查是否轮到此玩家
        if (this.engine.getCurrentPlayer() !== playerColor) {
          throw new Error('未轮到该玩家走棋');
        }

        const { x, y } = action.position;
        const success = this.engine.makeMove(x, y);
        if (!success) {
          throw new Error(`非法落子: (${x}, ${y})`);
        }

        // 人机模式下，触发AI走棋
        if (this.gameMode === 'pve' && !this.engine.isGameOver()) {
          this.triggerAIMove();
        }

        break;
      }

      case 'undo': {
        // 人机模式下撤销两步（AI和玩家各一步）
        this.engine.undoMove();
        if (this.gameMode === 'pve') {
          this.engine.undoMove();
        }
        break;
      }

      case 'resign': {
        // 认输：对方获胜
        const winner = playerColor === 1 ? 2 : 1;
        // 通过引擎状态更新获胜方
        const state = this.engine.getState();
        // 注：这里需要内部修改状态
        (state as any).winner = winner;
        (state as any).gameOver = true;
        return state;
      }

      default:
        throw new Error(`未知动作类型: ${(action as any).type}`);
    }

    return this.engine.getState();
  }

  /**
   * 获取当前游戏状态。
   */
  getState(): GomokuState {
    return this.engine.getState();
  }

  /**
   * 获取某玩家的合法动作列表。
   *
   * @param playerId - 玩家标识
   * @returns 该玩家当前可执行的所有落子位置
   */
  getLegalActions(playerId: string): Position[] {
    const playerColor = this.playerColors.get(playerId);
    if (!playerColor) return [];

    // 只能在自己的回合行动
    if (this.engine.getCurrentPlayer() !== playerColor) {
      return [];
    }

    return this.engine.getLegalMoves();
  }

  /**
   * 创建AI实例。
   *
   * @param difficulty - AI难度
   * @returns AI实例
   */
  createAI(difficulty: AIDifficulty): GomokuAI {
    this.ai = new GomokuAI(difficulty);
    return this.ai;
  }

  /**
   * 检查游戏是否结束。
   */
  isGameOver(): boolean {
    return this.engine.isGameOver();
  }

  /**
   * 获取获胜方。
   *
   * @returns 1=黑胜, 2=白胜, null=未结束或和棋
   */
  getWinner(): 1 | 2 | null {
    const winner = this.engine.getWinner();
    if (winner === 0) return null; // 和棋
    return winner;
  }

  /**
   * 重置游戏。
   */
  reset(): void {
    this.engine.reset();
  }

  /**
   * 获取当前设置。
   */
  getSettings(): GomokuSettings {
    return { ...this.settings };
  }

  /**
   * 获取插件元信息。
   */
  static getMeta(): PluginMeta {
    return GOMOKU_PLUGIN_META;
  }

  // ==================== 私有方法 ====================

  /**
   * 触发AI走棋。
   */
  private triggerAIMove(): void {
    if (!this.ai || this.engine.isGameOver()) return;

    const state = this.engine.getState();
    const aiMove = this.ai.getMove(state);

    if (aiMove) {
      this.engine.makeMove(aiMove.x, aiMove.y);
    }
  }
}
