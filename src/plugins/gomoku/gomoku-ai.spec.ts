/**
 * 五子棋AI单元测试
 *
 * 测试覆盖：
 * - AI基本走法生成
 * - 即时获胜识别
 * - 阻止对手获胜
 * - 不同难度设置
 * - 开局库使用
 */

import { GomokuAI } from './gomoku-ai';
import type { GomokuState, Board, BoardSize } from './gomoku.types';
import { GomokuEngine } from './gomoku.engine';

/** 辅助函数：从引擎创建状态 */
function createStateFromEngine(engine: GomokuEngine): GomokuState {
  return engine.getState();
}

describe('GomokuAI', () => {
  describe('基本走法', () => {
    it('应在空棋盘下选择中心附近落子', () => {
      const ai = new GomokuAI('easy');
      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      const move = ai.getMove(state);

      // 首次落子应在天元附近
      expect(move.x).toBe(7);
      expect(move.y).toBe(7);
    });

    it('应返回合法坐标', () => {
      const ai = new GomokuAI('medium');
      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      const move = ai.getMove(state);

      expect(move.x).toBeGreaterThanOrEqual(0);
      expect(move.x).toBeLessThan(15);
      expect(move.y).toBeGreaterThanOrEqual(0);
      expect(move.y).toBeLessThan(15);
    });
  });

  describe('即时获胜识别', () => {
    it('应在有活四时直接获胜', () => {
      const ai = new GomokuAI('hard');
      const engine = new GomokuEngine(15, false);

      // 构造AI（黑方）活四局面：X X X X _ （在 x=3,4,5,6, y=7）
      // 注意：手动设置棋盘
      const state = createStateFromEngine(engine);
      state.board[7] = [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
      state.currentPlayer = 1;
      state.moveCount = 4;

      const move = ai.getMove(state);

      // 活四两端 x=2 / x=7 均为必胜点（都能完成五连），AI 任选其一即算直接获胜
      expect([2, 7]).toContain(move.x);
      expect(move.y).toBe(7);

      // 验证该落子确实形成五连（直接获胜）
      state.board[move.y][move.x] = 1;
      let maxRun = 0;
      let run = 0;
      for (let x = 0; x < 15; x++) {
        run = state.board[7][x] === 1 ? run + 1 : 0;
        maxRun = Math.max(maxRun, run);
      }
      expect(maxRun).toBeGreaterThanOrEqual(5);
    });

    it('应在有竖向活四时直接获胜', () => {
      const ai = new GomokuAI('hard');
      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      // 竖向活四：y=3,4,5,6 在 x=7
      state.board[3][7] = 1;
      state.board[4][7] = 1;
      state.board[5][7] = 1;
      state.board[6][7] = 1;
      state.currentPlayer = 1;
      state.moveCount = 4;

      const move = ai.getMove(state);

      expect(move.x).toBe(7);
      expect(move.y).toBe(2); // 上方 y=2 或 下方 y=7
    });
  });

  describe('阻止对手获胜', () => {
    it('应阻止对手活四', () => {
      const ai = new GomokuAI('hard');
      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      // 对手（白方）活四：x=3,4,5,6 在 y=7
      state.board[7] = [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0];
      state.currentPlayer = 1; // AI黑方走
      state.moveCount = 5;

      const move = ai.getMove(state);

      // AI必须堵住 x=2 或 x=7
      expect([2, 7]).toContain(move.x);
      expect(move.y).toBe(7);
    });

    it('应阻止对手竖向活四', () => {
      const ai = new GomokuAI('medium');
      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      // 白方竖向活四
      state.board[3][7] = 2;
      state.board[4][7] = 2;
      state.board[5][7] = 2;
      state.board[6][7] = 2;
      state.currentPlayer = 1;
      state.moveCount = 5;

      const move = ai.getMove(state);

      // 必须堵住 y=2 或 y=7
      expect(move.x).toBe(7);
      expect([2, 7]).toContain(move.y);
    });
  });

  describe('不同难度', () => {
    it('easy难度应生成有效走法', () => {
      const ai = new GomokuAI('easy');
      const engine = new GomokuEngine(15, false);

      engine.makeMove(7, 7);
      const state = createStateFromEngine(engine);

      const move = ai.getMove(state);

      expect(move.x).toBeGreaterThanOrEqual(0);
      expect(move.x).toBeLessThan(15);
      expect(move.y).toBeGreaterThanOrEqual(0);
      expect(move.y).toBeLessThan(15);
      // 不能落在已有棋子上
      expect(state.board[move.y][move.x]).toBe(0);
    });

    it('medium难度应生成有效走法', () => {
      const ai = new GomokuAI('medium');
      const engine = new GomokuEngine(15, false);

      engine.makeMove(7, 7);
      engine.makeMove(8, 8);
      const state = createStateFromEngine(engine);

      const move = ai.getMove(state);

      expect(state.board[move.y][move.x]).toBe(0);
    });

    it('hard难度应生成有效走法', () => {
      const ai = new GomokuAI('hard');
      const engine = new GomokuEngine(15, false);

      engine.makeMove(7, 7);
      engine.makeMove(8, 8);
      engine.makeMove(6, 7);
      const state = createStateFromEngine(engine);

      const move = ai.getMove(state);

      expect(state.board[move.y][move.x]).toBe(0);
    });

    it('应支持动态切换难度', () => {
      const ai = new GomokuAI('easy');
      ai.setDifficulty('hard');

      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      // hard模式下首次落子应在天元（开局库）
      const move = ai.getMove(state);
      expect(move.x).toBe(7);
      expect(move.y).toBe(7);
    });
  });

  describe('复杂局面应对', () => {
    it('应能在多子局面下生成走法', () => {
      const ai = new GomokuAI('medium');
      const engine = new GomokuEngine(15, false);

      // 模拟一段对局
      engine.makeMove(7, 7);
      engine.makeMove(6, 6);
      engine.makeMove(7, 6);
      engine.makeMove(6, 7);
      engine.makeMove(7, 8);
      engine.makeMove(6, 8);
      engine.makeMove(8, 7);
      engine.makeMove(6, 9);

      const state = createStateFromEngine(engine);
      const move = ai.getMove(state);

      expect(move.x).toBeGreaterThanOrEqual(0);
      expect(move.x).toBeLessThan(15);
      expect(move.y).toBeGreaterThanOrEqual(0);
      expect(move.y).toBeLessThan(15);
      expect(state.board[move.y][move.x]).toBe(0);
    });

    it('应在对手有多个威胁时选择最佳防守', () => {
      const ai = new GomokuAI('hard');
      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      // 构造对手（白方）有两个活三的局面
      state.board[7] = [0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]; // 活三 x=4,5,6
      state.board[8] = [0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]; // 活三 x=4,5,6
      state.currentPlayer = 1;
      state.moveCount = 6;

      const move = ai.getMove(state);

      expect(state.board[move.y][move.x]).toBe(0);
    });
  });

  describe('开局库（hard模式）', () => {
    it('hard模式下前10步应使用开局库', () => {
      const ai = new GomokuAI('hard');
      const engine = new GomokuEngine(15, false);
      const state = createStateFromEngine(engine);

      // 空盘首次落子
      const move = ai.getMove(state);

      // 开局库推荐天元
      expect(move.x).toBe(7);
      expect(move.y).toBe(7);
    });

    it('开局库应提供合理应对', () => {
      const ai = new GomokuAI('hard');
      const engine = new GomokuEngine(15, false);

      // 黑方天元
      engine.makeMove(7, 7);
      const state = createStateFromEngine(engine);

      // AI作为白方应对
      const move = ai.getMove(state);

      expect(state.board[move.y][move.x]).toBe(0);
      // 白方应在天元附近应对
      expect(Math.abs(move.x - 7)).toBeLessThanOrEqual(2);
      expect(Math.abs(move.y - 7)).toBeLessThanOrEqual(2);
    });
  });

  describe('边界情况', () => {
    it('应在棋盘只剩一个空位时选择该位', () => {
      const ai = new GomokuAI('medium');
      const engine = new GomokuEngine(5 as unknown as BoardSize, false); // 用小棋盘加速测试
      const state = createStateFromEngine(engine);

      // 填满除 (4,4) 外的所有位置
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          if (x === 4 && y === 4) continue;
          if (state.board[y][x] === 0) {
            state.board[y][x] = (x * 5 + y) % 2 === 0 ? 1 : 2;
          }
        }
      }
      state.currentPlayer = 1;
      state.moveCount = 24;

      const move = ai.getMove(state);

      expect(move.x).toBe(4);
      expect(move.y).toBe(4);
    });
  });
});
