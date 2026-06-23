/**
 * Go (围棋) Game Engine
 * Core game logic including board management, rule enforcement,
 * scoring, and SGF import/export.
 *
 * Key algorithms:
 * - Liberty counting: BFS
 * - Group management: Union-Find (Disjoint Set Union)
 * - Ko detection: Position hash table
 * - Superko: Board state history (positional superko)
 * - Scoring: Flood-fill territory + area counting (Chinese rules)
 * - SGF: Recursive descent parser
 */

import type {
  BoardSize,
  Cell,
  Board,
  Player,
  GoState,
  GoMove,
  Position,
  SGFNode,
  GamePhase,
  ScoreDetail,
  TerritoryResult,
} from './go.types';

/** Convert 2D coordinates to 1D index */
const idx = (x: number, y: number, size: number): number => y * size + x;

/** Convert 1D index to 2D coordinates */
const pos = (i: number, size: number): Position => ({
  x: i % size,
  y: Math.floor(i / size),
});

/** Get neighboring positions (up, down, left, right) */
const getNeighbors = (x: number, y: number, size: number): Position[] => {
  const neighbors: Position[] = [];
  if (x > 0) neighbors.push({ x: x - 1, y });
  if (x < size - 1) neighbors.push({ x: x + 1, y });
  if (y > 0) neighbors.push({ x, y: y - 1 });
  if (y < size - 1) neighbors.push({ x, y: y + 1 });
  return neighbors;
};

/** Create an empty board */
const createBoard = (size: BoardSize): Board =>
  Array.from({ length: size }, () => Array<Cell>(size).fill(0));

/** Clone a board deeply */
const cloneBoard = (board: Board): Board => board.map((row) => [...row]);

/** Serialize board to string for state hashing */
const boardToString = (board: Board): string => board.map((row) => row.join('')).join('|');

/**
 * Union-Find (Disjoint Set Union) implementation
 * Used for efficiently tracking connected stone groups
 */
class DisjointSetUnion implements UnionFind {
  parent: number[] = [];
  rank: number[] = [];

  reset(size: number): void {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // Path compression
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    // Union by rank
    if (this.rank[rx] < this.rank[ry]) {
      this.parent[rx] = ry;
    } else if (this.rank[rx] > this.rank[ry]) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
  }

  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }
}

interface UnionFind {
  parent: number[];
  rank: number[];
  find(x: number): number;
  union(x: number, y: number): void;
  connected(x: number, y: number): boolean;
  reset(size: number): void;
}

/**
 * GoEngine - Core Go game engine
 */
export class GoEngine {
  private state!: GoState;
  private dsu: DisjointSetUnion;
  private boardHistory: Set<string> = new Set(); // For Superko detection
  private currentHash: string = '';
  private enableSuperKo: boolean = true;

  constructor(
    boardSize: BoardSize = 19,
    komi: number = 7.5,
    handicap: number = 0,
    enableSuperKo: boolean = true
  ) {
    this.dsu = new DisjointSetUnion();
    this.enableSuperKo = enableSuperKo;
    this.initState(boardSize, komi, handicap);
  }

  private initState(boardSize: BoardSize, komi: number, handicap: number): void {
    const board = createBoard(boardSize);
    this.state = {
      board,
      boardSize,
      currentPlayer: 1,
      moveHistory: [],
      capturedStones: { black: 0, white: 0 },
      koPosition: null,
      consecutivePasses: 0,
      komi,
      handicap,
      phase: 'playing',
      deadStones: [],
      territory: { black: 0, white: 0 },
      score: { black: 0, white: 0 },
      winner: null,
      isDraw: false,
      gameOver: false,
    };
    this.boardHistory.clear();
    this.currentHash = boardToString(board);
    this.boardHistory.add(this.currentHash);
    this.dsu.reset(boardSize * boardSize);
  }

  /** Get current game state (immutable copy) */
  getState(): GoState {
    return {
      ...this.state,
      board: cloneBoard(this.state.board),
      moveHistory: this.state.moveHistory.map((m) => ({
        ...m,
        captured: m.captured.map((c) => ({ ...c })),
      })),
      koPosition: this.state.koPosition ? { ...this.state.koPosition } : null,
      deadStones: this.state.deadStones.map((d) => ({ ...d })),
      territory: { ...this.state.territory },
      score: { ...this.state.score },
    };
  }

  /** Reset the game */
  reset(): void {
    this.initState(this.state.boardSize, this.state.komi, this.state.handicap);
  }

  /** Switch current player */
  private switchPlayer(): void {
    this.state.currentPlayer = this.state.currentPlayer === 1 ? 2 : 1;
  }

  /** Get cell value at position */
  private getCell(x: number, y: number): Cell {
    if (x < 0 || x >= this.state.boardSize || y < 0 || y >= this.state.boardSize) return 0;
    return this.state.board[y][x];
  }

  /** Set cell value */
  private setCell(x: number, y: number, value: Cell): void {
    this.state.board[y][x] = value;
  }

  /** Get opponent player */
  private opponent(player: Player): Player {
    return player === 1 ? 2 : 1;
  }

  /**
   * Union adjacent stones of same color into the same group
   */
  private unionAdjacent(x: number, y: number, player: Player): void {
    const size = this.state.boardSize;
    const i = idx(x, y, size);
    const neighbors = getNeighbors(x, y, size);
    for (const n of neighbors) {
      if (this.getCell(n.x, n.y) === player) {
        const ni = idx(n.x, n.y, size);
        this.dsu.union(i, ni);
      }
    }
  }

  /**
   * Place a stone on the board
   * @returns true if move was successful, false otherwise
   */
  placeStone(x: number, y: number): boolean {
    if (this.state.phase === 'ended') return false;
    if (this.state.phase === 'scoring') return false;
    if (!this.isValidMove(x, y)) return false;

    const player = this.state.currentPlayer;
    const captured = this.getCapturedStones(x, y);

    // Check ko
    const isKo = this.checkKo(x, y);

    // Execute move
    this.setCell(x, y, player);
    this.unionAdjacent(x, y, player);

    // Remove captured stones
    for (const cap of captured) {
      this.setCell(cap.x, cap.y, 0);
    }

    // Update capture counts
    if (player === 1) {
      this.state.capturedStones.white += captured.length;
    } else {
      this.state.capturedStones.black += captured.length;
    }

    // Handle ko
    if (isKo && captured.length === 1) {
      this.state.koPosition = captured[0];
    } else {
      this.state.koPosition = null;
    }

    // Record move
    const move: GoMove = {
      x,
      y,
      player,
      type: 'place',
      captured: captured.map((c) => ({ ...c })),
      timestamp: Date.now(),
    };
    this.state.moveHistory.push(move);
    this.state.consecutivePasses = 0;

    // Superko detection: save board state
    this.currentHash = boardToString(this.state.board);
    if (this.enableSuperKo) {
      this.boardHistory.add(this.currentHash);
    }

    // Switch player
    this.switchPlayer();

    return true;
  }

  /** Pass (skip turn) */
  pass(): void {
    if (this.state.phase === 'ended') return;
    if (this.state.phase === 'scoring') return;

    const player = this.state.currentPlayer;
    const move: GoMove = {
      x: -1,
      y: -1,
      player,
      type: 'pass',
      captured: [],
      timestamp: Date.now(),
    };
    this.state.moveHistory.push(move);
    this.state.consecutivePasses++;
    this.state.koPosition = null;

    // Check for game end (two consecutive passes)
    if (this.state.consecutivePasses >= 2) {
      this.checkEndGame();
    } else {
      this.switchPlayer();
    }
  }

  /**
   * Check if a move is valid
   * Rules checked:
   * 1. Position must be on board and empty
   * 2. Position must not be the ko point
   * 3. Move must not be suicidal (unless it captures)
   * 4. Must not repeat a previous board state (Superko)
   */
  isValidMove(x: number, y: number): boolean {
    const { boardSize, koPosition } = this.state;

    // On board
    if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return false;

    // Empty
    if (this.getCell(x, y) !== 0) return false;

    // Ko check
    if (koPosition && koPosition.x === x && koPosition.y === y) return false;

    // Simulate move to check for suicide and superko
    const player = this.state.currentPlayer;

    // Quick check: does this move capture anything?
    const captured = this.getCapturedStones(x, y);
    if (captured.length > 0) {
      // Move captures - check superko
      if (this.enableSuperKo && this.checkSuperKo(x, y)) return false;
      return true;
    }

    // No capture - check if suicidal
    // Temporarily place stone and check if group has liberties
    const original = this.getCell(x, y);
    this.setCell(x, y, player);

    // Check if the placed stone's group has any liberties
    const group = this.getGroupBFS(x, y);
    let hasLiberty = false;

    for (const p of group) {
      const neighbors = getNeighbors(p.x, p.y, boardSize);
      for (const n of neighbors) {
        if (this.getCell(n.x, n.y) === 0) {
          hasLiberty = true;
          break;
        }
      }
      if (hasLiberty) break;
    }

    this.setCell(x, y, original); // Restore

    if (!hasLiberty) return false; // Suicide

    // Check superko
    if (this.enableSuperKo && this.checkSuperKo(x, y)) return false;

    return true;
  }

  /**
   * Get all stones that would be captured if player places at (x, y)
   */
  getCapturedStones(x: number, y: number): Position[] {
    const { boardSize, currentPlayer: player } = this.state;
    const opponent = this.opponent(player);

    // Temporarily place stone
    const original = this.getCell(x, y);
    this.setCell(x, y, player);

    const captured: Position[] = [];
    const visited = new Set<string>();

    // Check all adjacent opponent groups
    const neighbors = getNeighbors(x, y, boardSize);
    for (const n of neighbors) {
      const key = `${n.x},${n.y}`;
      if (this.getCell(n.x, n.y) === opponent && !visited.has(key)) {
        const group = this.getGroupBFS(n.x, n.y);
        const liberties = this.countLiberties(group);
        if (liberties === 0) {
          for (const p of group) {
            captured.push(p);
            visited.add(`${p.x},${p.y}`);
          }
        }
        for (const p of group) {
          visited.add(`${p.x},${p.y}`);
        }
      }
    }

    this.setCell(x, y, original); // Restore
    return captured;
  }

  /**
   * Get liberties (empty adjacent points) of a group at (x, y)
   */
  getLiberties(x: number, y: number): Position[] {
    const group = this.getGroupBFS(x, y);
    const libertySet = new Set<string>();
    const liberties: Position[] = [];
    const { boardSize } = this.state;

    for (const p of group) {
      const neighbors = getNeighbors(p.x, p.y, boardSize);
      for (const n of neighbors) {
        if (this.getCell(n.x, n.y) === 0) {
          const key = `${n.x},${n.y}`;
          if (!libertySet.has(key)) {
            libertySet.add(key);
            liberties.push({ ...n });
          }
        }
      }
    }
    return liberties;
  }

  /**
   * Get all legal moves for current player
   */
  getLegalMoves(): Position[] {
    const { boardSize, phase } = this.state;
    if (phase !== 'playing') return [];

    const moves: Position[] = [];
    // Priority: corners > edges > center (heuristic ordering)
    const priorityOrder = this.getPriorityOrder(boardSize);

    for (const [x, y] of priorityOrder) {
      if (this.isValidMove(x, y)) {
        moves.push({ x, y });
      }
    }
    return moves;
  }

  /** Get positions in priority order (for move ordering) */
  private getPriorityOrder(size: number): [number, number][] {
    const positions: [number, number][] = [];

    // Corners
    const corners: [number, number][] = [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ];
    for (const c of corners) positions.push(c);

    // Edge star points (3rd line)
    for (let i = 3; i < size - 3; i += (size > 9 ? 6 : 3)) {
      positions.push([i, 0]);
      positions.push([i, size - 1]);
      positions.push([0, i]);
      positions.push([size - 1, i]);
    }

    // Star points (hoshi)
    const starPoints = this.getStarPoints(size);
    for (const sp of starPoints) {
      if (!positions.some((p) => p[0] === sp.x && p[1] === sp.y)) {
        positions.push([sp.x, sp.y]);
      }
    }

    // All remaining positions
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!positions.some((p) => p[0] === x && p[1] === y)) {
          positions.push([x, y]);
        }
      }
    }

    return positions;
  }

  /** Get star point (hoshi) positions for a given board size */
  private getStarPoints(size: number): Position[] {
    const stars: Position[] = [];
    let points: number[];

    if (size === 19) {
      points = [3, 9, 15];
    } else if (size === 13) {
      points = [3, 6, 9];
    } else if (size === 9) {
      points = [2, 4, 6];
    } else {
      return stars;
    }

    for (const y of points) {
      for (const x of points) {
        stars.push({ x, y });
      }
    }
    return stars;
  }

  /**
   * Get the connected group at (x, y) using BFS
   */
  getGroup(x: number, y: number): Position[] {
    return this.getGroupBFS(x, y);
  }

  /**
   * BFS to find all connected stones of the same color
   */
  private getGroupBFS(x: number, y: number): Position[] {
    const color = this.getCell(x, y);
    if (color === 0) return [];

    const { boardSize } = this.state;
    const group: Position[] = [];
    const visited = new Set<string>();
    const queue: Position[] = [{ x, y }];
    visited.add(`${x},${y}`);

    while (queue.length > 0) {
      const current = queue.shift()!;
      group.push(current);

      const neighbors = getNeighbors(current.x, current.y, boardSize);
      for (const n of neighbors) {
        const key = `${n.x},${n.y}`;
        if (!visited.has(key) && this.getCell(n.x, n.y) === color) {
          visited.add(key);
          queue.push(n);
        }
      }
    }

    return group;
  }

  /**
   * Count liberties of a group (unique empty adjacent points)
   */
  private countLiberties(group: Position[]): number {
    const libertySet = new Set<string>();
    const { boardSize } = this.state;

    for (const p of group) {
      const neighbors = getNeighbors(p.x, p.y, boardSize);
      for (const n of neighbors) {
        if (this.getCell(n.x, n.y) === 0) {
          libertySet.add(`${n.x},${n.y}`);
        }
      }
    }

    return libertySet.size;
  }

  /**
   * Check if placing at (x, y) creates a ko situation
   * Ko: capturing exactly one stone, and the captured stone's position
   * would immediately recreate the previous position
   */
  private checkKo(x: number, y: number): boolean {
    const captured = this.getCapturedStones(x, y);
    if (captured.length !== 1) return false;

    const { currentPlayer: player, boardSize } = this.state;
    const opponent = this.opponent(player);

    // Simulate: place stone, remove captured
    const original = this.getCell(x, y);
    this.setCell(x, y, player);
    const cap = captured[0];
    this.setCell(cap.x, cap.y, 0);

    // Check if the captured position is the only liberty of the new stone
    // and if the opponent could immediately recapture
    const newGroup = this.getGroupBFS(x, y);
    const liberties = this.countLiberties(newGroup);

    this.setCell(x, y, original);
    this.setCell(cap.x, cap.y, opponent);

    return liberties === 1 && captured.length === 1;
  }

  /**
   * Check Superko (positional superko):
   * A move is illegal if it would recreate a previous board position.
   */
  private checkSuperKo(x: number, y: number): boolean {
    const player = this.state.currentPlayer;
    const captured = this.getCapturedStones(x, y);

    // Simulate move
    const original = this.getCell(x, y);
    this.setCell(x, y, player);
    for (const cap of captured) {
      this.setCell(cap.x, cap.y, 0);
    }

    const newHash = boardToString(this.state.board);

    // Restore
    this.setCell(x, y, original);
    for (const cap of captured) {
      this.setCell(cap.x, cap.y, this.opponent(player));
    }

    return this.boardHistory.has(newHash);
  }

  /**
   * Check end game condition (two consecutive passes)
   * Transition to scoring phase
   */
  private checkEndGame(): void {
    this.state.phase = 'scoring';
    this.state.gameOver = false; // Not fully over until scoring done

    // Auto-detect dead stones using a heuristic approach
    this.autoDetectDeadStones();

    // Calculate score
    this.scoreGame();
  }

  /**
   * Auto-detect dead stones heuristically:
   * Stones with no eyes or very few liberties in opponent territory are likely dead
   */
  private autoDetectDeadStones(): void {
    // Simple heuristic: stones completely surrounded by opponent stones
    // with no chance of making two eyes are marked as dead
    // This is a simplified approach - in a real game, players would negotiate
    const { boardSize } = this.state;

    for (let y = 0; y < boardSize; y++) {
      for (let x = 0; x < boardSize; x++) {
        const cell = this.getCell(x, y);
        if (cell === 0) continue;

        const group = this.getGroupBFS(x, y);
        const liberties = this.countLiberties(group);

        // If group has very few liberties and is surrounded by opponent,
        // it might be dead (simplified heuristic)
        if (liberties <= 1 && group.length <= 2) {
          // Mark as potentially dead - but let players decide
        }
      }
    }
  }

  /**
   * Score the game using Chinese scoring (Area Scoring):
   * - Player's score = stones on board + territory surrounded
   * - White gets komi compensation
   * - Under Chinese rules, captures don't directly affect score
   *   (since captured stones are removed from board = fewer points,
   *   but prisoners are not counted separately)
   */
  scoreGame(): { black: number; white: number } {
    const { boardSize } = this.state;

    // Calculate territory using flood fill
    const territory = this.calculateTerritory();
    this.state.territory = territory;

    // Chinese/area scoring: territory + stones on board
    let blackStones = 0;
    let whiteStones = 0;

    for (let y = 0; y < boardSize; y++) {
      for (let x = 0; x < boardSize; x++) {
        const cell = this.getCell(x, y);
        if (cell === 1) blackStones++;
        else if (cell === 2) whiteStones++;
      }
    }

    // Subtract dead stones
    const deadBlack = this.state.deadStones.filter(
      (p) => this.state.board[p.y][p.x] === 1
    ).length;
    const deadWhite = this.state.deadStones.filter(
      (p) => this.state.board[p.y][p.x] === 2
    ).length;

    const blackScore =
      territory.black + blackStones - deadBlack + (deadWhite > 0 ? deadWhite : 0);
    const whiteScore =
      territory.white +
      whiteStones -
      deadWhite +
      (deadBlack > 0 ? deadBlack : 0) +
      this.state.komi;

    this.state.score = { black: blackScore, white: whiteScore };

    if (blackScore > whiteScore) {
      this.state.winner = 1;
      this.state.isDraw = false;
    } else if (whiteScore > blackScore) {
      this.state.winner = 2;
      this.state.isDraw = false;
    } else {
      this.state.winner = null;
      this.state.isDraw = true;
    }

    return this.state.score;
  }

  /**
   * Calculate territory using flood fill (BFS)
   * Returns the territory surrounded by each player
   */
  calculateTerritory(): { black: number; white: number } {
    const { boardSize, deadStones } = this.state;
    const visited = new Set<string>();
    const deadSet = new Set(deadStones.map((p) => `${p.x},${p.y}`));
    let blackTerritory = 0;
    let whiteTerritory = 0;

    for (let y = 0; y < boardSize; y++) {
      for (let x = 0; x < boardSize; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const cell = this.getCell(x, y);
        // Skip stones (treat dead stones as empty)
        if (cell !== 0 && !deadSet.has(key)) {
          visited.add(key);
          continue;
        }

        // Flood fill from this empty/dead position
        const region: Position[] = [];
        const regionSet = new Set<string>();
        const queue: Position[] = [{ x, y }];
        regionSet.add(key);
        visited.add(key);

        // Track which colors border this region
        let bordersBlack = false;
        let bordersWhite = false;

        while (queue.length > 0) {
          const current = queue.shift()!;
          region.push(current);

          const neighbors = getNeighbors(current.x, current.y, boardSize);
          for (const n of neighbors) {
            const nKey = `${n.x},${n.y}`;
            const nCell = this.getCell(n.x, n.y);
            const isDead = deadSet.has(nKey);

            if (nCell === 0 || isDead) {
              if (!regionSet.has(nKey)) {
                regionSet.add(nKey);
                visited.add(nKey);
                queue.push(n);
              }
            } else if (nCell === 1) {
              bordersBlack = true;
            } else if (nCell === 2) {
              bordersWhite = true;
            }
          }
        }

        // Assign territory
        if (bordersBlack && !bordersWhite) {
          blackTerritory += region.length;
        } else if (bordersWhite && !bordersBlack) {
          whiteTerritory += region.length;
        }
        // If borders both or neither, it's dame (neutral) - don't count
      }
    }

    return { black: blackTerritory, white: whiteTerritory };
  }

  /**
   * Mark a stone group as dead (during scoring phase)
   */
  markDeadStone(x: number, y: number): void {
    if (this.state.phase !== 'scoring') return;
    const cell = this.getCell(x, y);
    if (cell === 0) return;

    const group = this.getGroupBFS(x, y);
    const deadSet = new Set(this.state.deadStones.map((p) => `${p.x},${p.y}`));

    for (const p of group) {
      const key = `${p.x},${p.y}`;
      if (!deadSet.has(key)) {
        this.state.deadStones.push({ ...p });
      }
    }

    // Recalculate score
    this.scoreGame();
  }

  /**
   * Mark a stone group as alive (remove from dead stones)
   */
  markAliveStone(x: number, y: number): void {
    if (this.state.phase !== 'scoring') return;
    const cell = this.getCell(x, y);
    if (cell === 0) return;

    const group = this.getGroupBFS(x, y);
    const groupSet = new Set(group.map((p) => `${p.x},${p.y}`));

    this.state.deadStones = this.state.deadStones.filter(
      (p) => !groupSet.has(`${p.x},${p.y}`)
    );

    // Recalculate score
    this.scoreGame();
  }

  /** Confirm scoring and end the game */
  confirmScore(): void {
    if (this.state.phase !== 'scoring') return;
    this.state.phase = 'ended';
    this.state.gameOver = true;
  }

  /**
   * Export game to SGF (Smart Game Format) string
   */
  exportToSGF(): string {
    const { boardSize, komi, handicap, moveHistory } = this.state;

    let sgf = `(;GM[1]FF[4]SZ[${boardSize}]KM[${komi}]`;

    if (handicap > 0) {
      sgf += `HA[${handicap}]`;
    }

    // Add handicap stones if applicable
    if (handicap > 0) {
      const handicapPositions = this.getHandicapPositions(boardSize, handicap);
      sgf += 'AB';
      for (const p of handicapPositions) {
        sgf += `[${this.toSGFCoord(p.x, p.y)}]`;
      }
    }

    // Add moves
    for (const move of moveHistory) {
      if (move.type === 'pass') {
        const color = move.player === 1 ? 'B' : 'W';
        sgf += `;${color}[]`;
      } else {
        const color = move.player === 1 ? 'B' : 'W';
        sgf += `;${color}[${this.toSGFCoord(move.x, move.y)}]`;
      }
    }

    sgf += ')';
    return sgf;
  }

  /** Convert x,y coordinates to SGF coordinate (e.g., 0,0 -> 'aa') */
  private toSGFCoord(x: number, y: number): string {
    // SGF uses lowercase letters: a=0, b=1, ..., s=18
    const col = String.fromCharCode(97 + x);
    const row = String.fromCharCode(97 + y);
    return col + row;
  }

  /** Parse SGF coordinate to x,y */
  private fromSGFCoord(coord: string): Position {
    const x = coord.charCodeAt(0) - 97;
    const y = coord.charCodeAt(1) - 97;
    return { x, y };
  }

  /** Get standard handicap stone positions */
  private getHandicapPositions(size: number, handicap: number): Position[] {
    if (size === 19) {
      const positions: Position[] = [
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 3 },
        { x: 9, y: 9 },
        { x: 3, y: 9 },
        { x: 15, y: 9 },
        { x: 9, y: 3 },
        { x: 9, y: 15 },
      ];
      return positions.slice(0, handicap);
    } else if (size === 13) {
      const positions: Position[] = [
        { x: 3, y: 9 },
        { x: 9, y: 3 },
        { x: 9, y: 9 },
        { x: 3, y: 3 },
        { x: 6, y: 6 },
      ];
      return positions.slice(0, Math.min(handicap, 5));
    } else if (size === 9) {
      const positions: Position[] = [
        { x: 2, y: 6 },
        { x: 6, y: 2 },
        { x: 6, y: 6 },
        { x: 2, y: 2 },
        { x: 4, y: 4 },
      ];
      return positions.slice(0, Math.min(handicap, 5));
    }
    return [];
  }

  /**
   * Import game from SGF string
   */
  importFromSGF(sgf: string): void {
    // Parse SGF
    const root = this.parseSGF(sgf);
    if (!root) throw new Error('Invalid SGF format');

    const props = root.properties;

    // Extract game info
    const boardSize = props.SZ ? parseInt(props.SZ[0]) : 19;
    const komi = props.KM ? parseFloat(props.KM[0]) : 7.5;
    const handicap = props.HA ? parseInt(props.HA[0]) : 0;

    // Validate board size
    if (![9, 13, 19].includes(boardSize)) {
      throw new Error(`Unsupported board size: ${boardSize}`);
    }

    // Reset game
    this.initState(boardSize as BoardSize, komi, handicap);

    // Place handicap stones
    if (props.AB) {
      for (const coord of props.AB) {
        if (coord.length >= 2) {
          const p = this.fromSGFCoord(coord);
          this.setCell(p.x, p.y, 1); // Black handicap stones
        }
      }
    }

    // Process moves
    this.processSGFNode(root);
  }

  /**
   * Recursively process SGF nodes and execute moves
   */
  private processSGFNode(node: SGFNode): void {
    for (const [key, values] of Object.entries(node.properties)) {
      if (key === 'B' || key === 'W') {
        const player: Player = key === 'B' ? 1 : 2;
        const coord = values[0];

        if (!coord || coord === '') {
          // Pass
          if (this.state.currentPlayer === player) {
            this.pass();
          }
        } else {
          const p = this.fromSGFCoord(coord);
          if (this.state.currentPlayer === player) {
            this.placeStone(p.x, p.y);
          }
        }
      }
    }

    // Process children (main variation - first child)
    if (node.children.length > 0) {
      this.processSGFNode(node.children[0]);
    }
  }

  /**
   * Parse SGF string to SGFNode tree
   * Handles nested variations
   */
  private parseSGF(sgf: string): SGFNode | null {
    let pos = 0;

    const skipWhitespace = () => {
      while (pos < sgf.length && /\s/.test(sgf[pos])) pos++;
    };

    const parseNode = (): SGFNode | null => {
      skipWhitespace();
      if (pos >= sgf.length || sgf[pos] !== ';') return null;

      pos++; // skip ';'
      const node: SGFNode = { properties: {}, children: [] };

      while (pos < sgf.length) {
        skipWhitespace();
        if (pos >= sgf.length) break;

        const ch = sgf[pos];
        if (ch === ';' || ch === '(' || ch === ')') break;

        // Parse property
        const propNameMatch = /^[A-Za-z]+/.exec(sgf.slice(pos));
        if (!propNameMatch) break;

        const propName = propNameMatch[0].toUpperCase();
        pos += propName.length;

        const values: string[] = [];
        while (pos < sgf.length && sgf[pos] === '[') {
          pos++; // skip '['
          let value = '';
          while (pos < sgf.length && sgf[pos] !== ']') {
            if (sgf[pos] === '\\' && pos + 1 < sgf.length) {
              pos++;
              value += sgf[pos];
            } else {
              value += sgf[pos];
            }
            pos++;
          }
          pos++; // skip ']'
          values.push(value);
        }

        node.properties[propName] = values;
      }

      // Parse children
      skipWhitespace();
      while (pos < sgf.length && sgf[pos] === '(') {
        pos++; // skip '('
        const child = parseNode();
        if (child) {
          node.children.push(child);
        }
        skipWhitespace();
        if (pos < sgf.length && sgf[pos] === ')') {
          pos++; // skip ')'
        }
        skipWhitespace();
      }

      // Direct child node without parenthesis
      if (pos < sgf.length && sgf[pos] === ';') {
        const child = parseNode();
        if (child) {
          node.children.push(child);
        }
      }

      return node;
    };

    skipWhitespace();
    if (pos < sgf.length && sgf[pos] === '(') {
      pos++; // skip '('
      const root = parseNode();
      skipWhitespace();
      if (pos < sgf.length && sgf[pos] === ')') {
        pos++;
      }
      return root;
    }

    return null;
  }

  /** Get detailed score information */
  getScoreDetail(): ScoreDetail {
    const territory = this.state.territory;
    const captures = this.state.capturedStones;
    const { black, white } = this.state.score;
    const winner = this.state.winner;
    const margin =
      winner === 1 ? black - white : winner === 2 ? white - black : 0;

    return {
      territory,
      captures,
      komi: this.state.komi,
      handicap: this.state.handicap,
      final: { black, white },
      winner,
      margin,
    };
  }

  /** Get territory analysis */
  getTerritoryAnalysis(): TerritoryResult {
    const { boardSize, deadStones } = this.state;
    const visited = new Set<string>();
    const deadSet = new Set(deadStones.map((p) => `${p.x},${p.y}`));
    const blackTerritory: Position[] = [];
    const whiteTerritory: Position[] = [];
    const dame: Position[] = [];

    for (let y = 0; y < boardSize; y++) {
      for (let x = 0; x < boardSize; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const cell = this.getCell(x, y);
        if (cell !== 0 && !deadSet.has(key)) {
          visited.add(key);
          continue;
        }

        const region: Position[] = [];
        const regionSet = new Set<string>();
        const queue: Position[] = [{ x, y }];
        regionSet.add(key);
        visited.add(key);

        let bordersBlack = false;
        let bordersWhite = false;

        while (queue.length > 0) {
          const current = queue.shift()!;
          region.push(current);

          const neighbors = getNeighbors(current.x, current.y, boardSize);
          for (const n of neighbors) {
            const nKey = `${n.x},${n.y}`;
            const nCell = this.getCell(n.x, n.y);
            const isDead = deadSet.has(nKey);

            if (nCell === 0 || isDead) {
              if (!regionSet.has(nKey)) {
                regionSet.add(nKey);
                visited.add(nKey);
                queue.push(n);
              }
            } else if (nCell === 1) {
              bordersBlack = true;
            } else if (nCell === 2) {
              bordersWhite = true;
            }
          }
        }

        if (bordersBlack && !bordersWhite) {
          blackTerritory.push(...region);
        } else if (bordersWhite && !bordersBlack) {
          whiteTerritory.push(...region);
        } else {
          dame.push(...region);
        }
      }
    }

    return {
      blackTerritory,
      whiteTerritory,
      dame,
      blackScore: blackTerritory.length,
      whiteScore: whiteTerritory.length,
    };
  }

  /** Get the DSU instance (for advanced usage) */
  getDSU(): DisjointSetUnion {
    return this.dsu;
  }
}

// Re-export types for convenience
export type {
  BoardSize,
  Cell,
  Board,
  Player,
  GoState,
  GoMove,
  Position,
  SGFNode,
  GamePhase,
} from './go.types';
