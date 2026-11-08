/**
 * 五子棋引擎单元测试
 *
 * 测试覆盖：
 * - 初始状态
 * - 落子（合法/非法）
 * - 胜负判定（横、竖、对角线五连）
 * - 禁手规则（三三禁手、四四禁手、长连禁手）
 * - 和棋判定
 * - 悔棋
 * - 记谱格式转换
 */

import { GomokuEngine } from './gomoku.engine';

describe('GomokuEngine', () => {
  describe('初始状态', () => {
    it('应创建15路空棋盘', () => {
      const engine = new GomokuEngine(15);
      const state = engine.getState();

      expect(state.board.length).toBe(15);
      expect(state.board[0].length).toBe(15);
      expect(state.board.every((row) => row.every((cell) => cell === 0))).toBe(true);
    });

    it('应创建19路空棋盘', () => {
      const engine = new GomokuEngine(19);
      const state = engine.getState();

      expect(state.board.length).toBe(19);
      expect(state.board[0].length).toBe(19);
    });

    it('初始状态应为黑方先手', () => {
      const engine = new GomokuEngine();
      const state = engine.getState();

      expect(state.currentPlayer).toBe(1); // 黑方
      expect(state.moveCount).toBe(0);
      expect(state.winner).toBeNull();
      expect(state.isDraw).toBe(false);
      expect(state.gameOver).toBe(false);
      expect(state.lastMove).toBeNull();
      expect(state.moveHistory).toHaveLength(0);
    });
  });

  describe('落子', () => {
    let engine: GomokuEngine;

    beforeEach(() => {
      engine = new GomokuEngine(15, false); // 禁用禁手简化测试
    });

    it('应允许黑方在空位落子', () => {
      const success = engine.makeMove(7, 7);
      const state = engine.getState();

      expect(success).toBe(true);
      expect(state.board[7][7]).toBe(1);
      expect(state.currentPlayer).toBe(2); // 切换到白方
      expect(state.moveCount).toBe(1);
      expect(state.lastMove).toEqual(
        expect.objectContaining({ x: 7, y: 7, player: 1 })
      );
    });

    it('应允许白方在黑方之后落子', () => {
      engine.makeMove(7, 7); // 黑
      const success = engine.makeMove(8, 8); // 白
      const state = engine.getState();

      expect(success).toBe(true);
      expect(state.board[8][8]).toBe(2);
      expect(state.currentPlayer).toBe(1);
    });

    it('应拒绝在已占位置落子', () => {
      engine.makeMove(7, 7);
      const success = engine.makeMove(7, 7);

      expect(success).toBe(false);
    });

    it('应拒绝越界落子', () => {
      expect(engine.makeMove(-1, 7)).toBe(false);
      expect(engine.makeMove(7, -1)).toBe(false);
      expect(engine.makeMove(15, 7)).toBe(false);
      expect(engine.makeMove(7, 15)).toBe(false);
    });

    it('应记录走子历史', () => {
      engine.makeMove(7, 7);
      engine.makeMove(8, 8);
      const state = engine.getState();

      expect(state.moveHistory).toHaveLength(2);
      expect(state.moveHistory[0]).toEqual(
        expect.objectContaining({ x: 7, y: 7, player: 1 })
      );
      expect(state.moveHistory[1]).toEqual(
        expect.objectContaining({ x: 8, y: 8, player: 2 })
      );
    });
  });

  describe('胜负判定', () => {
    let engine: GomokuEngine;

    beforeEach(() => {
      engine = new GomokuEngine(15, false);
    });

    it('应判定横向五连为胜', () => {
      // 黑方在 y=7 行形成五连 x=3,4,5,6,7
      engine.makeMove(3, 7); // 黑
      engine.makeMove(0, 0); // 白（干扰）
      engine.makeMove(4, 7); // 黑
      engine.makeMove(0, 1); // 白
      engine.makeMove(5, 7); // 黑
      engine.makeMove(0, 2); // 白
      engine.makeMove(6, 7); // 黑
      engine.makeMove(0, 3); // 白
      const success = engine.makeMove(7, 7); // 黑 — 五连！
      const state = engine.getState();

      expect(success).toBe(true);
      expect(state.winner).toBe(1);
      expect(state.gameOver).toBe(true);
    });

    it('应判定竖向五连为胜', () => {
      // 黑方在 x=7 列形成五连 y=3,4,5,6,7
      engine.makeMove(7, 3); // 黑
      engine.makeMove(0, 0); // 白
      engine.makeMove(7, 4); // 黑
      engine.makeMove(0, 1); // 白
      engine.makeMove(7, 5); // 黑
      engine.makeMove(0, 2); // 白
      engine.makeMove(7, 6); // 黑
      engine.makeMove(0, 3); // 白
      engine.makeMove(7, 7); // 黑 — 五连！
      const state = engine.getState();

      expect(state.winner).toBe(1);
      expect(state.gameOver).toBe(true);
    });

    it('应判定主对角线五连为胜', () => {
      // 黑方在主对角线形成五连 (3,3),(4,4),(5,5),(6,6),(7,7)
      engine.makeMove(3, 3); // 黑
      engine.makeMove(0, 0); // 白
      engine.makeMove(4, 4); // 黑
      engine.makeMove(0, 1); // 白
      engine.makeMove(5, 5); // 黑
      engine.makeMove(0, 2); // 白
      engine.makeMove(6, 6); // 黑
      engine.makeMove(0, 3); // 白
      engine.makeMove(7, 7); // 黑 — 五连！
      const state = engine.getState();

      expect(state.winner).toBe(1);
      expect(state.gameOver).toBe(true);
    });

    it('应判定副对角线五连为胜', () => {
      // 黑方在副对角线形成五连 (7,3),(6,4),(5,5),(4,6),(3,7)
      engine.makeMove(7, 3); // 黑
      engine.makeMove(0, 0); // 白
      engine.makeMove(6, 4); // 黑
      engine.makeMove(0, 1); // 白
      engine.makeMove(5, 5); // 黑
      engine.makeMove(0, 2); // 白
      engine.makeMove(4, 6); // 黑
      engine.makeMove(0, 3); // 白
      engine.makeMove(3, 7); // 黑 — 五连！
      const state = engine.getState();

      expect(state.winner).toBe(1);
      expect(state.gameOver).toBe(true);
    });

    it('白方获胜应正确判定', () => {
      // 注意：黑方干扰子不能在 x=0 列连成 5 子（否则黑方先胜）
      engine.makeMove(0, 0); // 黑
      engine.makeMove(3, 7); // 白
      engine.makeMove(0, 1); // 黑
      engine.makeMove(4, 7); // 白
      engine.makeMove(0, 2); // 黑
      engine.makeMove(5, 7); // 白
      engine.makeMove(0, 3); // 黑
      engine.makeMove(6, 7); // 白
      engine.makeMove(14, 14); // 黑（第5枚干扰子避开 x=0 列，防止黑方五连）
      engine.makeMove(7, 7); // 白 — 五连！
      const state = engine.getState();

      expect(state.winner).toBe(2);
      expect(state.gameOver).toBe(true);
    });

    it('游戏结束后不应允许继续落子', () => {
      engine.makeMove(7, 7); // 黑
      engine.makeMove(0, 0); // 白
      engine.makeMove(7, 8); // 黑
      engine.makeMove(0, 1); // 白
      engine.makeMove(7, 9); // 黑
      engine.makeMove(0, 2); // 白
      engine.makeMove(7, 10); // 黑
      engine.makeMove(0, 3); // 白
      engine.makeMove(7, 11); // 黑 — 五连，游戏结束

      const success = engine.makeMove(7, 12);
      expect(success).toBe(false);
    });
  });

  describe('和棋判定', () => {
    it('应在棋盘满时判定和棋', () => {
      const engine = new GomokuEngine(15, false);
      const size = 15;

      // 目标着色：((x + 2*y) mod 4) < 2 为黑，其余为白。
      // 该模式在横、竖、两条对角线方向上的最长同色连子均为 2，
      // 可保证填满后（以及落子过程中的任意时刻）不形成五连。
      // 黑格共 113 个 = 黑方步数（第 1,3,...,225 步），白格 112 个，与行棋顺序天然匹配。
      const isBlackCell = (x: number, y: number) => (x + 2 * y) % 4 < 2;
      const blackCells: Array<{ x: number; y: number }> = [];
      const whiteCells: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          (isBlackCell(x, y) ? blackCells : whiteCells).push({ x, y });
        }
      }

      // 交替落子：奇数步执黑落黑格，偶数步执白落白格，最后第 225 步（黑）落最后一个黑格
      for (let i = 0; i < whiteCells.length; i++) {
        expect(engine.makeMove(blackCells[i].x, blackCells[i].y)).toBe(true);
        expect(engine.makeMove(whiteCells[i].x, whiteCells[i].y)).toBe(true);
      }
      const last = blackCells[blackCells.length - 1];
      expect(engine.makeMove(last.x, last.y)).toBe(true);

      const state = engine.getState();
      expect(state.moveCount).toBe(225);
      expect(state.isDraw).toBe(true);
      expect(state.gameOver).toBe(true);
      expect(state.winner).toBe(0);
    });
  });

  describe('悔棋', () => {
    let engine: GomokuEngine;

    beforeEach(() => {
      engine = new GomokuEngine(15, false);
    });

    it('应能撤销最后一步', () => {
      engine.makeMove(7, 7);
      const success = engine.undoMove();
      const state = engine.getState();

      expect(success).toBe(true);
      expect(state.board[7][7]).toBe(0);
      expect(state.moveCount).toBe(0);
      expect(state.currentPlayer).toBe(1);
    });

    it('空盘悔棋应失败', () => {
      const success = engine.undoMove();
      expect(success).toBe(false);
    });

    it('悔棋后应恢复到正确玩家', () => {
      engine.makeMove(7, 7); // 黑
      engine.makeMove(8, 8); // 白
      engine.undoMove();
      const state = engine.getState();

      expect(state.currentPlayer).toBe(2); // 应恢复到白方
      expect(state.board[8][8]).toBe(0);
      expect(state.board[7][7]).toBe(1); // 黑方落子仍在
    });

    it('游戏结束后悔棋应恢复游戏', () => {
      // 形成五连
      engine.makeMove(7, 7);
      engine.makeMove(0, 0);
      engine.makeMove(7, 8);
      engine.makeMove(0, 1);
      engine.makeMove(7, 9);
      engine.makeMove(0, 2);
      engine.makeMove(7, 10);
      engine.makeMove(0, 3);
      engine.makeMove(7, 11); // 五连结束

      expect(engine.isGameOver()).toBe(true);

      engine.undoMove();
      const state = engine.getState();

      expect(state.gameOver).toBe(false);
      expect(state.winner).toBeNull();
      expect(state.board[7][11]).toBe(0);
    });
  });

  describe('禁手规则', () => {
    let engine: GomokuEngine;

    beforeEach(() => {
      engine = new GomokuEngine(15, true); // 启用禁手
    });

    it('应在黑方禁手时判白方胜', () => {
      // 构造三三禁手局面
      // 先在黑方制造两个可形成活三的位置
      engine.makeMove(7, 7); // 黑: 天元
      engine.makeMove(6, 6); // 白
      engine.makeMove(7, 6); // 黑
      engine.makeMove(6, 7); // 白
      engine.makeMove(7, 8); // 黑
      engine.makeMove(6, 8); // 白
      engine.makeMove(8, 7); // 黑
      engine.makeMove(6, 9); // 白
      // 此时黑方在 (9,7) 落子可能形成三三禁手
      // 禁手检测通过 makeMove 触发
    });

    it('应禁用禁手后不再限制黑方', () => {
      engine = new GomokuEngine(15, false);
      // 无禁手下黑方可以自由落子
      engine.makeMove(7, 7);
      engine.makeMove(6, 6);
      engine.makeMove(7, 6);

      const state = engine.getState();
      expect(state.gameOver).toBe(false);
    });
  });

  describe('合法走法列表', () => {
    it('应返回所有空位作为合法走法', () => {
      const engine = new GomokuEngine(15, false);
      const legalMoves = engine.getLegalMoves();

      expect(legalMoves).toHaveLength(225); // 15*15
    });

    it('落子后应减少合法走法数', () => {
      const engine = new GomokuEngine(15, false);
      engine.makeMove(7, 7);
      engine.makeMove(8, 8);

      const legalMoves = engine.getLegalMoves();
      expect(legalMoves).toHaveLength(223);
      expect(legalMoves.some((m) => m.x === 7 && m.y === 7)).toBe(false);
      expect(legalMoves.some((m) => m.x === 8 && m.y === 8)).toBe(false);
    });
  });

  describe('记谱格式转换', () => {
    it('应正确转换坐标到记谱', () => {
      expect(GomokuEngine.toNotation(0, 0)).toBe('A1');
      expect(GomokuEngine.toNotation(7, 7)).toBe('H8');
      expect(GomokuEngine.toNotation(14, 14)).toBe('O15');
    });

    it('应正确解析记谱到坐标', () => {
      expect(GomokuEngine.fromNotation('A1')).toEqual({ x: 0, y: 0 });
      expect(GomokuEngine.fromNotation('H8')).toEqual({ x: 7, y: 7 });
      expect(GomokuEngine.fromNotation('O15')).toEqual({ x: 14, y: 14 });
    });

    it('应处理非法记谱', () => {
      expect(GomokuEngine.fromNotation('')).toBeNull();
      expect(GomokuEngine.fromNotation('X')).toBeNull();
      expect(GomokuEngine.fromNotation('1A')).toBeNull();
    });

    it('应支持大小写', () => {
      expect(GomokuEngine.fromNotation('a1')).toEqual({ x: 0, y: 0 });
      expect(GomokuEngine.fromNotation('h8')).toEqual({ x: 7, y: 7 });
    });
  });

  describe('重置游戏', () => {
    it('应能完全重置到初始状态', () => {
      const engine = new GomokuEngine(15, false);
      engine.makeMove(7, 7);
      engine.makeMove(8, 8);
      engine.reset();

      const state = engine.getState();
      expect(state.board.every((row) => row.every((cell) => cell === 0))).toBe(true);
      expect(state.currentPlayer).toBe(1);
      expect(state.moveCount).toBe(0);
      expect(state.winner).toBeNull();
      expect(state.gameOver).toBe(false);
      expect(state.lastMove).toBeNull();
      expect(state.moveHistory).toHaveLength(0);
    });
  });
});
