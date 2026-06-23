/**
 * 黑白棋（Reversi/Othello）AI 引擎
 *
 * 三种难度：
 * - easy:   贪心算法（选翻转最多 + 位置分最高的）
 * - medium: Minimax 深度 3 + 位置权重评估
 * - hard:   权重表 + 终局穷举（剩余 ≤12 格时完全搜索）+ Mobility 评估 + Minimax 深度 6
 *
 * 遵循需求文档第6章 - 黑白棋插件设计需求
 */

import type { Board, Position, ReversiState, AIDifficulty } from '../reversi.types';
import { ReversiEngine } from '../reversi.engine';

/** 8x8 位置权重表（角最高，X-square 和 C-square 为负分） */
const POSITION_WEIGHTS: readonly number[] = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -30, 1, 1, 1, 1, -30, -20,
  10, 1, 5, 2, 2, 5, 1, 10,
  5, 1, 2, 1, 1, 2, 1, 5,
  5, 1, 2, 1, 1, 2, 1, 5,
  10, 1, 5, 2, 2, 5, 1, 10,
  -20, -30, 1, 1, 1, 1, -30, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];

/** 获取位置权重 */
function getWeight(x: number, y: number): number {
  return POSITION_WEIGHTS[x * 8 + y];
}

/** 评估常量 */
const EVAL = {
  /** 终局完全搜索阈值 */
  ENDGAME_THRESHOLD: 12,
  /** 中等难度搜索深度 */
  MEDIUM_DEPTH: 3,
  /** 困难难度搜索深度 */
  HARD_DEPTH: 6,
  /** 最大合法走法数（8x8棋盘） */
  MAX_MOVES: 32,
  /** 行动力（mobility）权重系数 */
  MOBILITY_WEIGHT: 5,
  /** 潜力移动（frontier）权重系数 */
  FRONTIER_WEIGHT: -3,
};

export class ReversiAI {
  private difficulty: AIDifficulty;

  constructor(difficulty: AIDifficulty = 'medium') {
    this.difficulty = difficulty;
  }

  /** 根据当前游戏状态获取AI走法 */
  getMove(state: ReversiState): Position {
    if (state.legalMoves.length === 0) {
      throw new Error('No legal moves available');
    }
    if (state.legalMoves.length === 1) {
      return { ...state.legalMoves[0] };
    }

    switch (this.difficulty) {
      case 'easy':
        return this.getEasyMove(state);
      case 'medium':
        return this.getMediumMove(state);
      case 'hard':
        return this.getHardMove(state);
      default:
        return this.getMediumMove(state);
    }
  }

  // ==================== Easy: 贪心 + 位置权重 ====================

  private getEasyMove(state: ReversiState): Position {
    const player = state.currentPlayer;
    let bestMove = state.legalMoves[0];
    let bestScore = -Infinity;

    for (const move of state.legalMoves) {
      const flipped = ReversiEngine.getFlippedDiscsStatic(
        state.board,
        move.x,
        move.y,
        player
      );
      // 贪心：翻转数量 + 位置权重
      const flipScore = flipped.length * 2;
      const posWeight = getWeight(move.x, move.y);
      const score = flipScore + posWeight;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return { ...bestMove };
  }

  // ==================== Medium: Minimax 深度 3 + 权重评估 ====================

  private getMediumMove(state: ReversiState): Position {
    return this.minimaxMove(state, EVAL.MEDIUM_DEPTH);
  }

  // ==================== Hard: 深度搜索 + 终局穷举 + Mobility ====================

  private getHardMove(state: ReversiState): Position {
    const emptyCount = this.countEmptyCells(state.board);

    // 终局穷举：剩余格子较少时使用完全搜索
    if (emptyCount <= EVAL.ENDGAME_THRESHOLD) {
      return this.endgameSearch(state);
    }

    // 正常搜索，使用较大深度
    return this.minimaxMoveWithMobility(state, EVAL.HARD_DEPTH);
  }

  // ==================== 通用 Minimax 实现 ====================

  /**
   * Minimax + Alpha-Beta 剪枝（基础版，仅用位置权重）
   */
  private minimaxMove(state: ReversiState, depth: number): Position {
    const player = state.currentPlayer;
    const opponent = player === 1 ? 2 : 1;
    let bestMove = state.legalMoves[0];
    let bestScore = -Infinity;
    const alpha = -Infinity;
    const beta = Infinity;

    // 对合法走法排序（用简单启发式），提升剪枝效率
    const sortedMoves = this.sortMoves(state.legalMoves, state.board, player);

    for (const move of sortedMoves) {
      const newBoard = this.simulateMove(state.board, move, player);
      const score = this.minimax(
        newBoard,
        depth - 1,
        alpha,
        beta,
        false,
        player,
        opponent
      );

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return { ...bestMove };
  }

  /**
   * Minimax + Alpha-Beta 剪枝（含 Mobility 评估，困难模式）
   */
  private minimaxMoveWithMobility(state: ReversiState, depth: number): Position {
    const player = state.currentPlayer;
    const opponent = player === 1 ? 2 : 1;
    let bestMove = state.legalMoves[0];
    let bestScore = -Infinity;
    const alpha = -Infinity;
    const beta = Infinity;

    const sortedMoves = this.sortMoves(state.legalMoves, state.board, player);

    for (const move of sortedMoves) {
      const newBoard = this.simulateMove(state.board, move, player);
      const score = this.minimaxWithMobility(
        newBoard,
        depth - 1,
        alpha,
        beta,
        false,
        player,
        opponent
      );

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return { ...bestMove };
  }

  /**
   * Minimax 递归（基础评估函数）
   */
  private minimax(
    board: Board,
    depth: number,
    alpha: number,
    beta: number,
    isMaximizing: boolean,
    aiPlayer: 1 | 2,
    currentPlayer: 1 | 2
  ): number {
    const opponent = currentPlayer === 1 ? 2 : 1;
    const moves = ReversiEngine.getLegalMovesStatic(board, currentPlayer);

    // 终局条件：深度为0或游戏结束
    if (depth === 0 || this.isTerminal(board, moves)) {
      return this.evaluateBoard(board, aiPlayer);
    }

    if (moves.length === 0) {
      // 当前玩家无法走棋，换对手
      return this.minimax(board, depth - 1, alpha, beta, !isMaximizing, aiPlayer, opponent);
    }

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (const move of moves) {
        const newBoard = this.simulateMove(board, move, currentPlayer);
        const score = this.minimax(
          newBoard,
          depth - 1,
          alpha,
          beta,
          false,
          aiPlayer,
          opponent
        );
        maxScore = Math.max(maxScore, score);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break; // Alpha-Beta 剪枝
      }
      return maxScore;
    } else {
      let minScore = Infinity;
      for (const move of moves) {
        const newBoard = this.simulateMove(board, move, currentPlayer);
        const score = this.minimax(
          newBoard,
          depth - 1,
          alpha,
          beta,
          true,
          aiPlayer,
          opponent
        );
        minScore = Math.min(minScore, score);
        beta = Math.min(beta, score);
        if (beta <= alpha) break; // Alpha-Beta 剪枝
      }
      return minScore;
    }
  }

  /**
   * Minimax 递归（含 Mobility 评估）
   */
  private minimaxWithMobility(
    board: Board,
    depth: number,
    alpha: number,
    beta: number,
    isMaximizing: boolean,
    aiPlayer: 1 | 2,
    currentPlayer: 1 | 2
  ): number {
    const opponent = currentPlayer === 1 ? 2 : 1;
    const moves = ReversiEngine.getLegalMovesStatic(board, currentPlayer);

    if (depth === 0 || this.isTerminal(board, moves)) {
      return this.evaluateWithMobility(board, aiPlayer);
    }

    if (moves.length === 0) {
      return this.minimaxWithMobility(
        board,
        depth - 1,
        alpha,
        beta,
        !isMaximizing,
        aiPlayer,
        opponent
      );
    }

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (const move of moves) {
        const newBoard = this.simulateMove(board, move, currentPlayer);
        const score = this.minimaxWithMobility(
          newBoard,
          depth - 1,
          alpha,
          beta,
          false,
          aiPlayer,
          opponent
        );
        maxScore = Math.max(maxScore, score);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
      return maxScore;
    } else {
      let minScore = Infinity;
      for (const move of moves) {
        const newBoard = this.simulateMove(board, move, currentPlayer);
        const score = this.minimaxWithMobility(
          newBoard,
          depth - 1,
          alpha,
          beta,
          true,
          aiPlayer,
          opponent
        );
        minScore = Math.min(minScore, score);
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
      return minScore;
    }
  }

  // ==================== 终局穷举 ====================

  /**
   * 终局完全搜索（Negamax + Alpha-Beta，追求最大化净胜子数）
   */
  private endgameSearch(state: ReversiState): Position {
    const player = state.currentPlayer;
    const opponent = player === 1 ? 2 : 1;
    let bestMove = state.legalMoves[0];
    let bestScore = -Infinity;

    for (const move of state.legalMoves) {
      const newBoard = this.simulateMove(state.board, move, player);
      const score = this.negamaxEndgame(
        newBoard,
        -Infinity,
        Infinity,
        1,
        player,
        opponent
      );

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return { ...bestMove };
  }

  /**
   * 终局 Negamax 完全搜索
   * @param color - 1=从AI视角，-1=从对手视角
   */
  private negamaxEndgame(
    board: Board,
    alpha: number,
    beta: number,
    color: 1 | -1,
    aiPlayer: 1 | 2,
    currentPlayer: 1 | 2
  ): number {
    const opponent = currentPlayer === 1 ? 2 : 1;
    const moves = ReversiEngine.getLegalMovesStatic(board, currentPlayer);

    // 双方都无法走棋，终局
    if (moves.length === 0) {
      const oppMoves = ReversiEngine.getLegalMovesStatic(board, opponent);
      if (oppMoves.length === 0) {
        // 游戏结束，计算净胜子数
        const counts = ReversiEngine.countDiscsStatic(board);
        const aiDiscs = aiPlayer === 1 ? counts.black : counts.white;
        const oppDiscs = aiPlayer === 1 ? counts.white : counts.black;
        return color * (aiDiscs - oppDiscs);
      }
      // 当前玩家pass，换对手
      return this.negamaxEndgame(board, -beta, -alpha, -color as 1 | -1, aiPlayer, opponent);
    }

    let bestScore = -Infinity;
    for (const move of moves) {
      const newBoard = this.simulateMove(board, move, currentPlayer);
      const score = -this.negamaxEndgame(newBoard, -beta, -alpha, -color as 1 | -1, aiPlayer, opponent);
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }

    return color * bestScore;
  }

  // ==================== 评估函数 ====================

  /**
   * 基础评估函数：仅使用位置权重表
   */
  private evaluateBoard(board: Board, player: 1 | 2): number {
    const opponent = player === 1 ? 2 : 1;
    let score = 0;

    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        const cell = board[x][y];
        const weight = getWeight(x, y);
        if (cell === player) {
          score += weight;
        } else if (cell === opponent) {
          score -= weight;
        }
      }
    }

    return score;
  }

  /**
   * 高级评估函数：位置权重 + 行动力（Mobility）+ 前沿子（Frontier）
   */
  private evaluateWithMobility(board: Board, player: 1 | 2): number {
    const opponent = player === 1 ? 2 : 1;

    // 1. 位置权重
    let posScore = 0;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        const cell = board[x][y];
        const weight = getWeight(x, y);
        if (cell === player) {
          posScore += weight;
        } else if (cell === opponent) {
          posScore -= weight;
        }
      }
    }

    // 2. 行动力（Mobility）：合法走法数量差
    const playerMoves = ReversiEngine.getLegalMovesStatic(board, player).length;
    const opponentMoves = ReversiEngine.getLegalMovesStatic(board, opponent).length;
    let mobilityScore = 0;
    if (playerMoves + opponentMoves !== 0) {
      mobilityScore = EVAL.MOBILITY_WEIGHT * ((playerMoves - opponentMoves) / (playerMoves + opponentMoves));
    }

    // 3. 前沿子（Frontier）：与空位相邻的棋子数（越少越好）
    const playerFrontier = this.countFrontierDiscs(board, player);
    const opponentFrontier = this.countFrontierDiscs(board, opponent);
    let frontierScore = 0;
    if (playerFrontier + opponentFrontier !== 0) {
      frontierScore = EVAL.FRONTIER_WEIGHT * ((playerFrontier - opponentFrontier) / (playerFrontier + opponentFrontier));
    }

    return posScore + mobilityScore + frontierScore;
  }

  // ==================== 辅助方法 ====================

  /** 模拟落子，返回新棋盘 */
  private simulateMove(board: Board, move: Position, player: 1 | 2): Board {
    const newBoard = board.map((row) => [...row]) as Board;
    const flipped = ReversiEngine.getFlippedDiscsStatic(newBoard, move.x, move.y, player);

    newBoard[move.x][move.y] = player;
    for (const f of flipped) {
      newBoard[f.x][f.y] = player;
    }

    return newBoard;
  }

  /** 判断是否为终局状态 */
  private isTerminal(board: Board, currentMoves: Position[]): boolean {
    if (currentMoves.length > 0) return false;

    // 检查双方是否都无法走棋
    const blackMoves = ReversiEngine.getLegalMovesStatic(board, 1);
    const whiteMoves = ReversiEngine.getLegalMovesStatic(board, 2);
    return blackMoves.length === 0 && whiteMoves.length === 0;
  }

  /** 统计空格子数 */
  private countEmptyCells(board: Board): number {
    let count = 0;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        if (board[x][y] === 0) count++;
      }
    }
    return count;
  }

  /** 统计前沿子数（与空位相邻的棋子） */
  private countFrontierDiscs(board: Board, player: 1 | 2): number {
    let count = 0;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        if (board[x][y] !== player) continue;
        // 检查8个方向是否有空位
        for (const [dx, dy] of ReversiEngine.DIRECTIONS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && board[nx][ny] === 0) {
            count++;
            break;
          }
        }
      }
    }
    return count;
  }

  /**
   * 对走法进行排序（用于提升Alpha-Beta剪枝效率）
   * 优先评估角落、边缘和高权重位置
   */
  private sortMoves(moves: Position[], board: Board, player: 1 | 2): Position[] {
    return [...moves].sort((a, b) => {
      const weightA = getWeight(a.x, a.y);
      const weightB = getWeight(b.x, b.y);
      const flipA = ReversiEngine.getFlippedDiscsStatic(board, a.x, a.y, player).length;
      const flipB = ReversiEngine.getFlippedDiscsStatic(board, b.x, b.y, player).length;
      // 权重为主，翻转数为辅
      return weightB - weightA || flipB - flipA;
    });
  }
}
