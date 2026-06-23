/**
 * 五子棋（Gomoku）类型定义
 *
 * 定义五子棋游戏所需的所有核心类型和接口，包括棋盘、棋子、状态、走法等。
 */

/** 支持的棋盘尺寸：标准15路或19路 */
export type BoardSize = 15 | 19;

/** 棋盘格子状态：0=空, 1=黑棋, 2=白棋 */
export type Cell = 0 | 1 | 2;

/** 棋盘二维数组，board[y][x] 表示坐标 (x, y) 处的棋子 */
export type Board = Cell[][];

/** 完整的五子棋游戏状态 */
export interface GomokuState {
  /** 当前棋盘状态 */
  board: Board;
  /** 当前执子方：1=黑棋先手, 2=白棋后手 */
  currentPlayer: 1 | 2;
  /** 走子历史记录 */
  moveHistory: Move[];
  /** 获胜方：0=和棋, 1=黑胜, 2=白胜, null=未结束 */
  winner: 0 | 1 | 2 | null;
  /** 是否为和棋 */
  isDraw: boolean;
  /** 已走步数 */
  moveCount: number;
  /** 最后一步走法 */
  lastMove: Move | null;
  /** 当前禁手位置列表（仅黑方适用） */
  forbiddenMoves: Position[];
  /** 游戏是否已结束 */
  gameOver: boolean;
}

/** 单步走法记录 */
export interface Move {
  /** 横坐标（0-based，从左到右） */
  x: number;
  /** 纵坐标（0-based，从上到下） */
  y: number;
  /** 执子方：1=黑, 2=白 */
  player: 1 | 2;
  /** 走子时间戳 */
  timestamp: number;
}

/** 二维坐标位置 */
export interface Position {
  /** 横坐标（0-based） */
  x: number;
  /** 纵坐标（0-based） */
  y: number;
}

/** 禁手类型 */
export type ForbiddenType = 'three-three' | 'four-four' | 'overline';

/** 棋型模式（用于AI评估） */
export type PatternType =
  | 'five'        // 五连（胜）
  | 'open-four'   // 活四
  | 'closed-four' // 冲四
  | 'open-three'  // 活三
  | 'closed-three'// 眠三
  | 'open-two'    // 活二
  | 'closed-two'; // 眠二

/** AI难度级别 */
export type AIDifficulty = 'easy' | 'medium' | 'hard';

/** 插件元信息 */
export interface PluginMeta {
  /** 插件唯一标识 */
  pluginId: string;
  /** 插件显示名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 游戏类型 */
  gameType: string;
  /** 游戏分类 */
  category: string;
  /** 最少玩家数 */
  minPlayers: number;
  /** 最多玩家数 */
  maxPlayers: number;
  /** 入口类名 */
  entryClass: string;
  /** 支持的游戏模式 */
  supportedModes: string[];
}
