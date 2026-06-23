/**
 * 黑白棋（Reversi/Othello）游戏引擎
 * 负责核心游戏逻辑：棋盘状态、落子、翻转、合法性检查、胜负判定等
 *
 * 遵循需求文档第6章 - 黑白棋插件设计需求
 */

import type { Board, Cell, Position, ReversiMove, ReversiState } from './reversi.types';

export class ReversiEngine {
  /** 8个方向向量：上、右上、右、右下、下、左下、左、左上 */
  static readonly DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  /** 棋盘大小 */
  static readonly BOARD_SIZE = 8;

  private state: ReversiState;

  constructor() {
    this.state = this.createInitialState();
  }

  // ==================== 公共查询方法 ====================

  /** 获取当前游戏状态 */
  getState(): ReversiState {
    return this.deepCloneState(this.state);
  }

  /** 检查指定位置是否在棋盘范围内 */
  private isOnBoard(x: number, y: number): boolean {
    return x >= 0 && x < ReversiEngine.BOARD_SIZE && y >= 0 && y < ReversiEngine.BOARD_SIZE;
  }

  /** 获取对手棋子颜色 */
  private getOpponent(player: 1 | 2): 1 | 2 {
    return player === 1 ? 2 : 1;
  }

  // ==================== 初始化 ====================

  /** 创建初始游戏状态 */
  private createInitialState(): ReversiState {
    const board = this.createEmptyBoard();
    const center = ReversiEngine.BOARD_SIZE / 2;
    // 标准黑白棋初始布局
    board[center - 1][center - 1] = 2; // 白
    board[center - 1][center] = 1; // 黑
    board[center][center - 1] = 1; // 黑
    board[center][center] = 2; // 白

    const currentPlayer: 1 | 2 = 1; // 黑棋先行
    const legalMoves = this.calculateLegalMoves(board, currentPlayer);

    return {
      board,
      currentPlayer,
      moveHistory: [],
      legalMoves,
      blackCount: 2,
      whiteCount: 2,
      winner: null,
      isDraw: false,
      passCount: 0,
      gameOver: false,
    };
  }

  /** 创建空棋盘 */
  private createEmptyBoard(): Board {
    return Array.from({ length: ReversiEngine.BOARD_SIZE }, () =>
      Array.from({ length: ReversiEngine.BOARD_SIZE }, () => 0 as Cell)
    );
  }

  // ==================== 深拷贝 ====================

  /** 深拷贝棋盘 */
  private cloneBoard(board: Board): Board {
    return board.map((row) => [...row]) as Board;
  }

  /** 深拷贝游戏状态 */
  private deepCloneState(state: ReversiState): ReversiState {
    return {
      board: this.cloneBoard(state.board),
      currentPlayer: state.currentPlayer,
      moveHistory: state.moveHistory.map((m) => ({
        ...m,
        flipped: m.flipped.map((f) => ({ ...f })),
      })),
      legalMoves: state.legalMoves.map((p) => ({ ...p })),
      blackCount: state.blackCount,
      whiteCount: state.whiteCount,
      winner: state.winner,
      isDraw: state.isDraw,
      passCount: state.passCount,
      gameOver: state.gameOver,
    };
  }

  // ==================== 核心逻辑：翻转棋子 ====================

  /**
   * 获取指定位置落子后翻转的棋子列表
   * @param x - 横坐标 (0-7)
   * @param y - 纵坐标 (0-7)
   * @param player - 落子玩家（1=黑, 2=白）
   * @returns 被翻转的棋子位置列表（空数组表示不合法走法）
   */
  getFlippedDiscs(x: number, y: number, player: 1 | 2): Position[] {
    if (!this.isOnBoard(x, y)) return [];

    const board = this.state.board;
    if (board[x][y] !== 0) return [];

    const opponent = this.getOpponent(player);
    const flipped: Position[] = [];

    for (const [dx, dy] of ReversiEngine.DIRECTIONS) {
      let nx = x + dx;
      let ny = y + dy;
      const discsInDir: Position[] = [];

      // 沿方向搜索对手棋子
      while (this.isOnBoard(nx, ny) && board[nx][ny] === opponent) {
        discsInDir.push({ x: nx, y: ny });
        nx += dx;
        ny += dy;
      }

      // 检查是否以己方棋子结尾
      if (
        discsInDir.length > 0 &&
        this.isOnBoard(nx, ny) &&
        board[nx][ny] === player
      ) {
        flipped.push(...discsInDir);
      }
    }

    return flipped;
  }

  /**
   * 获取指定位置落子后翻转的棋子列表（静态版本，用于AI评估）
   */
  static getFlippedDiscsStatic(
    board: Board,
    x: number,
    y: number,
    player: 1 | 2
  ): Position[] {
    if (x < 0 || x >= ReversiEngine.BOARD_SIZE || y < 0 || y >= ReversiEngine.BOARD_SIZE)
      return [];
    if (board[x][y] !== 0) return [];

    const opponent = player === 1 ? 2 : 1;
    const flipped: Position[] = [];

    for (const [dx, dy] of ReversiEngine.DIRECTIONS) {
      let nx = x + dx;
      let ny = y + dy;
      const discsInDir: Position[] = [];

      while (nx >= 0 && nx < ReversiEngine.BOARD_SIZE && ny >= 0 && ny < ReversiEngine.BOARD_SIZE && board[nx][ny] === opponent) {
        discsInDir.push({ x: nx, y: ny });
        nx += dx;
        ny += dy;
      }

      if (
        discsInDir.length > 0 &&
        nx >= 0 && nx < ReversiEngine.BOARD_SIZE && ny >= 0 && ny < ReversiEngine.BOARD_SIZE &&
        board[nx][ny] === player
      ) {
        flipped.push(...discsInDir);
      }
    }

    return flipped;
  }

  // ==================== 合法性检查 ====================

  /**
   * 检查指定位置是否为合法走法
   */
  isValidMove(x: number, y: number): boolean {
    if (this.state.gameOver) return false;
    const flipped = this.getFlippedDiscs(x, y, this.state.currentPlayer);
    return flipped.length > 0;
  }

  /**
   * 静态方法：检查指定位置是否为合法走法
   */
  static isValidMoveStatic(board: Board, x: number, y: number, player: 1 | 2): boolean {
    return ReversiEngine.getFlippedDiscsStatic(board, x, y, player).length > 0;
  }

  // ==================== 合法走法计算 ====================

  /**
   * 获取指定玩家的所有合法走法
   * @param player - 可选，默认为当前玩家
   */
  getLegalMoves(player?: 1 | 2): Position[] {
    const p = player ?? this.state.currentPlayer;
    return this.calculateLegalMoves(this.state.board, p);
  }

  /** 计算指定玩家在指定棋盘上的所有合法走法 */
  private calculateLegalMoves(board: Board, player: 1 | 2): Position[] {
    const moves: Position[] = [];
    for (let x = 0; x < ReversiEngine.BOARD_SIZE; x++) {
      for (let y = 0; y < ReversiEngine.BOARD_SIZE; y++) {
        if (board[x][y] !== 0) continue;
        const flipped = ReversiEngine.getFlippedDiscsStatic(board, x, y, player);
        if (flipped.length > 0) {
          moves.push({ x, y });
        }
      }
    }
    return moves;
  }

  /**
   * 静态方法：计算指定玩家在指定棋盘上的所有合法走法
   */
  static getLegalMovesStatic(board: Board, player: 1 | 2): Position[] {
    const moves: Position[] = [];
    for (let x = 0; x < ReversiEngine.BOARD_SIZE; x++) {
      for (let y = 0; y < ReversiEngine.BOARD_SIZE; y++) {
        if (board[x][y] !== 0) continue;
        if (ReversiEngine.getFlippedDiscsStatic(board, x, y, player).length > 0) {
          moves.push({ x, y });
        }
      }
    }
    return moves;
  }

  // ==================== 落子 ====================

  /**
   * 在指定位置落子
   * @param x - 横坐标 (0-7)
   * @param y - 纵坐标 (0-7)
   * @returns 是否落子成功
   */
  makeMove(x: number, y: number): boolean {
    if (this.state.gameOver) return false;

    const flipped = this.getFlippedDiscs(x, y, this.state.currentPlayer);
    if (flipped.length === 0) return false;

    const player = this.state.currentPlayer;
    const board = this.cloneBoard(this.state.board);

    // 放置新棋子
    board[x][y] = player;

    // 翻转对手棋子
    for (const pos of flipped) {
      board[pos.x][pos.y] = player;
    }

    // 记录走棋
    const move: ReversiMove = {
      x,
      y,
      player,
      flipped: flipped.map((f) => ({ ...f })),
      timestamp: Date.now(),
    };

    // 更新棋盘
    this.state.board = board;
    this.state.moveHistory.push(move);
    this.state.passCount = 0; // 重置pass计数

    // 切换玩家
    const nextPlayer = this.getOpponent(player);
    this.state.currentPlayer = nextPlayer;

    // 计算新玩家的合法走法
    this.state.legalMoves = this.calculateLegalMoves(board, nextPlayer);

    // 更新棋子计数
    const counts = this.countDiscs();
    this.state.blackCount = counts.black;
    this.state.whiteCount = counts.white;

    // 检查游戏是否结束
    this.checkGameOver();

    return true;
  }

  // ==================== Pass ====================

  /**
   * 当玩家无合法走法时Pass
   * @returns 是否Pass成功
   */
  pass(): boolean {
    if (this.state.gameOver) return false;

    // 只有在没有合法走法时才允许Pass
    if (this.state.legalMoves.length > 0) return false;

    this.state.passCount++;

    // 记录Pass（用特殊move记录）
    const move: ReversiMove = {
      x: -1,
      y: -1,
      player: this.state.currentPlayer,
      flipped: [],
      timestamp: Date.now(),
    };
    this.state.moveHistory.push(move);

    // 切换玩家
    const nextPlayer = this.getOpponent(this.state.currentPlayer);
    this.state.currentPlayer = nextPlayer;

    // 计算新玩家的合法走法
    this.state.legalMoves = this.calculateLegalMoves(this.state.board, nextPlayer);

    // 检查游戏是否结束（双方连续Pass）
    this.checkGameOver();

    return true;
  }

  // ==================== 悔棋 ====================

  /**
   * 悔棋（撤销一步）
   * @returns 是否悔棋成功
   */
  undoMove(): boolean {
    if (this.state.moveHistory.length === 0) return false;

    const lastMove = this.state.moveHistory.pop()!;
    const board = this.cloneBoard(this.state.board);

    if (lastMove.x >= 0 && lastMove.y >= 0) {
      // 撤销正常落子
      const player = lastMove.player;
      board[lastMove.x][lastMove.y] = 0;

      // 恢复被翻转的棋子
      const opponent = this.getOpponent(player);
      for (const pos of lastMove.flipped) {
        board[pos.x][pos.y] = opponent;
      }
    }

    // 恢复上一个玩家
    this.state.currentPlayer = lastMove.player;
    this.state.board = board;
    this.state.passCount = 0;

    // 重新计算合法走法
    this.state.legalMoves = this.calculateLegalMoves(board, lastMove.player);

    // 更新棋子计数
    const counts = this.countDiscs();
    this.state.blackCount = counts.black;
    this.state.whiteCount = counts.white;

    // 重置游戏结束状态
    this.state.gameOver = false;
    this.state.winner = null;
    this.state.isDraw = false;

    return true;
  }

  // ==================== 游戏结束检查 ====================

  /**
   * 检查游戏是否结束
   * 游戏结束条件：
   * 1. 双方连续Pass（passCount >= 2）
   * 2. 棋盘已满
   * 3. 一方棋子数为0
   */
  private checkGameOver(): void {
    const counts = this.countDiscs();

    // 条件：一方棋子数为0
    if (counts.black === 0 || counts.white === 0) {
      this.endGame(counts.black, counts.white);
      return;
    }

    // 条件：棋盘已满
    if (counts.black + counts.white === ReversiEngine.BOARD_SIZE * ReversiEngine.BOARD_SIZE) {
      this.endGame(counts.black, counts.white);
      return;
    }

    // 条件：双方连续Pass
    if (this.state.passCount >= 2) {
      this.endGame(counts.black, counts.white);
      return;
    }
  }

  /** 结束游戏，设置胜负 */
  private endGame(black: number, white: number): void {
    this.state.gameOver = true;
    this.state.legalMoves = [];

    if (black > white) {
      this.state.winner = 1;
      this.state.isDraw = false;
    } else if (white > black) {
      this.state.winner = 2;
      this.state.isDraw = false;
    } else {
      this.state.winner = 0;
      this.state.isDraw = true;
    }
  }

  // ==================== 棋子计数 ====================

  /**
   * 统计双方棋子数
   */
  private countDiscs(): { black: number; white: number } {
    let black = 0;
    let white = 0;
    for (let x = 0; x < ReversiEngine.BOARD_SIZE; x++) {
      for (let y = 0; y < ReversiEngine.BOARD_SIZE; y++) {
        const cell = this.state.board[x][y];
        if (cell === 1) black++;
        else if (cell === 2) white++;
      }
    }
    return { black, white };
  }

  /**
   * 静态方法：统计指定棋盘上双方棋子数
   */
  static countDiscsStatic(board: Board): { black: number; white: number } {
    let black = 0;
    let white = 0;
    for (let x = 0; x < ReversiEngine.BOARD_SIZE; x++) {
      for (let y = 0; y < ReversiEngine.BOARD_SIZE; y++) {
        const cell = board[x][y];
        if (cell === 1) black++;
        else if (cell === 2) white++;
      }
    }
    return { black, white };
  }

  // ==================== 重置 ====================

  /** 重置游戏到初始状态 */
  reset(): void {
    this.state = this.createInitialState();
  }
}
