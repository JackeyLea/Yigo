/**
 * 黑白棋（Reversi/Othello）类型定义
 * 遵循需求文档第6章 - 黑白棋插件设计需求
 */

/** 棋盘格子状态：0=空, 1=黑, 2=白 */
export type Cell = 0 | 1 | 2;

/** 8x8 棋盘 */
export type Board = Cell[][];

/** 坐标位置 */
export interface Position {
  x: number;
  y: number;
}

/** 单步走棋记录 */
export interface ReversiMove {
  x: number;
  y: number;
  player: 1 | 2;
  /** 被翻转的棋子位置列表 */
  flipped: Position[];
  /** 时间戳 */
  timestamp: number;
}

/** 游戏完整状态 */
export interface ReversiState {
  /** 当前棋盘 */
  board: Board;
  /** 当前玩家（1=黑, 2=白） */
  currentPlayer: 1 | 2;
  /** 走棋历史 */
  moveHistory: ReversiMove[];
  /** 当前合法走法 */
  legalMoves: Position[];
  /** 黑棋数量 */
  blackCount: number;
  /** 白棋数量 */
  whiteCount: number;
  /** 获胜方：0=平局, 1=黑胜, 2=白胜, null=未结束 */
  winner: 0 | 1 | 2 | null;
  /** 是否平局 */
  isDraw: boolean;
  /** 连续Pass次数（双方都无法落子时游戏结束） */
  passCount: number;
  /** 游戏是否结束 */
  gameOver: boolean;
}

/** AI 难度级别 */
export type AIDifficulty = 'easy' | 'medium' | 'hard';

/** 插件配置选项 */
export interface ReversiPluginOptions {
  /** 是否启用AI对手 */
  enableAI: boolean;
  /** AI难度 */
  aiDifficulty: AIDifficulty;
  /** AI执子颜色：1=黑, 2=白, null=不使用AI */
  aiPlayer: 1 | 2 | null;
  /** 是否允许悔棋 */
  allowUndo: boolean;
  /** 是否显示合法走法提示 */
  showHints: boolean;
  /** 走棋限时（秒），0=不限时 */
  moveTimeout: number;
}

/** 游戏事件类型 */
export type ReversiEventType =
  | 'move'
  | 'pass'
  | 'undo'
  | 'gameover'
  | 'playerChanged';

/** 游戏事件 */
export interface ReversiEvent {
  type: ReversiEventType;
  state: ReversiState;
  move?: ReversiMove;
}

/** 事件监听器 */
export type ReversiEventListener = (event: ReversiEvent) => void;
