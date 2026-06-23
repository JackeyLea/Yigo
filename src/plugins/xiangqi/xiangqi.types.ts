/**
 * Xiangqi (Chinese Chess) Type Definitions
 *
 * Defines all types, interfaces and enums used by the Xiangqi game plugin.
 */

/** The seven piece types in Xiangqi */
export type PieceType = 'general' | 'advisor' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier';

/** Player 1 = Red (红方, moves first), Player 2 = Black (黑方) */
export type Player = 1 | 2;

/** A piece on the board */
export interface Piece {
  type: PieceType;
  player: Player;
  id: string; // unique identifier, e.g. "R1-general", "B2-horse"
}

/** Board coordinate position */
export interface Position {
  x: number; // 0-8 (files, 九路)
  y: number; // 0-9 (ranks, 十行)
}

/** A move record */
export interface XiangqiMove {
  from: Position;
  to: Position;
  piece: Piece;
  captured: Piece | null;
  isCheck: boolean;
  isCheckmate: boolean;
  timestamp: number;
}

/** Piece values for evaluation (in centipawns) */
export const PIECE_VALUES: Record<PieceType, number> = {
  general: 10000,
  chariot: 500,
  horse: 300,
  cannon: 300,
  advisor: 100,
  elephant: 100,
  soldier: 50,
};

/** Complete game state */
export interface XiangqiState {
  board: (Piece | null)[][]; // 9 columns x 10 rows
  currentPlayer: Player;
  moveHistory: XiangqiMove[];
  capturedPieces: Piece[];
  isCheck: boolean; // current player is in check
  isCheckmate: boolean;
  isStalemate: boolean; // 困毙 - no legal moves
  isDraw: boolean;
  winner: Player | null;
  gameOver: boolean;
  moveCount: number;
  lastMove: XiangqiMove | null;
  // Repetition detection
  positionHashes: string[];
  repetitionCount: number;
  // Natural move limit (50-move rule variant)
  movesSinceCapture: number;
}

/** Opening book entry */
export interface OpeningEntry {
  name: string;
  category: string;
  moves: string[]; // UCI-like notation e.g. "c2c4"
  description: string;
}

/** Opening book database structure */
export interface OpeningBook {
  [fenPrefix: string]: OpeningEntry[];
}

/** Endgame tablebase entry */
export interface EndgameEntry {
  name: string;
  attackerPieces: { type: PieceType; count: number }[];
  defenderPieces: { type: PieceType; count: number }[];
  result: 'win' | 'draw' | 'loss';
  technique: string;
  keyPositions: string[]; // FEN positions
}

/** AI difficulty configuration */
export interface AIConfig {
  depth: number;
  useOpeningBook: boolean;
  useEndgameTable: boolean;
  randomness: number; // 0-1, chance of random move
}

/** Plugin settings */
export interface XiangqiSettings {
  aiDifficulty: 'easy' | 'medium' | 'hard' | 'master';
  showLegalMoves: boolean;
  showLastMove: boolean;
  enableSound: boolean;
  boardTheme: 'wood' | 'green' | 'blue';
  pieceStyle: 'traditional' | 'simplified';
  animationSpeed: number;
  enableOpeningBook: boolean;
}

/** Zobrist hash table for position hashing */
export interface ZobristTable {
  pieces: number[][][][]; // [pieceType][player][x][y]
  player: number;
}

/** FEN notation helpers */
export const FEN_INITIAL = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

/** Converts piece type to FEN character */
export const PIECE_TO_FEN: Record<PieceType, string> = {
  general: 'k',
  advisor: 'a',
  elephant: 'b',
  horse: 'n',
  chariot: 'r',
  cannon: 'c',
  soldier: 'p',
};

/** Converts FEN character to piece type */
export const FEN_TO_PIECE: Record<string, PieceType> = {
  k: 'general',
  a: 'advisor',
  b: 'elephant',
  n: 'horse',
  r: 'chariot',
  c: 'cannon',
  p: 'soldier',
};
