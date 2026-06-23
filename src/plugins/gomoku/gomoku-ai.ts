/**
 * 五子棋AI引擎
 *
 * 基于 Minimax + Alpha-Beta 剪枝算法，配合棋型评估函数实现智能对弈。
 * 支持三个难度级别，开局库集成，以及走法排序优化。
 */

import type { GomokuState, Board, Position, Cell, AIDifficulty } from './gomoku.types';
import { queryOpeningBook, isInOpeningPhase } from './gomoku-opening-book';

// ==================== 棋型评分权重 ====================

/** 棋型评分权重表（用于局面评估） */
const PATTERN_WEIGHTS = {
  five: 10000000,     // 五连：必胜
  openFour: 100000,   // 活四：几乎必胜
  closedFour: 10000,  // 冲四：很强威胁
  openThree: 1000,    // 活三：潜在威胁
  closedThree: 100,   // 眠三：一般威胁
  openTwo: 10,        // 活二：发展潜力
  closedTwo: 1,       // 眠二：微弱潜力
};

/** 方向向量 */
const DIRECTIONS: Array<[number, number]> = [
  [0, 1],  // 竖向
  [1, 0],  // 横向
  [1, 1],  // 主对角线
  [1, -1], // 副对角线
];

/** 难度配置 */
interface DifficultyConfig {
  depth: number;
  randomPerturbation: number; // 随机扰动概率 (0-1)
  useOpeningBook: boolean;
}

const DIFFICULTY_CONFIGS: Record<AIDifficulty, DifficultyConfig> = {
  easy: { depth: 2, randomPerturbation: 0.2, useOpeningBook: false },
  medium: { depth: 4, randomPerturbation: 0, useOpeningBook: false },
  hard: { depth: 6, randomPerturbation: 0, useOpeningBook: true },
};

export class GomokuAI {
  private difficulty: AIDifficulty;
  private config: DifficultyConfig;
  private boardSize: number;

  constructor(difficulty: AIDifficulty = 'medium') {
    this.difficulty = difficulty;
    this.config = DIFFICULTY_CONFIGS[difficulty];
    this.boardSize = 15; // 默认15路
  }

  /**
   * 获取AI决策的走法。
   *
   * @param state - 当前游戏状态
   * @returns AI选择的坐标位置
   */
  getMove(state: GomokuState): Position {
    this.boardSize = state.board.length;
    const player = state.currentPlayer; // AI执棋方

    // 1. 检查是否有即时胜利走法
    const winningMove = this.findWinningMove(state.board, player);
    if (winningMove) return winningMove;

    // 2. 检查是否需要阻止对手胜利
    const opponent = player === 1 ? 2 : 1;
    const blockingMove = this.findWinningMove(state.board, opponent);
    if (blockingMove) return blockingMove;

    // 3. 开局库查询（仅hard难度且在前10步）
    if (this.config.useOpeningBook && isInOpeningPhase(state.moveCount)) {
      const bookMove = queryOpeningBook(state.moveHistory);
      if (bookMove) {
        // 验证开局库走法是否合法
        if (this.isEmpty(state.board, bookMove.move.x, bookMove.move.y)) {
          return bookMove.move;
        }
      }
    }

    // 4. Minimax + Alpha-Beta 搜索
    const candidates = this.generateCandidateMoves(state.board);
    if (candidates.length === 0) {
      // 首次落子：下天元
      const center = Math.floor(this.boardSize / 2);
      return { x: center, y: center };
    }

    // 走法排序（提升剪枝效率）
    const sortedMoves = this.orderMoves(state.board, candidates, player);

    let bestMove = sortedMoves[0];
    let bestScore = -Infinity;
    const alpha = -Infinity;
    const beta = Infinity;

    for (const move of sortedMoves) {
      // 模拟落子
      state.board[move.y][move.x] = player;
      const score = this.minimax(
        state.board,
        this.config.depth - 1,
        alpha,
        beta,
        false,
        player,
        opponent
      );
      state.board[move.y][move.x] = 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    // 5. 简单难度添加随机扰动
    if (this.config.randomPerturbation > 0) {
      if (Math.random() < this.config.randomPerturbation && sortedMoves.length > 1) {
        // 从前3个最优走法中随机选一个
        const topMoves = sortedMoves.slice(0, Math.min(3, sortedMoves.length));
        bestMove = topMoves[Math.floor(Math.random() * topMoves.length)];
      }
    }

    return bestMove;
  }

  /**
   * 设置AI难度（动态调整）。
   */
  setDifficulty(difficulty: AIDifficulty): void {
    this.difficulty = difficulty;
    this.config = DIFFICULTY_CONFIGS[difficulty];
  }

  // ==================== Minimax + Alpha-Beta ====================

  /**
   * Minimax搜索配合Alpha-Beta剪枝。
   *
   * @param board - 当前棋盘（会被修改后恢复）
   * @param depth - 剩余搜索深度
   * @param alpha - Alpha值
   * @param beta - Beta值
   * @param maximizing - 是否为最大化玩家（AI方）
   * @param aiPlayer - AI执棋方
   * @param humanPlayer - 对手方
   * @returns 局面评分
   */
  private minimax(
    board: Board,
    depth: number,
    alpha: number,
    beta: number,
    maximizing: boolean,
    aiPlayer: 1 | 2,
    humanPlayer: 1 | 2
  ): number {
    // 终止条件
    if (depth === 0) {
      return this.evaluateBoard(board, aiPlayer);
    }

    const currentPlayer = maximizing ? aiPlayer : humanPlayer;

    // 生成候选走法
    const candidates = this.generateCandidateMoves(board);
    if (candidates.length === 0) {
      return this.evaluateBoard(board, aiPlayer);
    }

    // 限制分支因子（提升搜索速度）
    const orderedMoves = this.orderMoves(board, candidates, currentPlayer).slice(0, 12);

    if (maximizing) {
      let maxEval = -Infinity;
      for (const move of orderedMoves) {
        board[move.y][move.x] = currentPlayer;

        // 检查是否获胜
        if (this.checkWinAt(board, move.x, move.y, currentPlayer)) {
          board[move.y][move.x] = 0;
          return PATTERN_WEIGHTS.five;
        }

        const evalScore = this.minimax(board, depth - 1, alpha, beta, false, aiPlayer, humanPlayer);
        board[move.y][move.x] = 0;

        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of orderedMoves) {
        board[move.y][move.x] = currentPlayer;

        // 检查是否获胜（对手胜利 = AI负分）
        if (this.checkWinAt(board, move.x, move.y, currentPlayer)) {
          board[move.y][move.x] = 0;
          return -PATTERN_WEIGHTS.five;
        }

        const evalScore = this.minimax(board, depth - 1, alpha, beta, true, aiPlayer, humanPlayer);
        board[move.y][move.x] = 0;

        minEval = Math.min(minEval, evalScore);
        beta = Math.min(beta, evalScore);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  // ==================== 局面评估 ====================

  /**
   * 评估整个盘面（从AI视角）。
   *
   * 正值 = AI优势，负值 = 对手优势。
   */
  private evaluateBoard(board: Board, aiPlayer: 1 | 2): number {
    const opponent = aiPlayer === 1 ? 2 : 1;
    return (
      this.evaluatePatterns(board, aiPlayer) -
      this.evaluatePatterns(board, opponent) * 0.95 // 略微偏向防守
    );
  }

  /**
   * 评估某方在盘面上的所有棋型得分。
   */
  private evaluatePatterns(board: Board, player: 1 | 2): number {
    let totalScore = 0;

    for (const [dx, dy] of DIRECTIONS) {
      const visited = new Set<string>();

      for (let y = 0; y < this.boardSize; y++) {
        for (let x = 0; x < this.boardSize; x++) {
          if (board[y][x] !== player) continue;

          const key = `${x},${y},${dx},${dy}`;
          if (visited.has(key)) continue;

          // 扫描连续棋子
          const line = this.scanLine(board, x, y, dx, dy, player);
          if (line.length < 2) continue;

          // 标记已访问
          for (const pos of line) {
            visited.add(`${pos.x},${pos.y},${dx},${dy}`);
          }

          // 评估该棋型
          const score = this.scorePattern(board, line, dx, dy, player);
          totalScore += score;
        }
      }
    }

    return totalScore;
  }

  /**
   * 扫描沿某方向的所有连续同色棋子。
   */
  private scanLine(
    board: Board,
    x: number,
    y: number,
    dx: number,
    dy: number,
    player: 1 | 2
  ): Position[] {
    const line: Position[] = [{ x, y }];

    let cx = x + dx;
    let cy = y + dy;
    while (this.inBounds(cx, cy) && board[cy][cx] === player) {
      line.push({ x: cx, y: cy });
      cx += dx;
      cy += dy;
    }

    return line;
  }

  /**
   * 对某棋型打分。
   */
  private scorePattern(
    board: Board,
    line: Position[],
    dx: number,
    dy: number,
    player: 1 | 2
  ): number {
    const count = line.length;

    // 检查两端状态
    const head = line[0];
    const tail = line[line.length - 1];

    const headOpen = this.isEmpty(board, head.x - dx, head.y - dy);
    const tailOpen = this.isEmpty(board, tail.x + dx, tail.y + dy);
    const openEnds = (headOpen ? 1 : 0) + (tailOpen ? 1 : 0);

    // 根据棋子数和开放端数判定棋型
    if (count >= 5) return PATTERN_WEIGHTS.five;
    if (count === 4) {
      if (openEnds === 2) return PATTERN_WEIGHTS.openFour;
      if (openEnds === 1) return PATTERN_WEIGHTS.closedFour;
      return 0; // 两端被堵，死棋
    }
    if (count === 3) {
      if (openEnds === 2) return PATTERN_WEIGHTS.openThree;
      if (openEnds === 1) return PATTERN_WEIGHTS.closedThree;
      return 0;
    }
    if (count === 2) {
      if (openEnds === 2) return PATTERN_WEIGHTS.openTwo;
      if (openEnds === 1) return PATTERN_WEIGHTS.closedTwo;
      return 0;
    }

    return 0;
  }

  // ==================== 走法生成与排序 ====================

  /**
   * 生成候选走法（仅考虑已有棋子周围的位置）。
   *
   * 策略：只生成与已有棋子距离2格以内的空位，大幅减少搜索空间。
   */
  private generateCandidateMoves(board: Board): Position[] {
    const candidates: Position[] = [];
    const candidateSet = new Set<string>();
    const radius = 2; // 搜索半径

    // 首次落子：下天元
    let hasStone = false;
    for (let y = 0; y < this.boardSize && !hasStone; y++) {
      for (let x = 0; x < this.boardSize && !hasStone; x++) {
        if (board[y][x] !== 0) hasStone = true;
      }
    }
    if (!hasStone) {
      const center = Math.floor(this.boardSize / 2);
      return [{ x: center, y: center }];
    }

    // 已有棋子时，找所有棋子周围的空位
    for (let y = 0; y < this.boardSize; y++) {
      for (let x = 0; x < this.boardSize; x++) {
        if (board[y][x] === 0) continue;

        // 遍历周围 radius 格
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;

            if (!this.inBounds(nx, ny)) continue;
            if (board[ny][nx] !== 0) continue;
            if (candidateSet.has(key)) continue;

            candidateSet.add(key);
            candidates.push({ x: nx, y: ny });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * 走法排序（将更有潜力的走法排在前面，提升剪枝效率）。
   */
  private orderMoves(board: Board, moves: Position[], player: 1 | 2): Position[] {
    const scoredMoves = moves.map((move) => {
      board[move.y][move.x] = player;
      const score = this.quickEvaluate(board, move.x, move.y, player);
      board[move.y][move.x] = 0;
      return { move, score };
    });

    scoredMoves.sort((a, b) => b.score - a.score);
    return scoredMoves.map((sm) => sm.move);
  }

  /**
   * 快速评估某走法的价值（用于走法排序）。
   */
  private quickEvaluate(board: Board, x: number, y: number, player: 1 | 2): number {
    let score = 0;
    const opponent = player === 1 ? 2 : 1;

    // 评估自己落子后的局面
    score += this.evaluatePoint(board, x, y, player) * 1.1;

    // 评估对手的对应位置（防守价值）
    board[y][x] = opponent;
    score += this.evaluatePoint(board, x, y, opponent);
    board[y][x] = player;

    return score;
  }

  /**
   * 评估某点对某方的价值（基于该点形成的棋型）。
   */
  private evaluatePoint(board: Board, x: number, y: number, player: 1 | 2): number {
    let score = 0;

    for (const [dx, dy] of DIRECTIONS) {
      // 正向
      let count = 1;
      let blocked = 0;

      let cx = x + dx;
      let cy = y + dy;
      while (this.inBounds(cx, cy) && board[cy][cx] === player) {
        count++;
        cx += dx;
        cy += dy;
      }
      if (!this.inBounds(cx, cy) || board[cy][cx] !== 0) blocked++;

      // 反向
      cx = x - dx;
      cy = y - dy;
      while (this.inBounds(cx, cy) && board[cy][cx] === player) {
        count++;
        cx -= dx;
        cy -= dy;
      }
      if (!this.inBounds(cx, cy) || board[cy][cx] !== 0) blocked++;

      // 根据连续数和堵头数评分
      if (count >= 5) score += PATTERN_WEIGHTS.five;
      else if (count === 4) {
        if (blocked === 0) score += PATTERN_WEIGHTS.openFour;
        else if (blocked === 1) score += PATTERN_WEIGHTS.closedFour;
      } else if (count === 3) {
        if (blocked === 0) score += PATTERN_WEIGHTS.openThree;
        else if (blocked === 1) score += PATTERN_WEIGHTS.closedThree;
      } else if (count === 2) {
        if (blocked === 0) score += PATTERN_WEIGHTS.openTwo;
        else if (blocked === 1) score += PATTERN_WEIGHTS.closedTwo;
      }
    }

    return score;
  }

  // ==================== 辅助方法 ====================

  /**
   * 查找能立即获胜的走法。
   */
  private findWinningMove(board: Board, player: 1 | 2): Position | null {
    const candidates = this.generateCandidateMoves(board);

    for (const move of candidates) {
      if (board[move.y][move.x] !== 0) continue;

      board[move.y][move.x] = player;
      const isWin = this.checkWinAt(board, move.x, move.y, player);
      board[move.y][move.x] = 0;

      if (isWin) return move;
    }

    return null;
  }

  /**
   * 检查某位置是否形成五连珠。
   */
  private checkWinAt(board: Board, x: number, y: number, player: 1 | 2): boolean {
    for (const [dx, dy] of DIRECTIONS) {
      let count = 1;

      // 正向
      let cx = x + dx;
      let cy = y + dy;
      while (this.inBounds(cx, cy) && board[cy][cx] === player) {
        count++;
        cx += dx;
        cy += dy;
      }

      // 反向
      cx = x - dx;
      cy = y - dy;
      while (this.inBounds(cx, cy) && board[cy][cx] === player) {
        count++;
        cx -= dx;
        cy -= dy;
      }

      if (count >= 5) return true;
    }

    return false;
  }

  /**
   * 检查坐标是否在棋盘范围内。
   */
  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
  }

  /**
   * 检查某位置是否为空。
   */
  private isEmpty(board: Board, x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return board[y][x] === 0;
  }
}
