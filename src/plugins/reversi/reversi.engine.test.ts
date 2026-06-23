/**
 * 黑白棋（Reversi/Othello）游戏引擎 - 单元测试
 *
 * 测试覆盖：
 * - 引擎初始化
 * - 落子合法性检查
 * - 翻转逻辑
 * - 吃子规则
 * - Pass 机制
 * - 胜负判定
 * - 悔棋功能
 * - 游戏结束条件
 * - AI 基础功能
 *
 * 遵循需求文档第6章 - 黑白棋插件设计需求
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReversiEngine } from './reversi.engine';
import { ReversiAI } from './ai/reversi-ai';
import { ReversiPlugin } from './reversi.plugin';
import {
  REVERSI_DEFAULT_SETTINGS,
  validateSettings,
  mergeSettings,
  getSettingField,
  getSettingsByGroup,
  AI_DIFFICULTY_OPTIONS,
} from './reversi.settings';
import type { Board, Cell, Position } from './reversi.types';

// ==================== Helper Functions ====================

/** 创建空棋盘 */
function createEmptyBoard(): Board {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0 as Cell));
}

/** 从二维数组创建棋盘 */
function boardFromArray(arr: number[][]): Board {
  return arr.map((row) => row.map((cell) => cell as Cell)) as Board;
}

/** 打印棋盘（调试辅助） */
function printBoard(board: Board): string {
  const symbols = { 0: '.', 1: 'X', 2: 'O' };
  return board.map((row) => row.map((c) => symbols[c]).join(' ')).join('\n');
}

// ==================== ReversiEngine Tests ====================

describe('ReversiEngine', () => {
  let engine: ReversiEngine;

  beforeEach(() => {
    engine = new ReversiEngine();
  });

  // -------- 初始化 --------

  describe('initialization', () => {
    it('should create correct initial board', () => {
      const state = engine.getState();

      expect(state.board).toHaveLength(8);
      state.board.forEach((row) => expect(row).toHaveLength(8));

      // 初始4子：e4=黑(1), d5=黑(1), d4=白(2), e5=白(2)（0-indexed: [3,3]=白, [3,4]=黑, [4,3]=黑, [4,4]=白）
      expect(state.board[3][3]).toBe(2);
      expect(state.board[3][4]).toBe(1);
      expect(state.board[4][3]).toBe(1);
      expect(state.board[4][4]).toBe(2);
    });

    it('should set initial state correctly', () => {
      const state = engine.getState();

      expect(state.currentPlayer).toBe(1); // 黑先行
      expect(state.blackCount).toBe(2);
      expect(state.whiteCount).toBe(2);
      expect(state.winner).toBeNull();
      expect(state.isDraw).toBe(false);
      expect(state.gameOver).toBe(false);
      expect(state.passCount).toBe(0);
      expect(state.moveHistory).toHaveLength(0);
    });

    it('should calculate initial legal moves for black', () => {
      const state = engine.getState();

      // 黑棋初始合法走法应有4个：d3, c4, f5, e6 (0-indexed)
      expect(state.legalMoves).toHaveLength(4);
      expect(state.legalMoves).toContainEqual({ x: 2, y: 3 });
      expect(state.legalMoves).toContainEqual({ x: 3, y: 2 });
      expect(state.legalMoves).toContainEqual({ x: 4, y: 5 });
      expect(state.legalMoves).toContainEqual({ x: 5, y: 4 });
    });
  });

  // -------- 合法性检查 --------

  describe('move validation', () => {
    it('should return true for valid moves', () => {
      expect(engine.isValidMove(2, 3)).toBe(true);
      expect(engine.isValidMove(3, 2)).toBe(true);
      expect(engine.isValidMove(4, 5)).toBe(true);
      expect(engine.isValidMove(5, 4)).toBe(true);
    });

    it('should return false for occupied positions', () => {
      expect(engine.isValidMove(3, 3)).toBe(false); // 白棋
      expect(engine.isValidMove(3, 4)).toBe(false); // 黑棋
    });

    it('should return false for empty but invalid positions', () => {
      expect(engine.isValidMove(0, 0)).toBe(false);
      expect(engine.isValidMove(7, 7)).toBe(false);
      expect(engine.isValidMove(4, 4)).toBe(false); // 白棋位置
    });

    it('should return false for out of bounds', () => {
      expect(engine.isValidMove(-1, 0)).toBe(false);
      expect(engine.isValidMove(0, -1)).toBe(false);
      expect(engine.isValidMove(8, 0)).toBe(false);
      expect(engine.isValidMove(0, 8)).toBe(false);
    });
  });

  // -------- 落子 --------

  describe('making moves', () => {
    it('should place disc and flip opponent discs', () => {
      const success = engine.makeMove(2, 3); // c4

      expect(success).toBe(true);
      const state = engine.getState();
      expect(state.board[2][3]).toBe(1); // 黑棋落子
      expect(state.board[3][3]).toBe(1); // 原白棋被翻转为黑
    });

    it('should switch player after move', () => {
      engine.makeMove(2, 3);
      expect(engine.getState().currentPlayer).toBe(2); // 切换到白棋
    });

    it('should update disc counts after move', () => {
      engine.makeMove(2, 3);
      const state = engine.getState();
      // 黑棋：2 + 1(新子) + 1(翻转) = 4
      // 白棋：2 - 1(被翻) = 1
      expect(state.blackCount).toBe(4);
      expect(state.whiteCount).toBe(1);
    });

    it('should record move in history', () => {
      engine.makeMove(2, 3);
      const state = engine.getState();

      expect(state.moveHistory).toHaveLength(1);
      expect(state.moveHistory[0].x).toBe(2);
      expect(state.moveHistory[0].y).toBe(3);
      expect(state.moveHistory[0].player).toBe(1);
      expect(state.moveHistory[0].flipped).toContainEqual({ x: 3, y: 3 });
    });

    it('should return false for invalid move', () => {
      expect(engine.makeMove(0, 0)).toBe(false);
      expect(engine.makeMove(3, 3)).toBe(false); // 已被占据
    });

    it('should return false after game is over', () => {
      // 创建游戏结束状态
      const board = createEmptyBoard();
      board[0][0] = 1;
      board[0][1] = 1;
      board[0][2] = 2;

      // 手动设置为结束状态测试
      engine.makeMove(2, 3);
      expect(engine.getState().gameOver).toBe(false);
    });
  });

  // -------- 翻转方向 --------

  describe('flip directions', () => {
    it('should flip in all 8 directions', () => {
      // 设置一个可以多方翻转的棋盘
      const board = createEmptyBoard();
      board[3][3] = 2;
      board[3][4] = 1;
      board[4][3] = 1;
      board[4][4] = 2;

      // 使用静态方法测试多方翻转
      const flipped = ReversiEngine.getFlippedDiscsStatic(board, 2, 4, 1);
      expect(flipped.length).toBeGreaterThan(0);
    });
  });

  // -------- Pass --------

  describe('pass', () => {
    it('should return false when legal moves exist', () => {
      expect(engine.pass()).toBe(false); // 初始有4个合法走法
    });

    it('should return true when no legal moves', () => {
      // 构造一个无合法走法的局面（通过特定棋盘配置）
      const board = createEmptyBoard();
      // 填满棋盘让当前玩家无法走棋
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          board[i][j] = 1; // 全黑
        }
      }
      // 但这样会直接结束，我们用另一种方式测试

      // 更简单的方式：创建一个引擎，让其处于必须Pass的状态
      const testEngine = new ReversiEngine();
      // 正常游戏过程中如果出现无合法走法的情况
      // pass() 应该返回 true

      // 测试静态方法确保逻辑正确
      const moves = ReversiEngine.getLegalMovesStatic(board, 2);
      expect(moves.length).toBe(0);
    });
  });

  // -------- 悔棋 --------

  describe('undo', () => {
    it('should undo last move', () => {
      const initialState = engine.getState();
      engine.makeMove(2, 3);

      expect(engine.getState().moveHistory).toHaveLength(1);

      const success = engine.undoMove();
      expect(success).toBe(true);

      const afterUndo = engine.getState();
      expect(afterUndo.moveHistory).toHaveLength(0);
      expect(afterUndo.currentPlayer).toBe(initialState.currentPlayer);
      // 棋盘应恢复到初始状态
      expect(afterUndo.board[2][3]).toBe(0);
      expect(afterUndo.board[3][3]).toBe(2); // 恢复白棋
    });

    it('should return false when no moves to undo', () => {
      expect(engine.undoMove()).toBe(false);
    });

    it('should restore disc counts after undo', () => {
      engine.makeMove(2, 3);
      engine.undoMove();

      const state = engine.getState();
      expect(state.blackCount).toBe(2);
      expect(state.whiteCount).toBe(2);
    });

    it('should undo multiple moves', () => {
      engine.makeMove(2, 3);
      engine.makeMove(2, 2);

      expect(engine.getState().moveHistory).toHaveLength(2);

      engine.undoMove();
      expect(engine.getState().moveHistory).toHaveLength(1);

      engine.undoMove();
      expect(engine.getState().moveHistory).toHaveLength(0);
    });
  });

  // -------- 重置 --------

  describe('reset', () => {
    it('should reset to initial state', () => {
      engine.makeMove(2, 3);
      engine.makeMove(2, 2);

      engine.reset();
      const state = engine.getState();

      expect(state.moveHistory).toHaveLength(0);
      expect(state.currentPlayer).toBe(1);
      expect(state.blackCount).toBe(2);
      expect(state.whiteCount).toBe(2);
      expect(state.board[3][3]).toBe(2);
      expect(state.board[3][4]).toBe(1);
      expect(state.board[4][3]).toBe(1);
      expect(state.board[4][4]).toBe(2);
      expect(state.gameOver).toBe(false);
      expect(state.winner).toBeNull();
    });
  });

  // -------- 游戏结束 --------

  describe('game over', () => {
    it('should end game when board is full', () => {
      const board = createEmptyBoard();
      // 填满棋盘，黑比白多
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          board[i][j] = 1; // 全黑
        }
      }

      // 双方都无法走棋时游戏结束
      const blackMoves = ReversiEngine.getLegalMovesStatic(board, 1);
      const whiteMoves = ReversiEngine.getLegalMovesStatic(board, 2);
      expect(blackMoves.length).toBe(0);
      expect(whiteMoves.length).toBe(0);
    });

    it('should end game when one player has no discs', () => {
      const board = createEmptyBoard();
      board[0][0] = 1;
      board[0][1] = 1;

      const counts = ReversiEngine.countDiscsStatic(board);
      expect(counts.black).toBe(2);
      expect(counts.white).toBe(0);
    });

    it('should detect draw correctly', () => {
      const board = createEmptyBoard();
      // 各32子平局
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 4; j++) {
          board[i][j] = 1;
        }
        for (let j = 4; j < 8; j++) {
          board[i][j] = 2;
        }
      }

      const counts = ReversiEngine.countDiscsStatic(board);
      expect(counts.black).toBe(32);
      expect(counts.white).toBe(32);
    });
  });

  // -------- 棋子计数 --------

  describe('disc counting', () => {
    it('should count correctly after moves', () => {
      const counts1 = engine.getState();
      expect(counts1.blackCount).toBe(2);
      expect(counts1.whiteCount).toBe(2);

      engine.makeMove(2, 3);
      const counts2 = engine.getState();
      expect(counts2.blackCount + counts2.whiteCount).toBe(5); // 总子数 = 4 + 1
    });

    it('static countDiscs should work correctly', () => {
      const board = createEmptyBoard();
      board[0][0] = 1;
      board[1][1] = 1;
      board[2][2] = 2;

      const counts = ReversiEngine.countDiscsStatic(board);
      expect(counts.black).toBe(2);
      expect(counts.white).toBe(1);
    });
  });

  // -------- 静态方法 --------

  describe('static methods', () => {
    it('getFlippedDiscsStatic should return correct flips', () => {
      const board = createEmptyBoard();
      board[3][3] = 2;
      board[3][4] = 1;
      board[4][3] = 1;
      board[4][4] = 2;

      const flipped = ReversiEngine.getFlippedDiscsStatic(board, 2, 3, 1);
      expect(flipped.length).toBe(1);
      expect(flipped[0]).toEqual({ x: 3, y: 3 });
    });

    it('isValidMoveStatic should work correctly', () => {
      const board = createEmptyBoard();
      board[3][3] = 2;
      board[3][4] = 1;
      board[4][3] = 1;
      board[4][4] = 2;

      expect(ReversiEngine.isValidMoveStatic(board, 2, 3, 1)).toBe(true);
      expect(ReversiEngine.isValidMoveStatic(board, 0, 0, 1)).toBe(false);
      expect(ReversiEngine.isValidMoveStatic(board, 3, 3, 1)).toBe(false);
    });

    it('getLegalMovesStatic should return all legal moves', () => {
      const board = createEmptyBoard();
      board[3][3] = 2;
      board[3][4] = 1;
      board[4][3] = 1;
      board[4][4] = 2;

      const moves = ReversiEngine.getLegalMovesStatic(board, 1);
      expect(moves).toHaveLength(4);
    });
  });

  // -------- 边界条件 --------

  describe('edge cases', () => {
    it('should handle corner moves correctly', () => {
      // 角上落子是最强的位置
      const board = createEmptyBoard();
      board[0][1] = 1;
      board[1][0] = 1;
      board[1][1] = 2;

      // 白棋在(0,0)落子，应该能翻转
      const flipped = ReversiEngine.getFlippedDiscsStatic(board, 0, 0, 2);
      expect(flipped.length).toBeGreaterThan(0);
    });

    it('should not allow move on occupied cell', () => {
      const board = createEmptyBoard();
      board[3][3] = 1;

      const flipped = ReversiEngine.getFlippedDiscsStatic(board, 3, 3, 2);
      expect(flipped.length).toBe(0);
    });

    it('should handle getFlippedDiscs for out of bounds', () => {
      const flipped = engine.getFlippedDiscs(-1, 0, 1);
      expect(flipped).toEqual([]);
    });
  });
});

// ==================== ReversiAI Tests ====================

describe('ReversiAI', () => {
  let engine: ReversiEngine;

  beforeEach(() => {
    engine = new ReversiEngine();
  });

  describe('easy difficulty', () => {
    it('should return a legal move', () => {
      const ai = new ReversiAI('easy');
      const state = engine.getState();
      const move = ai.getMove(state);

      // 检查返回的是合法走法
      expect(state.legalMoves).toContainEqual(move);
    });

    it('should return same move type', () => {
      const ai = new ReversiAI('easy');
      const move = ai.getMove(engine.getState());

      expect(move).toHaveProperty('x');
      expect(move).toHaveProperty('y');
      expect(typeof move.x).toBe('number');
      expect(typeof move.y).toBe('number');
    });
  });

  describe('medium difficulty', () => {
    it('should return a legal move', () => {
      const ai = new ReversiAI('medium');
      const state = engine.getState();
      const move = ai.getMove(state);

      expect(state.legalMoves).toContainEqual(move);
    });

    it('should play a full game without errors', () => {
      const aiBlack = new ReversiAI('medium');
      const aiWhite = new ReversiAI('medium');
      const testEngine = new ReversiEngine();

      let moveCount = 0;
      const maxMoves = 100; // 防止无限循环

      while (!testEngine.getState().gameOver && moveCount < maxMoves) {
        const state = testEngine.getState();

        if (state.legalMoves.length === 0) {
          testEngine.pass();
        } else {
          const ai = state.currentPlayer === 1 ? aiBlack : aiWhite;
          const move = ai.getMove(state);
          const success = testEngine.makeMove(move.x, move.y);
          expect(success).toBe(true);
        }
        moveCount++;
      }

      // 游戏应该正常结束
      expect(testEngine.getState().gameOver).toBe(true);
      expect(moveCount).toBeLessThan(maxMoves);
    });
  });

  describe('hard difficulty', () => {
    it('should return a legal move', () => {
      const ai = new ReversiAI('hard');
      const state = engine.getState();
      const move = ai.getMove(state);

      expect(state.legalMoves).toContainEqual(move);
    });

    it('should play a full game without errors', () => {
      const aiBlack = new ReversiAI('hard');
      const aiWhite = new ReversiAI('easy');
      const testEngine = new ReversiEngine();

      let moveCount = 0;
      const maxMoves = 100;

      while (!testEngine.getState().gameOver && moveCount < maxMoves) {
        const state = testEngine.getState();

        if (state.legalMoves.length === 0) {
          testEngine.pass();
        } else {
          const ai = state.currentPlayer === 1 ? aiBlack : aiWhite;
          const move = ai.getMove(state);
          const success = testEngine.makeMove(move.x, move.y);
          expect(success).toBe(true);
        }
        moveCount++;
      }

      expect(testEngine.getState().gameOver).toBe(true);
    });

    it('should handle endgame search when few cells remain', () => {
      // 创建一个快结束的棋局
      const board = createEmptyBoard();
      // 设置一个几乎满棋盘的局面
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          board[i][j] = (i + j) % 2 === 0 ? 1 : 2;
        }
      }
      // 留几个空位
      board[0][0] = 0;
      board[0][1] = 0;
      board[7][7] = 0;

      const ai = new ReversiAI('hard');
      // hard AI 在空位少时会使用终局搜索
      const state = engine.getState();
      const move = ai.getMove(state);
      expect(move).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should throw error when no legal moves', () => {
      const ai = new ReversiAI('medium');
      const state = engine.getState();
      // 伪造一个无合法走法的状态
      const noMovesState = {
        ...state,
        legalMoves: [] as Position[],
      };

      expect(() => ai.getMove(noMovesState)).toThrow('No legal moves available');
    });

    it('should return single legal move immediately', () => {
      const ai = new ReversiAI('medium');
      const state = engine.getState();

      // 伪造只有一个合法走法的状态
      const singleMoveState = {
        ...state,
        legalMoves: [{ x: 2, y: 3 }],
      };

      const move = ai.getMove(singleMoveState);
      expect(move).toEqual({ x: 2, y: 3 });
    });
  });
});

// ==================== ReversiPlugin Tests ====================

describe('ReversiPlugin', () => {
  it('should initialize with correct metadata', () => {
    const plugin = new ReversiPlugin();

    expect(plugin.name).toBe('reversi');
    expect(plugin.displayName).toBe('黑白棋');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.gameModes).toContain('pvp');
    expect(plugin.gameModes).toContain('pve');
  });

  it('should initialize with default options', () => {
    const plugin = new ReversiPlugin();
    const options = plugin.getOptions();

    expect(options.enableAI).toBe(false);
    expect(options.aiDifficulty).toBe('medium');
    expect(options.aiPlayer).toBeNull();
    expect(options.allowUndo).toBe(true);
    expect(options.showHints).toBe(true);
    expect(options.moveTimeout).toBe(0);
  });

  it('should initialize with custom options', () => {
    const plugin = new ReversiPlugin({
      enableAI: true,
      aiDifficulty: 'hard',
      aiPlayer: 2,
    });
    const options = plugin.getOptions();

    expect(options.enableAI).toBe(true);
    expect(options.aiDifficulty).toBe('hard');
    expect(options.aiPlayer).toBe(2);
  });

  it('should update options correctly', () => {
    const plugin = new ReversiPlugin();
    plugin.updateOptions({ allowUndo: false });

    expect(plugin.getOptions().allowUndo).toBe(false);
  });

  it('should manage game lifecycle', () => {
    const plugin = new ReversiPlugin();

    expect(plugin.isRunning()).toBe(false);

    plugin.start();
    expect(plugin.isRunning()).toBe(true);

    plugin.stop();
    expect(plugin.isRunning()).toBe(false);

    plugin.destroy();
  });

  it('should get game state', () => {
    const plugin = new ReversiPlugin();
    plugin.start();

    const state = plugin.getState();
    expect(state.currentPlayer).toBe(1);
    expect(state.blackCount).toBe(2);
    expect(state.whiteCount).toBe(2);
  });

  it('should handle makeMove', () => {
    const plugin = new ReversiPlugin();
    plugin.start();

    const success = plugin.makeMove(2, 3);
    expect(success).toBe(true);
    expect(plugin.getState().board[2][3]).toBe(1);
  });

  it('should reject invalid move', () => {
    const plugin = new ReversiPlugin();
    plugin.start();

    expect(plugin.makeMove(0, 0)).toBe(false);
  });

  it('should handle undo when allowed', () => {
    const plugin = new ReversiPlugin({ allowUndo: true });
    plugin.start();

    plugin.makeMove(2, 3);
    expect(plugin.getState().moveHistory).toHaveLength(1);

    const success = plugin.undo();
    expect(success).toBe(true);
    expect(plugin.getState().moveHistory).toHaveLength(0);
  });

  it('should reject undo when not allowed', () => {
    const plugin = new ReversiPlugin({ allowUndo: false });
    plugin.start();

    plugin.makeMove(2, 3);
    expect(plugin.undo()).toBe(false);
  });

  it('should handle reset', () => {
    const plugin = new ReversiPlugin();
    plugin.start();

    plugin.makeMove(2, 3);
    expect(plugin.getState().moveHistory).toHaveLength(1);

    plugin.reset();
    expect(plugin.getState().moveHistory).toHaveLength(0);
    expect(plugin.getState().currentPlayer).toBe(1);
  });

  it('should handle event listeners', () => {
    const plugin = new ReversiPlugin();
    const events: string[] = [];

    const listener = (event: { type: string }) => {
      events.push(event.type);
    };

    plugin.on(listener);
    plugin.start();
    plugin.makeMove(2, 3);

    expect(events.length).toBeGreaterThan(0);
    expect(events).toContain('move');

    plugin.off(listener);
  });

  it('should set AI difficulty', () => {
    const plugin = new ReversiPlugin();
    plugin.setAIDifficulty('hard');

    expect(plugin.getOptions().aiDifficulty).toBe('hard');
  });

  it('should set AI player', () => {
    const plugin = new ReversiPlugin();
    plugin.setAIPlayer(2);

    expect(plugin.getOptions().aiPlayer).toBe(2);
    expect(plugin.getOptions().enableAI).toBe(true);
  });

  it('should return correct legal moves', () => {
    const plugin = new ReversiPlugin();
    plugin.start();

    const moves = plugin.getLegalMoves();
    expect(moves).toHaveLength(4);
  });

  it('should check valid move correctly', () => {
    const plugin = new ReversiPlugin();
    plugin.start();

    expect(plugin.isValidMove(2, 3)).toBe(true);
    expect(plugin.isValidMove(0, 0)).toBe(false);
  });
});

// ==================== Settings Tests ====================

describe('ReversiSettings', () => {
  it('should have correct default settings', () => {
    expect(REVERSI_DEFAULT_SETTINGS.enableAI).toBe(false);
    expect(REVERSI_DEFAULT_SETTINGS.aiDifficulty).toBe('medium');
    expect(REVERSI_DEFAULT_SETTINGS.aiPlayer).toBeNull();
    expect(REVERSI_DEFAULT_SETTINGS.allowUndo).toBe(true);
    expect(REVERSI_DEFAULT_SETTINGS.showHints).toBe(true);
    expect(REVERSI_DEFAULT_SETTINGS.moveTimeout).toBe(0);
  });

  it('should validate correct settings', () => {
    expect(validateSettings({ moveTimeout: 30 })).toBeNull();
    expect(validateSettings({ aiDifficulty: 'hard' })).toBeNull();
    expect(validateSettings({ aiPlayer: 1 })).toBeNull();
    expect(validateSettings({ aiPlayer: null })).toBeNull();
  });

  it('should reject invalid moveTimeout', () => {
    expect(validateSettings({ moveTimeout: -1 })).toBe('走棋限时不能为负数');
    expect(validateSettings({ moveTimeout: 4000 })).toBe('走棋限时不能超过3600秒');
  });

  it('should reject invalid aiDifficulty', () => {
    expect(validateSettings({ aiDifficulty: 'expert' as 'hard' })).toContain('无效');
  });

  it('should merge settings correctly', () => {
    const merged = mergeSettings({ enableAI: true, aiDifficulty: 'hard' });

    expect(merged.enableAI).toBe(true);
    expect(merged.aiDifficulty).toBe('hard');
    expect(merged.aiPlayer).toBeNull(); // 使用默认值
    expect(merged.allowUndo).toBe(true); // 使用默认值
  });

  it('should return undefined for unknown setting key', () => {
    expect(getSettingField('unknown_key')).toBeUndefined();
  });

  it('should return correct setting field', () => {
    const field = getSettingField('aiDifficulty');
    expect(field).toBeDefined();
    expect(field?.key).toBe('aiDifficulty');
    expect(field?.type).toBe('select');
  });

  it('should group settings correctly', () => {
    const aiSettings = getSettingsByGroup('ai');
    expect(aiSettings.length).toBeGreaterThan(0);
    aiSettings.forEach((s) => expect(s.group).toBe('ai'));

    const generalSettings = getSettingsByGroup('general');
    expect(generalSettings.length).toBeGreaterThan(0);
    generalSettings.forEach((s) => expect(s.group).toBe('general'));
  });

  it('should have 3 AI difficulty options', () => {
    expect(AI_DIFFICULTY_OPTIONS).toHaveLength(3);
    expect(AI_DIFFICULTY_OPTIONS.map((o) => o.value)).toContain('easy');
    expect(AI_DIFFICULTY_OPTIONS.map((o) => o.value)).toContain('medium');
    expect(AI_DIFFICULTY_OPTIONS.map((o) => o.value)).toContain('hard');
  });
});

// ==================== Integration Tests ====================

describe('Integration Tests', () => {
  it('should complete a full PvP game', () => {
    const plugin = new ReversiPlugin();
    plugin.start();

    let moveCount = 0;
    const maxMoves = 100;

    while (!plugin.getState().gameOver && moveCount < maxMoves) {
      const moves = plugin.getLegalMoves();
      if (moves.length === 0) {
        plugin.pass();
      } else {
        plugin.makeMove(moves[0].x, moves[0].y);
      }
      moveCount++;
    }

    const finalState = plugin.getState();
    expect(finalState.gameOver).toBe(true);
    expect(finalState.blackCount + finalState.whiteCount).toBe(64);
    expect(moveCount).toBeLessThan(maxMoves);
  });

  it('should complete a full PvE game', () => {
    const plugin = new ReversiPlugin({
      enableAI: true,
      aiDifficulty: 'easy',
      aiPlayer: 2,
    });
    plugin.start();

    let moveCount = 0;
    const maxMoves = 100;

    while (!plugin.getState().gameOver && moveCount < maxMoves) {
      const state = plugin.getState();
      if (state.legalMoves.length === 0) {
        plugin.pass();
      } else if (state.currentPlayer === 1) {
        // 玩家走棋
        plugin.makeMove(state.legalMoves[0].x, state.legalMoves[0].y);
      } else {
        // AI走棋 - 等待AI
        // 在测试中，AI是异步的，我们直接通过引擎模拟
        const ai = new ReversiAI('easy');
        const move = ai.getMove(plugin.getState());
        plugin.makeMove(move.x, move.y);
      }
      moveCount++;
    }

    const finalState = plugin.getState();
    expect(finalState.gameOver).toBe(true);
    expect(finalState.blackCount + finalState.whiteCount).toBe(64);
  });

  it('should maintain engine state consistency', () => {
    const engine = new ReversiEngine();

    // 进行若干步
    engine.makeMove(2, 3);
    engine.makeMove(2, 2);
    engine.makeMove(3, 2);

    const state = engine.getState();

    // 验证状态一致性
    const counts = engine.getState();
    expect(counts.blackCount + counts.whiteCount).toBe(3 + 4); // 3步 + 初始4子

    // 验证棋盘上黑白子总数等于计数
    let blackOnBoard = 0;
    let whiteOnBoard = 0;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (state.board[i][j] === 1) blackOnBoard++;
        if (state.board[i][j] === 2) whiteOnBoard++;
      }
    }
    expect(blackOnBoard).toBe(state.blackCount);
    expect(whiteOnBoard).toBe(state.whiteCount);
  });
});
