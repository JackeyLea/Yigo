/**
 * Go (围棋) AI - Monte Carlo Tree Search (MCTS) Implementation
 *
 * Four difficulty levels:
 * - beginner:    Random + Greedy (prioritize corners and edges)
 * - elementary:  MCTS with 100 simulations
 * - intermediate: MCTS with 1,000 simulations
 * - advanced:    MCTS with 5,000 simulations + heuristics
 *
 * MCTS Algorithm:
 * 1. Selection:   Traverse tree using UCT formula
 * 2. Expansion:   Add new child node
 * 3. Simulation:  Random playout to terminal
 * 4. Backpropagation: Update node statistics
 *
 * UCT Formula: Q/N + C * sqrt(ln(P_parent) / N)
 * where C = sqrt(2)
 */

import type {
  GoState,
  Position,
  Player,
  Cell,
  BoardSize,
  Board,
  AIDifficultyConfig,
} from '../go.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MCTS tree node */
interface MCTSNode {
  state: GoState;
  parent: MCTSNode | null;
  children: MCTSNode[];
  move: Position | null; // Move that led to this node (null for root)
  untriedMoves: Position[];
  visits: number;
  wins: number; // From perspective of player who just moved
  playerJustMoved: Player;
  isTerminal: boolean;
}

/** Simulation result */
interface SimResult {
  winner: Player | null;
  margin: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPLORATION_CONSTANT = Math.sqrt(2);

const DIFFICULTY_CONFIGS: Record<string, AIDifficultyConfig> = {
  beginner: {
    name: 'Beginner',
    simulations: 0,
    useHeuristics: false,
    explorationConstant: 0,
    maxPlayoutDepth: 0,
  },
  elementary: {
    name: 'Elementary',
    simulations: 100,
    useHeuristics: false,
    explorationConstant: EXPLORATION_CONSTANT,
    maxPlayoutDepth: 200,
  },
  intermediate: {
    name: 'Intermediate',
    simulations: 1000,
    useHeuristics: false,
    explorationConstant: EXPLORATION_CONSTANT,
    maxPlayoutDepth: 200,
  },
  advanced: {
    name: 'Advanced',
    simulations: 5000,
    useHeuristics: true,
    explorationConstant: EXPLORATION_CONSTANT,
    maxPlayoutDepth: 250,
  },
};

// Corner and edge weights for beginner heuristic
const CORNER_WEIGHT = 10;
const EDGE_WEIGHT = 5;
const CENTER_WEIGHT = 1;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/** Clone a board deeply */
function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/** Get neighbors of a position */
function getNeighbors(x: number, y: number, size: number): Position[] {
  const neighbors: Position[] = [];
  if (x > 0) neighbors.push({ x: x - 1, y });
  if (x < size - 1) neighbors.push({ x: x + 1, y });
  if (y > 0) neighbors.push({ x, y: y - 1 });
  if (y < size - 1) neighbors.push({ x, y: y + 1 });
  return neighbors;
}

/** Check if position is a corner */
function isCorner(x: number, y: number, size: number): boolean {
  return (
    (x === 0 || x === size - 1) && (y === 0 || y === size - 1)
  );
}

/** Check if position is on the edge */
function isEdge(x: number, y: number, size: number): boolean {
  return x === 0 || x === size - 1 || y === 0 || y === size - 1;
}

/** Check if position is a star point (hoshi) */
function isStarPoint(x: number, y: number, size: number): boolean {
  const starPoints: Record<number, number[]> = {
    9: [2, 4, 6],
    13: [3, 6, 9],
    19: [3, 9, 15],
  };
  const points = starPoints[size];
  if (!points) return false;
  return points.includes(x) && points.includes(y);
}

/** Get opponent player */
function opponent(player: Player): Player {
  return player === 1 ? 2 : 1;
}

/** Get cell from board */
function getCell(board: Board, x: number, y: number): Cell {
  return board[y][x];
}

/** Set cell on board */
function setCell(board: Board, x: number, y: number, value: Cell): void {
  board[y][x] = value;
}

// ---------------------------------------------------------------------------
// Board State Copying
// ---------------------------------------------------------------------------

/** Create a lightweight copy of state for simulation */
function copyState(state: GoState): GoState {
  return {
    ...state,
    board: cloneBoard(state.board),
    moveHistory: [...state.moveHistory],
    capturedStones: { ...state.capturedStones },
    koPosition: state.koPosition ? { ...state.koPosition } : null,
    deadStones: [...state.deadStones],
    territory: { ...state.territory },
    score: { ...state.score },
  };
}

// ---------------------------------------------------------------------------
// Move Generation (lightweight, engine-free)
// ---------------------------------------------------------------------------

/**
 * Get all legal moves for a given state (lightweight check)
 * Used during MCTS simulation - doesn't use the full engine
 */
function getLegalMovesForState(state: GoState): Position[] {
  const { board, boardSize, currentPlayer, koPosition } = state;
  const moves: Position[] = [];

  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      if (board[y][x] !== 0) continue;

      // Ko check
      if (koPosition && koPosition.x === x && koPosition.y === y) continue;

      if (isValidMoveLight(board, x, y, currentPlayer, boardSize)) {
        moves.push({ x, y });
      }
    }
  }

  return moves;
}

/**
 * Lightweight move validation for simulation
 * Checks: empty, on-board, not suicide, not ko
 */
function isValidMoveLight(
  board: Board,
  x: number,
  y: number,
  player: Player,
  size: number
): boolean {
  if (x < 0 || x >= size || y < 0 || y >= size) return false;
  if (board[y][x] !== 0) return false;

  // Check if move captures anything
  const captures = getCaptures(board, x, y, player, size);
  if (captures.length > 0) return true;

  // Check for suicide
  const simBoard = cloneBoard(board);
  setCell(simBoard, x, y, player);

  // Check if the placed stone has liberties
  const group = getGroupBFS(simBoard, x, y, size);
  return countLiberties(simBoard, group, size) > 0;
}

/** Get stones that would be captured by playing at (x, y) */
function getCaptures(
  board: Board,
  x: number,
  y: number,
  player: Player,
  size: number
): Position[] {
  const opp = opponent(player);
  const simBoard = cloneBoard(board);
  setCell(simBoard, x, y, player);

  const captured: Position[] = [];
  const visited = new Set<string>();

  const neighbors = getNeighbors(x, y, size);
  for (const n of neighbors) {
    const key = `${n.x},${n.y}`;
    if (getCell(simBoard, n.x, n.y) === opp && !visited.has(key)) {
      const group = getGroupBFS(simBoard, n.x, n.y, size);
      if (countLiberties(simBoard, group, size) === 0) {
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

  return captured;
}

/** BFS to find connected group */
function getGroupBFS(board: Board, x: number, y: number, size: number): Position[] {
  const color = getCell(board, x, y);
  if (color === 0) return [];

  const group: Position[] = [];
  const visited = new Set<string>();
  const queue: Position[] = [{ x, y }];
  visited.add(`${x},${y}`);

  while (queue.length > 0) {
    const current = queue.shift()!;
    group.push(current);

    const neighbors = getNeighbors(current.x, current.y, size);
    for (const n of neighbors) {
      const key = `${n.x},${n.y}`;
      if (!visited.has(key) && getCell(board, n.x, n.y) === color) {
        visited.add(key);
        queue.push(n);
      }
    }
  }

  return group;
}

/** Count liberties of a group */
function countLiberties(board: Board, group: Position[], size: number): number {
  const libertySet = new Set<string>();

  for (const p of group) {
    const neighbors = getNeighbors(p.x, p.y, size);
    for (const n of neighbors) {
      if (getCell(board, n.x, n.y) === 0) {
        libertySet.add(`${n.x},${n.y}`);
      }
    }
  }

  return libertySet.size;
}

/** Play a move on a simulated board state */
function playMove(state: GoState, move: Position | null): GoState {
  const newState = copyState(state);

  if (move === null) {
    // Pass
    newState.consecutivePasses++;
    newState.koPosition = null;
    newState.currentPlayer = opponent(newState.currentPlayer);
    return newState;
  }

  const { x, y } = move;
  const player = newState.currentPlayer;

  // Place stone
  setCell(newState.board, x, y, player);

  // Capture opponent stones
  const opp = opponent(player);
  const captured = getCaptures(newState.board, x, y, player, newState.boardSize);
  for (const cap of captured) {
    setCell(newState.board, cap.x, cap.y, 0);
  }

  // Update captures count
  if (player === 1) {
    newState.capturedStones.white += captured.length;
  } else {
    newState.capturedStones.black += captured.length;
  }

  // Ko detection
  if (captured.length === 1) {
    newState.koPosition = captured[0];
  } else {
    newState.koPosition = null;
  }

  newState.consecutivePasses = 0;
  newState.currentPlayer = opponent(player);

  return newState;
}

/** Quick territory estimation for simulation scoring */
function estimateScore(state: GoState): { black: number; white: number } {
  const { board, boardSize, komi, capturedStones } = state;
  let blackScore = 0;
  let whiteScore = 0;

  // Stones on board + territory
  const visited = new Set<string>();

  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const cell = getCell(board, x, y);
      if (cell === 1) {
        blackScore++;
      } else if (cell === 2) {
        whiteScore++;
      } else if (!visited.has(`${x},${y}`)) {
        // Flood fill to find territory
        const region: Position[] = [];
        const regionSet = new Set<string>();
        const queue: Position[] = [{ x, y }];
        regionSet.add(`${x},${y}`);
        visited.add(`${x},${y}`);

        let bordersBlack = false;
        let bordersWhite = false;

        while (queue.length > 0) {
          const current = queue.shift()!;
          region.push(current);

          const neighbors = getNeighbors(current.x, current.y, boardSize);
          for (const n of neighbors) {
            const nKey = `${n.x},${n.y}`;
            const nCell = getCell(board, n.x, n.y);
            if (nCell === 0 && !regionSet.has(nKey)) {
              regionSet.add(nKey);
              visited.add(nKey);
              queue.push(n);
            } else if (nCell === 1) {
              bordersBlack = true;
            } else if (nCell === 2) {
              bordersWhite = true;
            }
          }
        }

        if (bordersBlack && !bordersWhite) {
          blackScore += region.length;
        } else if (bordersWhite && !bordersBlack) {
          whiteScore += region.length;
        }
      }
    }
  }

  // Add komi and captured stones (simplified scoring)
  whiteScore += komi;

  return { black: blackScore, white: whiteScore };
}

// ---------------------------------------------------------------------------
// MCTS Implementation
// ---------------------------------------------------------------------------

/**
 * Create a new MCTS node
 */
function createNode(
  state: GoState,
  parent: MCTSNode | null = null,
  move: Position | null = null
): MCTSNode {
  const legalMoves = getLegalMovesForState(state);
  const isTerminal =
    state.consecutivePasses >= 2 || legalMoves.length === 0;

  return {
    state: copyState(state),
    parent,
    children: [],
    move,
    untriedMoves: legalMoves,
    visits: 0,
    wins: 0,
    playerJustMoved: state.currentPlayer === 1 ? 2 : 1, // Player who made the move to reach this state
    isTerminal,
  };
}

/**
 * UCT (Upper Confidence Bound applied to Trees) selection
 */
function uctSelect(node: MCTSNode, c: number): MCTSNode | null {
  if (node.children.length === 0) return null;

  let bestChild: MCTSNode | null = null;
  let bestValue = -Infinity;

  const logParentVisits = Math.log(node.visits || 1);

  for (const child of node.children) {
    if (child.visits === 0) {
      return child; // Unvisited child has priority
    }

    // UCT formula: exploitation + exploration
    const exploitation = child.wins / child.visits;
    const exploration = c * Math.sqrt(logParentVisits / child.visits);
    const uctValue = exploitation + exploration;

    if (uctValue > bestValue) {
      bestValue = uctValue;
      bestChild = child;
    }
  }

  return bestChild;
}

/**
 * Random playout (simulation) from a given state
 * Returns the winner from the perspective of the original player
 */
function randomPlayout(
  state: GoState,
  maxDepth: number,
  rootPlayer: Player
): SimResult {
  let simState = copyState(state);
  let depth = 0;

  while (simState.consecutivePasses < 2 && depth < maxDepth) {
    const legalMoves = getLegalMovesForState(simState);

    if (legalMoves.length === 0) {
      // No legal moves, pass
      simState = playMove(simState, null);
    } else {
      // Choose random move with slight heuristic bias
      const move = selectPlayoutMove(simState, legalMoves);
      simState = playMove(simState, move);
    }

    depth++;
  }

  // Score the final position
  const scores = estimateScore(simState);

  if (scores.black > scores.white) {
    return { winner: 1, margin: scores.black - scores.white };
  } else if (scores.white > scores.black) {
    return { winner: 2, margin: scores.white - scores.black };
  } else {
    return { winner: null, margin: 0 };
  }
}

/**
 * Select a move during playout with slight heuristics
 * Prioritizes captures, extensions, and connections
 */
function selectPlayoutMove(state: GoState, legalMoves: Position[]): Position {
  // With 80% probability, pick purely random
  // With 20% probability, use heuristic
  if (Math.random() < 0.8 || legalMoves.length < 5) {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  // Heuristic: prefer moves near existing stones (local play)
  const { board, boardSize } = state;
  const scoredMoves: { move: Position; score: number }[] = [];

  for (const move of legalMoves) {
    let score = Math.random() * 0.1; // Small random component

    // Prefer moves adjacent to existing stones
    const neighbors = getNeighbors(move.x, move.y, boardSize);
    for (const n of neighbors) {
      if (board[n.y][n.x] !== 0) {
        score += 0.5;
      }
    }

    // Prefer star points
    if (isStarPoint(move.x, move.y, boardSize)) {
      score += 0.3;
    }

    scoredMoves.push({ move, score });
  }

  scoredMoves.sort((a, b) => b.score - a.score);

  // Pick one of the top 3 moves
  const topN = Math.min(3, scoredMoves.length);
  return scoredMoves[Math.floor(Math.random() * topN)].move;
}

/**
 * Run MCTS search and return the best move
 */
function runMCTS(
  state: GoState,
  config: AIDifficultyConfig
): Position | null {
  const { simulations, explorationConstant, maxPlayoutDepth, useHeuristics } =
    config;
  const rootPlayer = state.currentPlayer;

  // Check if we should pass (no legal moves or resign condition)
  const legalMoves = getLegalMovesForState(state);
  if (legalMoves.length === 0) {
    return null; // Pass
  }

  // Create root node
  const root = createNode(state);

  // Run simulations
  for (let i = 0; i < simulations; i++) {
    // 1. Selection: Traverse tree using UCT
    let node = root;

    while (
      node.untriedMoves.length === 0 &&
      node.children.length > 0 &&
      !node.isTerminal
    ) {
      const selected = uctSelect(node, explorationConstant);
      if (!selected) break;
      node = selected;
    }

    // 2. Expansion: Add a new child if possible
    if (node.untriedMoves.length > 0 && !node.isTerminal) {
      const moveIndex = Math.floor(Math.random() * node.untriedMoves.length);
      const move = node.untriedMoves[moveIndex];
      node.untriedMoves.splice(moveIndex, 1);

      const newState = playMove(node.state, move);
      const child = createNode(newState, node, move);
      node.children.push(child);
      node = child;
    }

    // 3. Simulation: Random playout
    const result = randomPlayout(
      node.state,
      maxPlayoutDepth,
      rootPlayer
    );

    // 4. Backpropagation: Update statistics
    let current: MCTSNode | null = node;
    while (current !== null) {
      current.visits++;

      // Win from perspective of player who just moved to reach this node
      if (result.winner === null) {
        current.wins += 0.5; // Draw
      } else if (result.winner !== current.playerJustMoved) {
        current.wins += 1;
      }

      current = current.parent;
    }
  }

  // Select best move: most visits (robust child)
  let bestChild: MCTSNode | null = null;
  let maxVisits = -1;

  for (const child of root.children) {
    const visitCount = child.visits;
    let score = visitCount;

    // Apply heuristics for advanced difficulty
    if (useHeuristics && child.move !== null) {
      score += applyHeuristics(state, child.move, visitCount);
    }

    if (score > maxVisits) {
      maxVisits = score;
      bestChild = child;
    }
  }

  if (bestChild && bestChild.move) {
    return bestChild.move;
  }

  // Fallback: random legal move
  return legalMoves.length > 0
    ? legalMoves[Math.floor(Math.random() * legalMoves.length)]
    : null;
}

/**
 * Apply heuristics to boost certain moves
 * Used in advanced difficulty
 */
function applyHeuristics(
  state: GoState,
  move: Position,
  baseScore: number
): number {
  const { board, boardSize } = state;
  const { x, y } = move;
  let bonus = 0;

  // Prefer corners and edges in early game
  const moveNumber = state.moveHistory.length;
  if (moveNumber < boardSize * 2) {
    if (isCorner(x, y, boardSize)) {
      bonus += 15;
    } else if (isEdge(x, y, boardSize)) {
      bonus += 8;
    } else if (isStarPoint(x, y, boardSize)) {
      bonus += 12;
    }
  }

  // Prefer capturing moves
  const captures = getCaptures(board, x, y, state.currentPlayer, boardSize);
  if (captures.length > 0) {
    bonus += captures.length * 20;
  }

  // Prefer moves that save own stones in atari
  const neighbors = getNeighbors(x, y, boardSize);
  for (const n of neighbors) {
    if (board[n.y][n.x] === state.currentPlayer) {
      const group = getGroupBFS(board, n.x, n.y, boardSize);
      const libs = countLiberties(board, group, boardSize);
      if (libs === 1) {
        bonus += 25; // Saving a group in atari
      }
    }
  }

  // Prefer extensions (playing next to own stones)
  let ownNeighbors = 0;
  let oppNeighbors = 0;
  for (const n of neighbors) {
    if (board[n.y][n.x] === state.currentPlayer) ownNeighbors++;
    else if (board[n.y][n.x] === opponent(state.currentPlayer)) oppNeighbors++;
  }

  if (ownNeighbors > 0 && oppNeighbors === 0) {
    bonus += 5; // Safe extension
  }

  return bonus;
}

// ---------------------------------------------------------------------------
// Beginner AI: Random + Greedy
// ---------------------------------------------------------------------------

/**
 * Beginner AI: Random moves with preference for corners and edges
 */
function getBeginnerMove(state: GoState): Position | null {
  const legalMoves = getLegalMovesForState(state);
  if (legalMoves.length === 0) return null;

  // Check for immediate capture opportunities
  const captureMoves: Position[] = [];
  for (const move of legalMoves) {
    const captures = getCaptures(
      state.board,
      move.x,
      move.y,
      state.currentPlayer,
      state.boardSize
    );
    if (captures.length > 0) {
      captureMoves.push(move);
    }
  }

  // 30% chance to capture if possible
  if (captureMoves.length > 0 && Math.random() < 0.3) {
    return captureMoves[Math.floor(Math.random() * captureMoves.length)];
  }

  // Weighted random selection
  const scoredMoves = legalMoves.map((move) => {
    let weight = CENTER_WEIGHT;

    if (isCorner(move.x, move.y, state.boardSize)) {
      weight = CORNER_WEIGHT;
    } else if (isEdge(move.x, move.y, state.boardSize)) {
      weight = EDGE_WEIGHT;
    }

    return { move, weight };
  });

  // Weighted random choice
  const totalWeight = scoredMoves.reduce((sum, sm) => sum + sm.weight, 0);
  let random = Math.random() * totalWeight;

  for (const sm of scoredMoves) {
    random -= sm.weight;
    if (random <= 0) {
      return sm.move;
    }
  }

  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

// ---------------------------------------------------------------------------
// GoAI Class
// ---------------------------------------------------------------------------

export class GoAI {
  private config: AIDifficultyConfig;

  constructor(
    difficulty: 'beginner' | 'elementary' | 'intermediate' | 'advanced' = 'intermediate'
  ) {
    const config = DIFFICULTY_CONFIGS[difficulty];
    if (!config) {
      throw new Error(`Unknown difficulty: ${difficulty}`);
    }
    this.config = { ...config };
  }

  /**
   * Get the best move for the given state
   * @returns Position to play, or null to pass
   */
  getMove(state: GoState): Position | null {
    // If game is over, pass
    if (state.phase === 'ended' || state.phase === 'scoring') {
      return null;
    }

    // No legal moves, pass
    const legalMoves = getLegalMovesForState(state);
    if (legalMoves.length === 0) {
      return null;
    }

    // Beginner: random + greedy
    if (this.config.simulations === 0) {
      return getBeginnerMove(state);
    }

    // MCTS for elementary/intermediate/advanced
    return runMCTS(state, this.config);
  }

  /** Get current difficulty configuration */
  getConfig(): AIDifficultyConfig {
    return { ...this.config };
  }

  /** Change difficulty */
  setDifficulty(
    difficulty: 'beginner' | 'elementary' | 'intermediate' | 'advanced'
  ): void {
    const config = DIFFICULTY_CONFIGS[difficulty];
    if (!config) {
      throw new Error(`Unknown difficulty: ${difficulty}`);
    }
    this.config = { ...config };
  }

  /** Get available difficulty levels */
  static getDifficulties(): string[] {
    return Object.keys(DIFFICULTY_CONFIGS);
  }
}

// Re-export types
export type { AIDifficultyConfig };
