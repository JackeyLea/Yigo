/**
 * Go (围棋) Game Types
 * Defines all type interfaces and enums for the Go game plugin
 */

/** Supported board sizes: 9x9, 13x13, 19x19 */
export type BoardSize = 9 | 13 | 19;

/** Cell state: 0 = empty, 1 = black, 2 = white */
export type Cell = 0 | 1 | 2;

/** 2D board representation */
export type Board = Cell[][];

/** Player identifier: 1 = black, 2 = white */
export type Player = 1 | 2;

/** Game phase */
export type GamePhase = 'playing' | 'scoring' | 'ended';

/** Position on the board */
export interface Position {
  x: number;
  y: number;
}

/** A single move record */
export interface GoMove {
  x: number;
  y: number;
  player: Player;
  type: 'place' | 'pass' | 'mark_dead' | 'mark_alive';
  captured: Position[]; // Stones captured by this move
  timestamp: number;
}

/** SGF (Smart Game Format) node for import/export */
export interface SGFNode {
  properties: Record<string, string[]>;
  children: SGFNode[];
}

/** Complete game state */
export interface GoState {
  board: Board;
  boardSize: BoardSize;
  currentPlayer: Player;
  moveHistory: GoMove[];
  capturedStones: { black: number; white: number };
  koPosition: Position | null;
  consecutivePasses: number;
  komi: number;
  handicap: number;
  phase: GamePhase;
  deadStones: Position[];
  territory: { black: number; white: number };
  score: { black: number; white: number };
  winner: Player | null;
  isDraw: boolean;
  gameOver: boolean;
}

/** Game configuration options */
export interface GoGameOptions {
  boardSize?: BoardSize;
  komi?: number;
  handicap?: number;
  aiDifficulty?: 'beginner' | 'elementary' | 'intermediate' | 'advanced';
}

/** AI difficulty presets */
export interface AIDifficultyConfig {
  name: string;
  simulations: number;
  useHeuristics: boolean;
  explorationConstant: number;
  maxPlayoutDepth: number;
}

/** Settings schema entry */
export interface SettingSchemaEntry<T = unknown> {
  key: string;
  type: 'number' | 'string' | 'boolean' | 'enum';
  default: T;
  description: string;
  category: 'game' | 'ai' | 'ui' | 'rules';
  validate: (value: unknown) => boolean;
  options?: T[];
  min?: number;
  max?: number;
}

/** Plugin settings schema */
export interface GoSettings {
  defaultBoardSize: BoardSize;
  defaultKomi: number;
  defaultHandicap: number;
  defaultAIDifficulty: 'beginner' | 'elementary' | 'intermediate' | 'advanced';
  enableSuperKo: boolean;
  enableScoring: boolean;
  enableAI: boolean;
  enableSGF: boolean;
  theme: 'classic' | 'modern' | 'dark';
  showCoordinates: boolean;
  showLastMove: boolean;
  showMoveNumber: boolean;
  soundEnabled: boolean;
  animationEnabled: boolean;
}

/** Territory analysis result */
export interface TerritoryResult {
  blackTerritory: Position[];
  whiteTerritory: Position[];
  dame: Position[];
  blackScore: number;
  whiteScore: number;
}

/** Score detail for endgame */
export interface ScoreDetail {
  territory: { black: number; white: number };
  captures: { black: number; white: number };
  komi: number;
  handicap: number;
  final: { black: number; white: number };
  winner: Player | null;
  margin: number;
}

/** Game event callbacks */
export interface GoGameEvents {
  onMove?: (move: GoMove, state: GoState) => void;
  onCapture?: (positions: Position[], by: Player) => void;
  onKo?: (position: Position) => void;
  onPass?: (player: Player) => void;
  onGameEnd?: (state: GoState) => void;
  onPhaseChange?: (phase: GamePhase) => void;
  onScoreUpdate?: (score: ScoreDetail) => void;
}

/** Union-Find (Disjoint Set Union) data structure for group management */
export interface UnionFind {
  parent: number[];
  rank: number[];
  find(x: number): number;
  union(x: number, y: number): void;
  connected(x: number, y: number): boolean;
  reset(size: number): void;
}

/** MCTS Node for AI search */
export interface MCTSNode {
  state: GoState;
  parent: MCTSNode | null;
  children: MCTSNode[];
  move: Position | null; // Move that led to this node
  visits: number;
  wins: number;
  untriedMoves: Position[];
  playerJustMoved: Player;
  isTerminal: boolean;
}
