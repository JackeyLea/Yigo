/**
 * 黑白棋（Reversi/Othello）插件主类
 *
 * 作为棋类平台的插件入口，负责：
 * - 管理游戏引擎实例
 * - 提供插件标准接口（初始化、启动、停止等）
 * - 处理AI对手逻辑
 * - 事件分发
 * - 走棋处理与状态同步
 *
 * 遵循需求文档第6章 - 黑白棋插件设计需求
 */

import type {
  Board,
  Position,
  ReversiState,
  ReversiMove,
  ReversiPluginOptions,
  AIDifficulty,
  ReversiEvent,
  ReversiEventListener,
} from './reversi.types';
import { ReversiEngine } from './reversi.engine';
import { ReversiAI } from './ai/reversi-ai';

/** 默认配置 */
const DEFAULT_OPTIONS: ReversiPluginOptions = {
  enableAI: false,
  aiDifficulty: 'medium',
  aiPlayer: null,
  allowUndo: true,
  showHints: true,
  moveTimeout: 0,
};

export class ReversiPlugin {
  private engine: ReversiEngine;
  private options: ReversiPluginOptions;
  private ai: ReversiAI | null = null;
  private listeners: Set<ReversiEventListener> = new Set();
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private aiThinking = false;
  private initialized = false;
  private running = false;

  /** 插件名称 */
  readonly name = 'reversi';
  /** 插件显示名称 */
  readonly displayName = '黑白棋';
  /** 插件版本 */
  readonly version = '1.0.0';
  /** 支持的游戏模式 */
  readonly gameModes = ['pvp', 'pve'];

  constructor(options?: Partial<ReversiPluginOptions>) {
    this.engine = new ReversiEngine();
    this.options = { ...DEFAULT_OPTIONS, ...options };

    if (this.options.enableAI && this.options.aiPlayer) {
      this.ai = new ReversiAI(this.options.aiDifficulty);
    }
  }

  // ==================== 插件生命周期 ====================

  /** 初始化插件 */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.emit({ type: 'playerChanged', state: this.engine.getState() });
  }

  /** 启动游戏 */
  start(): void {
    if (!this.initialized) {
      this.initialize();
    }
    this.running = true;
    this.checkAITurn();
  }

  /** 停止游戏 */
  stop(): void {
    this.running = false;
    this.clearMoveTimer();
  }

  /** 销毁插件 */
  destroy(): void {
    this.stop();
    this.listeners.clear();
    this.initialized = false;
  }

  /** 重置游戏 */
  reset(): void {
    this.clearMoveTimer();
    this.aiThinking = false;
    this.engine.reset();
    this.emit({ type: 'playerChanged', state: this.engine.getState() });
    this.checkAITurn();
  }

  // ==================== 事件系统 ====================

  /** 注册事件监听器 */
  on(event: ReversiEventListener): void {
    this.listeners.add(event);
  }

  /** 移除事件监听器 */
  off(event: ReversiEventListener): void {
    this.listeners.delete(event);
  }

  /** 触发事件 */
  private emit(event: ReversiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[ReversiPlugin] Event listener error:', e);
      }
    }
  }

  // ==================== 走棋处理 ====================

  /**
   * 玩家落子
   * @param x - 横坐标 (0-7)
   * @param y - 纵坐标 (0-7)
   * @returns 是否落子成功
   */
  makeMove(x: number, y: number): boolean {
    if (!this.running || this.aiThinking) return false;

    const state = this.engine.getState();
    if (state.gameOver) return false;

    // 检查是否是AI的回合
    if (this.isAITurn()) return false;

    const success = this.engine.makeMove(x, y);
    if (!success) return false;

    const newState = this.engine.getState();
    this.emit({
      type: 'move',
      state: newState,
      move: newState.moveHistory[newState.moveHistory.length - 1],
    });

    // 检查游戏是否结束
    if (newState.gameOver) {
      this.emit({ type: 'gameover', state: newState });
      return true;
    }

    // 检查是否需要Pass
    if (newState.legalMoves.length === 0) {
      this.handlePass();
    }

    // 检查是否轮到AI
    this.checkAITurn();
    return true;
  }

  /**
   * Pass（当无合法走法时）
   * @returns 是否Pass成功
   */
  pass(): boolean {
    if (!this.running || this.aiThinking) return false;
    if (this.isAITurn()) return false;

    return this.handlePass();
  }

  /** 内部Pass处理 */
  private handlePass(): boolean {
    const success = this.engine.pass();
    if (!success) return false;

    const newState = this.engine.getState();
    this.emit({
      type: 'pass',
      state: newState,
      move: newState.moveHistory[newState.moveHistory.length - 1],
    });

    if (newState.gameOver) {
      this.emit({ type: 'gameover', state: newState });
      return true;
    }

    // 如果Pass后新玩家也无合法走法，再次Pass
    if (newState.legalMoves.length === 0 && !newState.gameOver) {
      return this.handlePass();
    }

    return true;
  }

  /**
   * 悔棋
   * @returns 是否悔棋成功
   */
  undo(): boolean {
    if (!this.running) return false;
    if (!this.options.allowUndo) return false;
    if (this.aiThinking) return false;
    if (this.engine.getState().moveHistory.length === 0) return false;

    // 如果有AI，需要撤销两步（玩家+AI）
    let undoCount = 1;
    if (this.options.enableAI && this.options.aiPlayer) {
      undoCount = 2;
    }

    let success = false;
    for (let i = 0; i < undoCount; i++) {
      if (this.engine.getState().moveHistory.length === 0) break;
      if (this.engine.undoMove()) {
        success = true;
      }
    }

    if (success) {
      const newState = this.engine.getState();
      this.emit({ type: 'undo', state: newState });
      this.checkAITurn();
    }

    return success;
  }

  // ==================== AI 处理 ====================

  /** 检查是否是AI的回合 */
  private isAITurn(): boolean {
    if (!this.ai || !this.options.enableAI || !this.options.aiPlayer) return false;
    return this.engine.getState().currentPlayer === this.options.aiPlayer;
  }

  /** 检查并触发AI走棋 */
  private checkAITurn(): void {
    if (!this.running) return;
    if (!this.isAITurn()) return;
    if (this.aiThinking) return;

    const state = this.engine.getState();
    if (state.gameOver) return;

    // 如果AI没有合法走法，自动Pass
    if (state.legalMoves.length === 0) {
      this.handlePass();
      return;
    }

    this.aiThinking = true;

    // 使用setTimeout让AI走棋异步执行，不阻塞UI
    setTimeout(() => {
      try {
        if (!this.ai) return;
        const aiMove = this.ai.getMove(this.engine.getState());
        const success = this.engine.makeMove(aiMove.x, aiMove.y);

        if (success) {
          const newState = this.engine.getState();
          this.emit({
            type: 'move',
            state: newState,
            move: newState.moveHistory[newState.moveHistory.length - 1],
          });

          if (newState.gameOver) {
            this.emit({ type: 'gameover', state: newState });
          } else if (newState.legalMoves.length === 0) {
            // AI需要Pass
            this.engine.pass();
            const passState = this.engine.getState();
            this.emit({ type: 'pass', state: passState });

            if (passState.gameOver) {
              this.emit({ type: 'gameover', state: passState });
            } else {
              // 检查是否需要再次AI走棋
              this.aiThinking = false;
              this.checkAITurn();
              return;
            }
          }
        }
      } catch (e) {
        console.error('[ReversiPlugin] AI move error:', e);
      } finally {
        this.aiThinking = false;
      }
    }, 100);
  }

  // ==================== 配置管理 ====================

  /** 获取当前配置 */
  getOptions(): ReversiPluginOptions {
    return { ...this.options };
  }

  /** 更新配置 */
  updateOptions(newOptions: Partial<ReversiPluginOptions>): void {
    const prevAI = this.options.enableAI;
    this.options = { ...this.options, ...newOptions };

    // AI配置变更时重新初始化AI
    if (newOptions.enableAI !== undefined || newOptions.aiDifficulty !== undefined || newOptions.aiPlayer !== undefined) {
      if (this.options.enableAI && this.options.aiPlayer) {
        this.ai = new ReversiAI(this.options.aiDifficulty);
      } else {
        this.ai = null;
      }
    }

    // 如果AI被启用且游戏正在运行，检查是否需要AI走棋
    if (!prevAI && this.options.enableAI && this.running) {
      this.checkAITurn();
    }
  }

  /** 设置AI难度 */
  setAIDifficulty(difficulty: AIDifficulty): void {
    this.updateOptions({ aiDifficulty: difficulty });
  }

  /** 切换AI对手 */
  setAIPlayer(aiPlayer: 1 | 2 | null): void {
    this.updateOptions({
      enableAI: aiPlayer !== null,
      aiPlayer,
    });
  }

  // ==================== 状态查询 ====================

  /** 获取当前游戏状态 */
  getState(): ReversiState {
    return this.engine.getState();
  }

  /** 获取当前棋盘 */
  getBoard(): Board {
    return this.engine.getState().board;
  }

  /** 获取合法走法 */
  getLegalMoves(): Position[] {
    return this.engine.getState().legalMoves;
  }

  /** 检查指定位置是否可落子 */
  isValidMove(x: number, y: number): boolean {
    return this.engine.isValidMove(x, y);
  }

  /** 游戏是否进行中 */
  isRunning(): boolean {
    return this.running;
  }

  /** AI是否正在思考 */
  isAIThinking(): boolean {
    return this.aiThinking;
  }

  /** 获取引擎实例（供高级使用） */
  getEngine(): ReversiEngine {
    return this.engine;
  }
}
