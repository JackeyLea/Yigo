/**
 * 五子棋引擎（核心逻辑）
 *
 * 提供完整的五子棋游戏规则实现：
 * - 落子、悔棋、重置
 * - 胜负判定（五连珠）
 * - 禁手规则（三三禁手、四四禁手、长连禁手，仅黑方）
 * - 和棋判定（棋盘满）
 * - 标准记谱格式转换
 */

import type {
  BoardSize,
  Cell,
  Board,
  GomokuState,
  Move,
  Position,
  ForbiddenType,
} from './gomoku.types';

/** 八方向偏移量 */
const DIRECTIONS: Array<[number, number]> = [
  [0, 1],   // 上
  [0, -1],  // 下
  [1, 0],   // 右
  [-1, 0],  // 左
  [1, 1],   // 右上
  [-1, -1], // 左下
  [1, -1],  // 右下
  [-1, 1],  // 左上
];

/** 四个轴向（每对方向构成一个轴） */
const AXES: Array<Array<[number, number]>> = [
  [[0, 1], [0, -1]],   // 竖向
  [[1, 0], [-1, 0]],   // 横向
  [[1, 1], [-1, -1]],  // 主对角线
  [[1, -1], [-1, 1]],  // 副对角线
];

export class GomokuEngine {
  private boardSize: BoardSize;
  private useForbidden: boolean;
  private board: Board;
  private currentPlayer: 1 | 2;
  private moveHistory: Move[];
  private winner: 0 | 1 | 2 | null;
  private isDraw: boolean;
  private moveCount: number;
  private lastMove: Move | null;
  private gameOver: boolean;
  private forbiddenMoves: Position[];

  constructor(boardSize: BoardSize = 15, useForbidden: boolean = true) {
    this.boardSize = boardSize;
    this.useForbidden = useForbidden;
    this.board = this.createEmptyBoard();
    this.currentPlayer = 1; // 黑方先手
    this.moveHistory = [];
    this.winner = null;
    this.isDraw = false;
    this.moveCount = 0;
    this.lastMove = null;
    this.gameOver = false;
    this.forbiddenMoves = [];
  }

  /** 获取当前游戏状态快照 */
  getState(): GomokuState {
    return {
      board: this.board.map((row) => [...row]),
      currentPlayer: this.currentPlayer,
      moveHistory: this.moveHistory.map((m) => ({ ...m })),
      winner: this.winner,
      isDraw: this.isDraw,
      moveCount: this.moveCount,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      forbiddenMoves: this.forbiddenMoves.map((p) => ({ ...p })),
      gameOver: this.gameOver,
    };
  }

  /** 重置游戏到初始状态 */
  reset(): void {
    this.board = this.createEmptyBoard();
    this.currentPlayer = 1;
    this.moveHistory = [];
    this.winner = null;
    this.isDraw = false;
    this.moveCount = 0;
    this.lastMove = null;
    this.gameOver = false;
    this.forbiddenMoves = [];
  }

  /**
   * 执行落子。
   *
   * @param x - 横坐标（0-based）
   * @param y - 纵坐标（0-based）
   * @returns 落子是否成功
   */
  makeMove(x: number, y: number): boolean {
    // 前置校验
    if (this.gameOver) {
      return false;
    }
    if (!this.isValidMove(x, y)) {
      return false;
    }

    const player = this.currentPlayer;

    // 禁手检查（仅黑方启用时）
    if (this.useForbidden && player === 1) {
      const forbidden = this.checkForbidden(x, y);
      if (forbidden) {
        // 禁手位置判负
        this.winner = 2; // 白方获胜
        this.gameOver = true;
        return false;
      }
    }

    // 执行落子
    this.board[y][x] = player;
    const move: Move = { x, y, player, timestamp: Date.now() };
    this.moveHistory.push(move);
    this.lastMove = move;
    this.moveCount++;

    // 胜负判定
    if (this.checkWin(x, y)) {
      this.winner = player;
      this.gameOver = true;
      return true;
    }

    // 和棋判定
    if (this.checkDraw()) {
      this.isDraw = true;
      this.winner = 0;
      this.gameOver = true;
      return true;
    }

    // 更新禁手列表（为下一回合的黑方计算）
    if (this.useForbidden) {
      this.updateForbiddenMoves();
    }

    // 切换执子方
    this.currentPlayer = player === 1 ? 2 : 1;
    return true;
  }

  /** 检查某位置是否为合法落子点 */
  isValidMove(x: number, y: number): boolean {
    // 坐标越界
    if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
      return false;
    }
    // 位置已被占据
    if (this.board[y][x] !== 0) {
      return false;
    }
    return true;
  }

  /** 悔棋：撤销最后一步 */
  undoMove(): boolean {
    if (this.moveHistory.length === 0) {
      return false;
    }

    // 若游戏已结束，先恢复状态
    if (this.gameOver) {
      this.gameOver = false;
      this.winner = null;
      this.isDraw = false;
    }

    // 撤销最后一步
    const last = this.moveHistory.pop()!;
    this.board[last.y][last.x] = 0;
    this.moveCount--;

    // 恢复最后一步记录
    this.lastMove = this.moveHistory.length > 0
      ? { ...this.moveHistory[this.moveHistory.length - 1] }
      : null;

    // 切换回上一位玩家
    this.currentPlayer = last.player;

    // 更新禁手列表
    if (this.useForbidden) {
      this.updateForbiddenMoves();
    }

    return true;
  }

  /** 获取所有合法落子点 */
  getLegalMoves(): Position[] {
    const moves: Position[] = [];
    for (let y = 0; y < this.boardSize; y++) {
      for (let x = 0; x < this.boardSize; x++) {
        if (this.board[y][x] === 0) {
          moves.push({ x, y });
        }
      }
    }
    return moves;
  }

  /** 获取棋盘尺寸 */
  getBoardSize(): BoardSize {
    return this.boardSize;
  }

  /** 获取内部棋盘引用（供AI评估使用，注意只读） */
  getBoard(): Board {
    return this.board;
  }

  /** 获取当前玩家 */
  getCurrentPlayer(): 1 | 2 {
    return this.currentPlayer;
  }

  /** 检查游戏是否结束 */
  isGameOver(): boolean {
    return this.gameOver;
  }

  /** 获取获胜方 */
  getWinner(): 0 | 1 | 2 | null {
    return this.winner;
  }

  // ==================== 私有方法 ====================

  private createEmptyBoard(): Board {
    return Array.from({ length: this.boardSize }, () =>
      Array(this.boardSize).fill(0 as Cell)
    );
  }

  /**
   * 检查指定坐标是否形成五连珠。
   *
   * 沿四个轴向（横、竖、两对角线）扫描，检查是否有连续5个同色棋子。
   */
  private checkWin(x: number, y: number): boolean {
    const player = this.board[y][x];
    if (player === 0) return false;

    for (const axis of AXES) {
      let count = 1; // 当前落子算1个

      // 正方向
      const [dx1, dy1] = axis[0];
      count += this.countInDirection(x, y, dx1, dy1, player);

      // 反方向
      const [dx2, dy2] = axis[1];
      count += this.countInDirection(x, y, dx2, dy2, player);

      if (count >= 5) {
        return true;
      }
    }

    return false;
  }

  /**
   * 沿指定方向计数连续同色棋子数。
   *
   * @param x - 起始横坐标
   * @param y - 起始纵坐标
   * @param dx - 横坐标步进
   * @param dy - 纵坐标步进
   * @param player - 要匹配的棋子颜色（可选，默认使用起始位置棋子）
   * @returns 连续同色棋子数（不含起始位置）
   */
  private countInDirection(
    x: number,
    y: number,
    dx: number,
    dy: number,
    player?: 1 | 2
  ): number {
    const target = player ?? this.board[y][x];
    if (target === 0) return 0;

    let count = 0;
    let cx = x + dx;
    let cy = y + dy;

    while (
      cx >= 0 && cx < this.boardSize &&
      cy >= 0 && cy < this.boardSize &&
      this.board[cy][cx] === target
    ) {
      count++;
      cx += dx;
      cy += dy;
    }

    return count;
  }

  /** 检查和棋：棋盘是否已满 */
  private checkDraw(): boolean {
    return this.moveCount >= this.boardSize * this.boardSize;
  }

  /**
   * 检查禁手（仅黑方适用）。
   *
   * 返回禁手类型或 null（无禁手）。
   */
  private checkForbidden(x: number, y: number): ForbiddenType | null {
    // 禁手只针对黑方，且位置必须为空
    if (this.board[y][x] !== 0) return null;

    // 模拟落子
    this.board[y][x] = 1;

    try {
      // 1. 检查长连禁手（六连及以上）
      for (const axis of AXES) {
        let count = 1;
        count += this.countInDirection(x, y, axis[0][0], axis[0][1], 1);
        count += this.countInDirection(x, y, axis[1][0], axis[1][1], 1);
        if (count > 5) {
          return 'overline';
        }
      }

      // 2. 检查三三禁手
      const openThreeCount = this.countOpenThrees(x, y);
      if (openThreeCount >= 2) {
        return 'three-three';
      }

      // 3. 检查四四禁手
      const openFourCount = this.countOpenFours(x, y);
      if (openFourCount >= 2) {
        return 'four-four';
      }

      return null;
    } finally {
      // 撤销模拟
      this.board[y][x] = 0;
    }
  }

  /**
   * 计算在 (x, y) 模拟落子后形成的活三数量。
   *
   * 活三定义：X _ X X _ 或 _ X X X _（两端开放，下一步可成活四）
   */
  private countOpenThrees(x: number, y: number): number {
    let count = 0;

    for (const axis of AXES) {
      if (this.isOpenThree(x, y, axis[0][0], axis[0][1], axis[1][0], axis[1][1])) {
        count++;
      }
    }

    return count;
  }

  /**
   * 检查某轴上是否形成活三。
   *
   * 活三模式（以黑方 X 为例，_ 为空位）：
   * - _ X X X _ （连续三子，两端空）
   * - _ X X _ X _ （跳活三）
   * - _ X _ X X _ （跳活三）
   */
  private isOpenThree(
    x: number,
    y: number,
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number
  ): boolean {
    // 获取该轴上连续5格范围内所有棋子状态（以落子点为中心向两侧各延伸4格）
    const cells: number[] = [];
    const positions: Array<[number, number]> = [];

    for (let i = -4; i <= 4; i++) {
      const px = x + dx1 * i;
      const py = y + dy1 * i;
      if (px >= 0 && px < this.boardSize && py >= 0 && py < this.boardSize) {
        cells.push(this.board[py][px]);
        positions.push([px, py]);
      } else {
        cells.push(-1); // 越界标记
        positions.push([-1, -1]);
      }
    }

    const center = 4; // 落子点在 cells 数组中的索引
    if (cells[center] !== 1) return false;

    // 检查两端是否开放（不贴边）
    const leftBound = center - 4;
    const rightBound = center + 4;
    let leftOpen = false;
    let rightOpen = false;

    // 向左找第一个非黑子位置
    let leftEnd = center;
    while (leftEnd > 0 && cells[leftEnd - 1] === 1) leftEnd--;
    if (leftEnd > leftBound && cells[leftEnd - 1] === 0) leftOpen = true;

    // 向右找第一个非黑子位置
    let rightEnd = center;
    while (rightEnd < cells.length - 1 && cells[rightEnd + 1] === 1) rightEnd++;
    if (rightEnd < rightBound && cells[rightEnd + 1] === 0) rightOpen = true;

    if (!leftOpen || !rightOpen) return false;

    // 统计轴上黑子数（含落子点）
    let blackCount = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 1) blackCount++;
    }

    // 活三：恰好3个黑子，其余为空位，两端开放
    // 简化判断：轴上黑子数为3，且两端开放
    if (blackCount === 3) {
      return true;
    }

    return false;
  }

  /**
   * 计算在 (x, y) 模拟落子后形成的活四/冲四数量。
   */
  private countOpenFours(x: number, y: number): number {
    let count = 0;

    for (const axis of AXES) {
      if (this.isOpenFour(x, y, axis[0][0], axis[0][1], axis[1][0], axis[1][1])) {
        count++;
      }
    }

    return count;
  }

  /**
   * 检查某轴上是否形成活四或冲四。
   *
   * 活四：_ X X X X _ （四子连珠，两端空，下一步必赢）
   * 冲四：X X X X _ 或 _ X X X X （一端被堵）
   */
  private isOpenFour(
    x: number,
    y: number,
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number
  ): boolean {
    // 获取该轴上连续棋子
    let count = 1; // 落子点本身
    count += this.countInDirection(x, y, dx1, dy1, 1);
    count += this.countInDirection(x, y, dx2, dy2, 1);

    // 检查两端状态
    const end1x = x + dx1 * (this.countInDirection(x, y, dx1, dy1, 1) + 1);
    const end1y = y + dy1 * (this.countInDirection(x, y, dx1, dy1, 1) + 1);
    const end2x = x + dx2 * (this.countInDirection(x, y, dx2, dy2, 1) + 1);
    const end2y = y + dy2 * (this.countInDirection(x, y, dx2, dy2, 1) + 1);

    const end1Empty = end1x >= 0 && end1x < this.boardSize && end1y >= 0 && end1y < this.boardSize && this.board[end1y][end1x] === 0;
    const end2Empty = end2x >= 0 && end2x < this.boardSize && end2y >= 0 && end2y < this.boardSize && this.board[end2y][end2x] === 0;

    // 活四或冲四：4个连续黑子，至少一端空
    if (count === 4 && (end1Empty || end2Empty)) {
      return true;
    }

    // 跳四：3子连+跳1空+1子，形成四子
    // 简化：count 包含4子及以上
    if (count >= 4) {
      return true;
    }

    return false;
  }

  /** 更新全局禁手位置列表 */
  private updateForbiddenMoves(): void {
    this.forbiddenMoves = [];
    if (!this.useForbidden || this.currentPlayer !== 1) return;

    for (let y = 0; y < this.boardSize; y++) {
      for (let x = 0; x < this.boardSize; x++) {
        if (this.board[y][x] === 0) {
          const forbidden = this.checkForbidden(x, y);
          if (forbidden) {
            this.forbiddenMoves.push({ x, y });
          }
        }
      }
    }
  }

  // ==================== 静态工具方法 ====================

  /**
   * 将坐标转换为标准记谱格式。
   *
   * 格式：列字母 + 行数字（1-based）
   * 例：toNotation(0, 0) => "A1"
   *     toNotation(7, 7) => "H8"
   *     toNotation(14, 14) => "O15"
   *
   * @param x - 横坐标（0-based）
   * @param y - 纵坐标（0-based）
   * @returns 标准记谱字符串
   */
  static toNotation(x: number, y: number): string {
    const col = String.fromCharCode(65 + x); // A=0, B=1, ...
    const row = y + 1;
    return `${col}${row}`;
  }

  /**
   * 从标准记谱格式解析坐标。
   *
   * @param notation - 记谱字符串（如 "A1", "H8", "O15"）
   * @returns 坐标对象，解析失败返回 null
   */
  static fromNotation(notation: string): Position | null {
    if (!notation || notation.length < 2) return null;

    const col = notation[0].toUpperCase();
    const rowStr = notation.slice(1);

    if (col < 'A' || col > 'Z') return null;

    const x = col.charCodeAt(0) - 65;
    const y = parseInt(rowStr, 10) - 1;

    if (isNaN(y) || y < 0) return null;

    return { x, y };
  }
}
