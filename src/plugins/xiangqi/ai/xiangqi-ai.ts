/**
 * Xiangqi AI Engine
 *
 * Implements a configurable Minimax search with alpha-beta pruning,
 * piece-square tables, and opening book integration.
 *
 * Difficulty levels:
 *   easy   – depth 2 + random factor
 *   medium – depth 4 + evaluation
 *   hard   – depth 6 + opening book
 *   master – depth 8 + opening book + endgame table
 */

import {
  type XiangqiState,
  type Position,
  type PieceType,
  type Player,
  PIECE_VALUES,
} from '../xiangqi.types';
import { XiangqiEngine } from '../xiangqi.engine';
import { OPENING_BOOK, findOpeningMove } from '../xiangqi-opening-book';
import { ENDGAME_TABLE, findEndgameMove } from '../xiangqi-endgame';

// ---------------------------------------------------------------------------
// Configuration per difficulty
// ---------------------------------------------------------------------------

interface DifficultyConfig {
  depth: number;
  randomness: number; // 0..1 probability of picking a suboptimal move
  useOpeningBook: boolean;
  useEndgameTable: boolean;
}

const CONFIGS: Record<string, DifficultyConfig> = {
  easy:   { depth: 2, randomness: 0.15, useOpeningBook: false, useEndgameTable: false },
  medium: { depth: 4, randomness: 0.05, useOpeningBook: false, useEndgameTable: false },
  hard:   { depth: 6, randomness: 0.02, useOpeningBook: true,  useEndgameTable: false },
  master: { depth: 8, randomness: 0.0,  useOpeningBook: true,  useEndgameTable: true },
};

// ---------------------------------------------------------------------------
// Piece-square tables (positional bonuses)
// Values are centipawn adjustments from -50..+50.
// Tables are indexed [y][x] with Red starting at bottom (y=0).
// For Black we mirror the board vertically.
// ---------------------------------------------------------------------------

// clang-format off
const PST_GENERAL: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 10, 15, 10, 0, 0, 0],
  [0, 0, 0, 5, 10, 5, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const PST_ADVISOR: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 20, 0, 20, 0, 0, 0],
  [0, 0, 0, 0, 25, 0, 0, 0, 0],
  [0, 0, 0, 20, 0, 20, 0, 0, 0],
];

const PST_ELEPHANT: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 20, 0, 0, 0, 20, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 20, 0, 0, 0, 20, 0, 0],
];

const PST_HORSE: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 5, 0, 0, 0, 5, 0, 0],
  [0, 5, 0, 10, 0, 10, 0, 5, 0],
  [0, 0, 10, 0, 15, 0, 10, 0, 0],
  [5, 0, 0, 15, 0, 15, 0, 0, 5],
  [0, 0, 10, 0, 15, 0, 10, 0, 0],
  [0, 5, 0, 10, 0, 10, 0, 5, 0],
  [0, 0, 5, 0, 0, 0, 5, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const PST_CHARIOT: number[][] = [
  [0, 0, 0, 10, 10, 10, 0, 0, 0],
  [0, 0, 0, 0, 15, 0, 0, 0, 0],
  [0, 0, 0, 0, 20, 0, 0, 0, 0],
  [0, 0, 0, 0, 25, 0, 0, 0, 0],
  [0, 0, 0, 0, 25, 0, 0, 0, 0],
  [0, 0, 0, 0, 25, 0, 0, 0, 0],
  [0, 0, 0, 0, 20, 0, 0, 0, 0],
  [0, 0, 0, 0, 15, 0, 0, 0, 0],
  [0, 0, 0, 0, 10, 0, 0, 0, 0],
  [0, 0, 0, 10, 10, 10, 0, 0, 0],
];

const PST_CANNON: number[][] = [
  [0, 0, 0, 0, 10, 0, 0, 0, 0],
  [0, 0, 0, 15, 0, 15, 0, 0, 0],
  [0, 0, 15, 0, 20, 0, 15, 0, 0],
  [0, 0, 0, 20, 0, 20, 0, 0, 0],
  [0, 15, 0, 0, 20, 0, 0, 15, 0],
  [0, 0, 0, 20, 0, 20, 0, 0, 0],
  [0, 0, 15, 0, 20, 0, 15, 0, 0],
  [0, 0, 0, 15, 0, 15, 0, 0, 0],
  [0, 0, 0, 0, 10, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const PST_SOLDIER: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [20, 30, 40, 50, 60, 50, 40, 30, 20],
  [30, 40, 50, 60, 70, 60, 50, 40, 30],
  [20, 30, 40, 50, 60, 50, 40, 30, 20],
  [10, 20, 30, 40, 50, 40, 30, 20, 10],
  [0, 10, 20, 30, 40, 30, 20, 10, 0],
  [0, 0, 0, 10, 20, 10, 0, 0, 0],
];

const PST: Record<PieceType, number[][]> = {
  general: PST_GENERAL,
  advisor: PST_ADVISOR,
  elephant: PST_ELEPHANT,
  horse: PST_HORSE,
  chariot: PST_CHARIOT,
  cannon: PST_CANNON,
  soldier: PST_SOLDIER,
};

// clang-format on

function getPositionBonus(type: PieceType, x: number, y: number, player: Player): number {
  const table = PST[type];
  if (!table) return 0;
  if (player === 1) {
    return table[y]?.[x] ?? 0;
  }
  // Black: mirror vertically
  const my = 9 - y;
  return table[my]?.[x] ?? 0;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function evaluateState(engine: XiangqiEngine, state: XiangqiState, aiPlayer: Player): number {
  if (state.isCheckmate) {
    return state.winner === aiPlayer ? 50000 : -50000;
  }
  if (state.isStalemate || state.isDraw) {
    return 0;
  }

  let score = 0;
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 10; y++) {
      const p = state.board[x][y];
      if (!p) continue;
      const sign = p.player === aiPlayer ? 1 : -1;
      const value = PIECE_VALUES[p.type] + getPositionBonus(p.type, x, y, p.player);
      score += sign * value;
    }
  }

  // Mobility bonus
  const myMoves = engine.getAllLegalMoves(aiPlayer).length;
  const opMoves = engine.getAllLegalMoves(aiPlayer === 1 ? 2 : 1).length;
  score += (myMoves - opMoves) * 5;

  // Check bonus
  const opp = aiPlayer === 1 ? 2 : 1;
  if (engine.isInCheck(opp)) score += 80;
  if (engine.isInCheck(aiPlayer)) score -= 80;

  return score;
}

// ---------------------------------------------------------------------------
// Move ordering – improves alpha-beta efficiency
// ---------------------------------------------------------------------------

function orderMoves(
  engine: XiangqiEngine,
  moves: { from: Position; to: Position }[],
  _state: XiangqiState,
): { from: Position; to: Position }[] {
  return moves.sort((a, b) => {
    const capA = engine.getState().board[a.to.x][a.to.y];
    const capB = engine.getState().board[b.to.x][b.to.y];
    const valA = capA ? PIECE_VALUES[capA.type] : 0;
    const valB = capB ? PIECE_VALUES[capB.type] : 0;
    return valB - valA; // captures first
  });
}

// ---------------------------------------------------------------------------
// AI class
// ---------------------------------------------------------------------------

export class XiangqiAI {
  private config: DifficultyConfig;
  private aiPlayer: Player = 2; // AI defaults to Black

  constructor(difficulty: 'easy' | 'medium' | 'hard' | 'master' = 'medium') {
    this.config = CONFIGS[difficulty] ?? CONFIGS.medium;
  }

  setPlayer(player: Player): void {
    this.aiPlayer = player;
  }

  getMove(state: XiangqiState): { from: Position; to: Position } {
    const engine = new XiangqiEngine();
    // Reconstruct state into engine
    engine.importFromFEN(this.stateToFEN(state));

    // 1. Opening book
    if (this.config.useOpeningBook && state.moveCount < 12) {
      const bookMove = findOpeningMove(state);
      if (bookMove) return bookMove;
    }

    // 2. Endgame table
    if (this.config.useEndgameTable) {
      const egMove = findEndgameMove(state);
      if (egMove) return egMove;
    }

    // 3. Minimax search
    const moves = engine.getAllLegalMoves(this.aiPlayer);
    if (moves.length === 0) {
      throw new Error('AI has no legal moves');
    }

    // Easy: occasional random move
    if (this.config.randomness > 0 && Math.random() < this.config.randomness) {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    const ordered = orderMoves(engine, moves, state);
    let bestScore = -Infinity;
    let bestMove = ordered[0];
    const currentPlayer = this.aiPlayer;

    for (const move of ordered) {
      const fenBefore = engine.exportToFEN();
      const ok = engine.movePiece(move.from.x, move.from.y, move.to.x, move.to.y);
      if (!ok) continue;

      const score = this.minimax(
        engine,
        this.config.depth - 1,
        -Infinity,
        Infinity,
        false,
        currentPlayer,
      );

      // Undo
      engine.importFromFEN(fenBefore);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    // Easy/Medium: small random perturbation on equal-ish moves
    if (this.config.randomness > 0) {
      const candidates = ordered.filter(m => {
        // quick re-eval not needed – just pick near-best
        return true;
      });
      if (candidates.length > 1 && Math.random() < this.config.randomness * 2) {
        return candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
      }
    }

    return bestMove;
  }

  // -----------------------------------------------------------------
  // Minimax with alpha-beta pruning
  // -----------------------------------------------------------------

  private minimax(
    engine: XiangqiEngine,
    depth: number,
    alpha: number,
    beta: number,
    isMaximizing: boolean,
    aiPlayer: Player,
  ): number {
    const state = engine.getState();

    if (depth === 0 || state.gameOver) {
      return evaluateState(engine, state, aiPlayer);
    }

    const player = state.currentPlayer;
    const moves = engine.getAllLegalMoves(player);
    if (moves.length === 0) {
      // No moves => checkmate or stalemate already flagged
      return evaluateState(engine, state, aiPlayer);
    }

    const ordered = orderMoves(engine, moves, state);

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of ordered) {
        const fenBefore = engine.exportToFEN();
        engine.movePiece(move.from.x, move.from.y, move.to.x, move.to.y);
        const evalScore = this.minimax(engine, depth - 1, alpha, beta, false, aiPlayer);
        engine.importFromFEN(fenBefore);
        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of ordered) {
        const fenBefore = engine.exportToFEN();
        engine.movePiece(move.from.x, move.from.y, move.to.x, move.to.y);
        const evalScore = this.minimax(engine, depth - 1, alpha, beta, true, aiPlayer);
        engine.importFromFEN(fenBefore);
        minEval = Math.min(minEval, evalScore);
        beta = Math.min(beta, evalScore);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  // -----------------------------------------------------------------
  // Helper: convert state back to FEN for engine reconstruction
  // -----------------------------------------------------------------

  private stateToFEN(state: XiangqiState): string {
    const rows: string[] = [];
    for (let y = 9; y >= 0; y--) {
      let empty = 0;
      let rowStr = '';
      for (let x = 0; x < 9; x++) {
        const p = state.board[x][y];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) { rowStr += empty; empty = 0; }
          const map: Record<PieceType, string> = {
            general: 'k', advisor: 'a', elephant: 'b', horse: 'n',
            chariot: 'r', cannon: 'c', soldier: 'p',
          };
          let ch = map[p.type];
          if (p.player === 1) ch = ch.toUpperCase();
          rowStr += ch;
        }
      }
      if (empty > 0) rowStr += empty;
      rows.push(rowStr);
    }
    const turn = state.currentPlayer === 1 ? 'w' : 'b';
    return `${rows.join('/')} ${turn}`;
  }
}

export default XiangqiAI;
