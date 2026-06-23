/**
 * Xiangqi (Chinese Chess) Game Engine
 *
 * Implements all game rules:
 * - Piece movement for all 7 piece types
 * - Special rules: horse blocking (蹩马脚), elephant blocking (塞象眼),
 *   face-to-face general (将帅对面), river crossing for soldiers
 * - Check, checkmate, stalemate (困毙) detection
 * - Repetition detection via Zobrist hashing
 * - Draw rules: repetition, 50-move rule
 * - FEN import/export
 */

import {
  type PieceType,
  type Player,
  type Piece,
  type XiangqiState,
  type XiangqiMove,
  type Position,
  type ZobristTable,
  FEN_INITIAL,
  PIECE_TO_FEN,
  FEN_TO_PIECE,
} from './xiangqi.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOARD_COLS = 9;
const BOARD_ROWS = 10;

// Palace boundaries
const RED_PALACE = { xMin: 3, xMax: 5, yMin: 0, yMax: 2 };
const BLACK_PALACE = { xMin: 3, xMax: 5, yMin: 7, yMax: 9 };

// ---------------------------------------------------------------------------
// Zobrist hash table (lazy-initialised)
// ---------------------------------------------------------------------------

let zobristTable: ZobristTable | null = null;

function getZobristTable(): ZobristTable {
  if (zobristTable) return zobristTable;

  const pieceTypes: PieceType[] = ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'];
  const players: Player[] = [1, 2];

  const pieces: number[][][][] = [];
  for (const pt of pieceTypes) {
    pieces[pt as any] = [];
    for (const pl of players) {
      pieces[pt as any][pl] = [];
      for (let x = 0; x < BOARD_COLS; x++) {
        pieces[pt as any][pl][x] = [];
        for (let y = 0; y < BOARD_ROWS; y++) {
          pieces[pt as any][pl][x][y] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        }
      }
    }
  }

  zobristTable = { pieces, player: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) };
  return zobristTable;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneBoard(board: (Piece | null)[][]): (Piece | null)[][] {
  return board.map(col => [...col]);
}

function posEq(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function isInsidePalace(x: number, y: number, player: Player): boolean {
  if (player === 1) {
    return x >= RED_PALACE.xMin && x <= RED_PALACE.xMax && y >= RED_PALACE.yMin && y <= RED_PALACE.yMax;
  }
  return x >= BLACK_PALACE.xMin && x <= BLACK_PALACE.xMax && y >= BLACK_PALACE.yMin && y <= BLACK_PALACE.yMax;
}

function isSamePlayer(a: Piece | null, b: Piece | null): boolean {
  return !!a && !!b && a.player === b.player;
}

function createPiece(type: PieceType, player: Player, id?: string): Piece {
  return {
    type,
    player,
    id: id || `${player === 1 ? 'R' : 'B'}-${type}-${Math.random().toString(36).slice(2, 6)}`,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class XiangqiEngine {
  private state: XiangqiState;

  constructor() {
    this.state = this.createInitialState();
  }

  // -----------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------

  getState(): XiangqiState {
    return this.state;
  }

  reset(): void {
    this.state = this.createInitialState();
  }

  private createInitialState(): XiangqiState {
    const board = this.createInitialBoard();
    return {
      board,
      currentPlayer: 1,
      moveHistory: [],
      capturedPieces: [],
      isCheck: false,
      isCheckmate: false,
      isStalemate: false,
      isDraw: false,
      winner: null,
      gameOver: false,
      moveCount: 0,
      lastMove: null,
      positionHashes: [this.computeZobristHash(board, 1)],
      repetitionCount: 1,
      movesSinceCapture: 0,
    };
  }

  private createInitialBoard(): (Piece | null)[][] {
    const board: (Piece | null)[][] = Array.from({ length: BOARD_COLS }, () =>
      Array.from({ length: BOARD_ROWS }, () => null)
    );

    // Red pieces (player 1) - bottom side (y=0..4)
    const redSetup: [number, number, PieceType][] = [
      [0, 0, 'chariot'], [1, 0, 'horse'], [2, 0, 'elephant'], [3, 0, 'advisor'],
      [4, 0, 'general'], [5, 0, 'advisor'], [6, 0, 'elephant'], [7, 0, 'horse'], [8, 0, 'chariot'],
      [1, 2, 'cannon'], [7, 2, 'cannon'],
      [0, 3, 'soldier'], [2, 3, 'soldier'], [4, 3, 'soldier'], [6, 3, 'soldier'], [8, 3, 'soldier'],
    ];
    for (const [x, y, type] of redSetup) {
      board[x][y] = createPiece(type, 1, `R-${type}-${x}-${y}`);
    }

    // Black pieces (player 2) - top side (y=5..9)
    const blackSetup: [number, number, PieceType][] = [
      [0, 9, 'chariot'], [1, 9, 'horse'], [2, 9, 'elephant'], [3, 9, 'advisor'],
      [4, 9, 'general'], [5, 9, 'advisor'], [6, 9, 'elephant'], [7, 9, 'horse'], [8, 9, 'chariot'],
      [1, 7, 'cannon'], [7, 7, 'cannon'],
      [0, 6, 'soldier'], [2, 6, 'soldier'], [4, 6, 'soldier'], [6, 6, 'soldier'], [8, 6, 'soldier'],
    ];
    for (const [x, y, type] of blackSetup) {
      board[x][y] = createPiece(type, 2, `B-${type}-${x}-${y}`);
    }

    return board;
  }

  // -----------------------------------------------------------------
  // Move validation
  // -----------------------------------------------------------------

  isValidMove(fromX: number, fromY: number, toX: number, toY: number): boolean {
    if (!this.isOnBoard(fromX, fromY) || !this.isOnBoard(toX, toY)) return false;
    const piece = this.state.board[fromX][fromY];
    if (!piece) return false;
    if (piece.player !== this.state.currentPlayer) return false;
    if (fromX === toX && fromY === toY) return false;
    if (isSamePlayer(piece, this.state.board[toX][toY])) return false;

    const legal = this.getRawLegalMoves(fromX, fromY);
    if (!legal.some(p => p.x === toX && p.y === toY)) return false;

    // Simulate: moving must not leave own general in check
    return !this.wouldLeaveInCheck(fromX, fromY, toX, toY);
  }

  /** Returns legal moves for a piece *without* checking whether the move
   *  leaves the friendly general in check.  */
  private getRawLegalMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y];
    if (!piece) return [];

    switch (piece.type) {
      case 'general': return this.getGeneralMoves(x, y);
      case 'advisor': return this.getAdvisorMoves(x, y);
      case 'elephant': return this.getElephantMoves(x, y);
      case 'horse': return this.getHorseMoves(x, y);
      case 'chariot': return this.getChariotMoves(x, y);
      case 'cannon': return this.getCannonMoves(x, y);
      case 'soldier': return this.getSoldierMoves(x, y);
      default: return [];
    }
  }

  /** Public API – returns fully-legal moves for a piece. */
  getLegalMoves(x: number, y: number): Position[] {
    return this.getRawLegalMoves(x, y).filter(to => !this.wouldLeaveInCheck(x, y, to.x, to.y));
  }

  /** All fully-legal moves for a player. */
  getAllLegalMoves(player?: Player): { from: Position; to: Position }[] {
    const p = player ?? this.state.currentPlayer;
    const moves: { from: Position; to: Position }[] = [];
    for (let x = 0; x < BOARD_COLS; x++) {
      for (let y = 0; y < BOARD_ROWS; y++) {
        const piece = this.state.board[x][y];
        if (piece && piece.player === p) {
          const targets = this.getLegalMoves(x, y);
          for (const to of targets) {
            moves.push({ from: { x, y }, to });
          }
        }
      }
    }
    return moves;
  }

  // -----------------------------------------------------------------
  // Simulating moves
  // -----------------------------------------------------------------

  private wouldLeaveInCheck(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const piece = this.state.board[fromX][fromY]!;
    const captured = this.state.board[toX][toY];
    // Temporarily move
    this.state.board[toX][toY] = piece;
    this.state.board[fromX][fromY] = null;
    const inCheck = this.isInCheck(piece.player);
    // Restore
    this.state.board[fromX][fromY] = piece;
    this.state.board[toX][toY] = captured;
    return inCheck;
  }

  // -----------------------------------------------------------------
  // Execute move
  // -----------------------------------------------------------------

  movePiece(fromX: number, fromY: number, toX: number, toY: number): boolean {
    if (!this.isValidMove(fromX, fromY, toX, toY)) return false;
    if (this.state.gameOver) return false;

    const piece = this.state.board[fromX][fromY]!;
    const captured = this.state.board[toX][toY];

    // Execute
    this.state.board[toX][toY] = piece;
    this.state.board[fromX][fromY] = null;

    if (captured) {
      this.state.capturedPieces.push(captured);
      this.state.movesSinceCapture = 0;
    } else {
      this.state.movesSinceCapture++;
    }

    // Face-to-face check (illegal: undo)
    if (this.isFaceToFaceGeneral()) {
      this.state.board[fromX][fromY] = piece;
      this.state.board[toX][toY] = captured;
      if (captured) this.state.capturedPieces.pop();
      return false;
    }

    const opponent: Player = piece.player === 1 ? 2 : 1;
    const check = this.isInCheck(opponent);
    const checkmate = check && this.isCheckmate(opponent);
    const stalemate = !check && this.getAllLegalMoves(opponent).length === 0;

    const move: XiangqiMove = {
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      piece,
      captured,
      isCheck: check,
      isCheckmate: checkmate,
      timestamp: Date.now(),
    };

    this.state.moveHistory.push(move);
    this.state.lastMove = move;
    this.state.isCheck = check;
    this.state.isCheckmate = checkmate;
    this.state.isStalemate = stalemate;
    this.state.currentPlayer = opponent;
    this.state.moveCount++;

    // Update hashes / repetition
    const hash = this.computeZobristHash(this.state.board, this.state.currentPlayer);
    this.state.positionHashes.push(hash);
    this.state.repetitionCount = this.state.positionHashes.filter(h => h === hash).length;

    // Draw checks
    this.state.isDraw = this.checkDraw();
    if (this.state.isDraw || checkmate || stalemate) {
      this.state.gameOver = true;
      if (checkmate) this.state.winner = piece.player;
    }

    return true;
  }

  // -----------------------------------------------------------------
  // Undo
  // -----------------------------------------------------------------

  undoMove(): boolean {
    const move = this.state.moveHistory.pop();
    if (!move) return false;

    const { from, to, piece, captured } = move;
    this.state.board[from.x][from.y] = piece;
    this.state.board[to.x][to.y] = captured;

    if (captured) {
      this.state.capturedPieces.pop();
    }

    this.state.currentPlayer = piece.player;
    this.state.moveCount--;
    this.state.positionHashes.pop();
    this.state.repetitionCount = this.state.positionHashes.filter(
      h => h === this.state.positionHashes[this.state.positionHashes.length - 1]
    ).length;

    // Recalculate flags
    const opponent: Player = piece.player === 1 ? 2 : 1;
    this.state.isCheck = this.isInCheck(opponent);
    this.state.isCheckmate = this.state.isCheck && this.isCheckmate(opponent);
    this.state.isStalemate = !this.state.isCheck && this.getAllLegalMoves(opponent).length === 0;
    this.state.isDraw = this.checkDraw();
    this.state.gameOver = this.state.isCheckmate || this.state.isStalemate || this.state.isDraw;
    this.state.winner = this.state.isCheckmate ? piece.player : null;
    this.state.lastMove = this.state.moveHistory.length > 0
      ? this.state.moveHistory[this.state.moveHistory.length - 1]
      : null;

    return true;
  }

  // -----------------------------------------------------------------
  // Piece-specific move generators (raw – not accounting for check)
  // -----------------------------------------------------------------

  private getGeneralMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y]!;
    const moves: Position[] = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (isInsidePalace(nx, ny, piece.player)) {
        if (!isSamePlayer(piece, this.state.board[nx][ny])) {
          moves.push({ x: nx, y: ny });
        }
      }
    }
    // Flying general: if on same file with enemy general and no pieces between
    const enemyGeneralPos = this.findGeneral(piece.player === 1 ? 2 : 1);
    if (enemyGeneralPos && enemyGeneralPos.x === x) {
      let blocked = false;
      const minY = Math.min(y, enemyGeneralPos.y);
      const maxY = Math.max(y, enemyGeneralPos.y);
      for (let cy = minY + 1; cy < maxY; cy++) {
        if (this.state.board[x][cy]) { blocked = true; break; }
      }
      if (!blocked) {
        moves.push({ x: enemyGeneralPos.x, y: enemyGeneralPos.y });
      }
    }
    return moves;
  }

  private getAdvisorMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y]!;
    const moves: Position[] = [];
    const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (isInsidePalace(nx, ny, piece.player)) {
        if (!isSamePlayer(piece, this.state.board[nx][ny])) {
          moves.push({ x: nx, y: ny });
        }
      }
    }
    return moves;
  }

  private getElephantMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y]!;
    const moves: Position[] = [];
    const leaps = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
    for (const [dx, dy] of leaps) {
      const nx = x + dx, ny = y + dy;
      if (this.isOnBoard(nx, ny) && this.isOnOwnSide(ny, piece.player)) {
        if (!this.isElephantBlocked(x, y, nx, ny)) {
          if (!isSamePlayer(piece, this.state.board[nx][ny])) {
            moves.push({ x: nx, y: ny });
          }
        }
      }
    }
    return moves;
  }

  private getHorseMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y]!;
    const moves: Position[] = [];
    const leaps = [
      [1, 2], [1, -2], [-1, 2], [-1, -2],
      [2, 1], [2, -1], [-2, 1], [-2, -1],
    ];
    for (const [dx, dy] of leaps) {
      const nx = x + dx, ny = y + dy;
      if (this.isOnBoard(nx, ny) && !this.isHorseBlocked(x, y, nx, ny)) {
        if (!isSamePlayer(piece, this.state.board[nx][ny])) {
          moves.push({ x: nx, y: ny });
        }
      }
    }
    return moves;
  }

  private getChariotMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y]!;
    const moves: Position[] = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dy] of dirs) {
      let nx = x + dx, ny = y + dy;
      while (this.isOnBoard(nx, ny)) {
        const target = this.state.board[nx][ny];
        if (!target) {
          moves.push({ x: nx, y: ny });
        } else {
          if (target.player !== piece.player) {
            moves.push({ x: nx, y: ny });
          }
          break;
        }
        nx += dx; ny += dy;
      }
    }
    return moves;
  }

  private getCannonMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y]!;
    const moves: Position[] = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dy] of dirs) {
      let nx = x + dx, ny = y + dy;
      let platformFound = false;
      while (this.isOnBoard(nx, ny)) {
        const target = this.state.board[nx][ny];
        if (!platformFound) {
          if (!target) {
            moves.push({ x: nx, y: ny });
          } else {
            platformFound = true; // first piece acts as cannon platform
          }
        } else {
          if (target) {
            if (target.player !== piece.player) {
              moves.push({ x: nx, y: ny });
            }
            break;
          }
        }
        nx += dx; ny += dy;
      }
    }
    return moves;
  }

  private getSoldierMoves(x: number, y: number): Position[] {
    const piece = this.state.board[x][y]!;
    const moves: Position[] = [];
    const forward = piece.player === 1 ? 1 : -1;
    const crossedRiver = piece.player === 1 ? y >= 5 : y <= 4;

    // Forward
    const fy = y + forward;
    if (this.isOnBoard(x, fy) && !isSamePlayer(piece, this.state.board[x][fy])) {
      moves.push({ x, y: fy });
    }
    // Sideways after crossing river
    if (crossedRiver) {
      for (const sx of [x - 1, x + 1]) {
        if (this.isOnBoard(sx, y) && !isSamePlayer(piece, this.state.board[sx][y])) {
          moves.push({ x: sx, y });
        }
      }
    }
    return moves;
  }

  // -----------------------------------------------------------------
  // Blocking checks
  // -----------------------------------------------------------------

  private isHorseBlocked(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    let blockX: number, blockY: number;
    if (Math.abs(dx) === 2) {
      blockX = fromX + (dx > 0 ? 1 : -1);
      blockY = fromY;
    } else {
      blockX = fromX;
      blockY = fromY + (dy > 0 ? 1 : -1);
    }
    return !!this.state.board[blockX][blockY];
  }

  private isElephantBlocked(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const blockX = (fromX + toX) / 2;
    const blockY = (fromY + toY) / 2;
    return !!this.state.board[blockX][blockY];
  }

  private isFaceToFaceGeneral(): boolean {
    const redG = this.findGeneral(1);
    const blackG = this.findGeneral(2);
    if (!redG || !blackG) return false;
    if (redG.x !== blackG.x) return false;
    for (let y = redG.y + 1; y < blackG.y; y++) {
      if (this.state.board[redG.x][y]) return false;
    }
    return true;
  }

  // -----------------------------------------------------------------
  // Check / checkmate / stalemate
  // -----------------------------------------------------------------

  isInCheck(player: Player): boolean {
    const generalPos = this.findGeneral(player);
    if (!generalPos) return false;
    const opponent: Player = player === 1 ? 2 : 1;
    for (let x = 0; x < BOARD_COLS; x++) {
      for (let y = 0; y < BOARD_ROWS; y++) {
        const piece = this.state.board[x][y];
        if (piece && piece.player === opponent) {
          const raw = this.getRawLegalMoves(x, y);
          if (raw.some(p => p.x === generalPos.x && p.y === generalPos.y)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  isCheckmate(player: Player): boolean {
    if (!this.isInCheck(player)) return false;
    return this.getAllLegalMoves(player).length === 0;
  }

  isStalemate(player: Player): boolean {
    if (this.isInCheck(player)) return false;
    return this.getAllLegalMoves(player).length === 0;
  }

  // -----------------------------------------------------------------
  // General finder
  // -----------------------------------------------------------------

  private findGeneral(player: Player): Position | null {
    for (let x = 0; x < BOARD_COLS; x++) {
      for (let y = 0; y < BOARD_ROWS; y++) {
        const p = this.state.board[x][y];
        if (p && p.type === 'general' && p.player === player) {
          return { x, y };
        }
      }
    }
    return null;
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  private isOnBoard(x: number, y: number): boolean {
    return x >= 0 && x < BOARD_COLS && y >= 0 && y < BOARD_ROWS;
  }

  private isOnOwnSide(y: number, player: Player): boolean {
    return player === 1 ? y <= 4 : y >= 5;
  }

  // -----------------------------------------------------------------
  // Zobrist hash
  // -----------------------------------------------------------------

  private computeZobristHash(board?: (Piece | null)[][], currentPlayer?: Player): string {
    const b = board ?? this.state.board;
    const cp = currentPlayer ?? this.state.currentPlayer;
    const z = getZobristTable();
    let hash = cp === 1 ? 0 : z.player;
    for (let x = 0; x < BOARD_COLS; x++) {
      for (let y = 0; y < BOARD_ROWS; y++) {
        const p = b[x][y];
        if (p) {
          hash ^= z.pieces[p.type as any][p.player][x][y];
        }
      }
    }
    return hash.toString(16);
  }

  private checkRepetition(): boolean {
    return this.state.repetitionCount >= 3;
  }

  // -----------------------------------------------------------------
  // Draw
  // -----------------------------------------------------------------

  private checkDraw(): boolean {
    // 3-fold repetition
    if (this.checkRepetition()) return true;
    // 60 half-moves without capture (Chinese chess "natural limit")
    if (this.state.movesSinceCapture >= 60) return true;
    return false;
  }

  // -----------------------------------------------------------------
  // FEN
  // -----------------------------------------------------------------

  exportToFEN(): string {
    const rows: string[] = [];
    for (let y = BOARD_ROWS - 1; y >= 0; y--) {
      let empty = 0;
      let rowStr = '';
      for (let x = 0; x < BOARD_COLS; x++) {
        const p = this.state.board[x][y];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) { rowStr += empty; empty = 0; }
          let ch = PIECE_TO_FEN[p.type];
          if (p.player === 1) ch = ch.toUpperCase();
          rowStr += ch;
        }
      }
      if (empty > 0) rowStr += empty;
      rows.push(rowStr);
    }
    const turn = this.state.currentPlayer === 1 ? 'w' : 'b';
    return `${rows.join('/')} ${turn}`;
  }

  importFromFEN(fen: string): void {
    const [boardPart, turnPart] = fen.split(' ');
    const board: (Piece | null)[][] = Array.from({ length: BOARD_COLS }, () =>
      Array.from({ length: BOARD_ROWS }, () => null)
    );
    const rows = boardPart.split('/');
    for (let ri = 0; ri < rows.length && ri < BOARD_ROWS; ri++) {
      const y = BOARD_ROWS - 1 - ri;
      let x = 0;
      for (const ch of rows[ri]) {
        if (ch >= '1' && ch <= '9') {
          x += parseInt(ch, 10);
        } else {
          const isRed = ch === ch.toUpperCase();
          const type = FEN_TO_PIECE[ch.toLowerCase()];
          if (type && x < BOARD_COLS) {
            const player: Player = isRed ? 1 : 2;
            board[x][y] = createPiece(type, player, `${isRed ? 'R' : 'B'}-${type}-${x}-${y}`);
          }
          x++;
        }
      }
    }
    const currentPlayer: Player = turnPart === 'b' ? 2 : 1;
    const hash = this.computeZobristHash(board, currentPlayer);
    this.state = {
      board,
      currentPlayer,
      moveHistory: [],
      capturedPieces: [],
      isCheck: false,
      isCheckmate: false,
      isStalemate: false,
      isDraw: false,
      winner: null,
      gameOver: false,
      moveCount: 0,
      lastMove: null,
      positionHashes: [hash],
      repetitionCount: 1,
      movesSinceCapture: 0,
    };
    // Recalculate check status
    this.state.isCheck = this.isInCheck(currentPlayer);
  }

  // -----------------------------------------------------------------
  // Debug helpers
  // -----------------------------------------------------------------

  printBoard(): void {
    const lines: string[] = [];
    for (let y = BOARD_ROWS - 1; y >= 0; y--) {
      let line = `${y} `;
      for (let x = 0; x < BOARD_COLS; x++) {
        const p = this.state.board[x][y];
        if (!p) {
          line += ' . ';
        } else {
          let ch = PIECE_TO_FEN[p.type];
          if (p.player === 1) ch = ch.toUpperCase();
          line += ` ${ch} `;
        }
      }
      lines.push(line);
    }
    lines.push('   0  1  2  3  4  5  6  7  8');
    console.log(lines.join('\n'));
  }
}

export default XiangqiEngine;
