/**
 * Xiangqi Endgame Tablebase (simplified)
 *
 * Hard-coded classic endgame patterns:
 *   - Single Chariot vs Single Advisor (单车胜单士)
 *   - Single Horse vs Single Advisor (单马胜单士)
 *   - Cannon + Soldier vs Soldier + Advisor + Elephant (炮兵胜士象)
 *
 * Each entry contains the attacker/defender material signature and
 * winning technique hints.  The lookup returns a direct winning move
 * when the current position matches a known pattern.
 */

import {
  type XiangqiState,
  type Position,
  type PieceType,
  type Player,
  type EndgameEntry,
} from './xiangqi.types';

// ---------------------------------------------------------------------------
// Endgame entries
// ---------------------------------------------------------------------------

export const ENDGAME_TABLE: EndgameEntry[] = [
  {
    name: 'Chariot vs Advisor (单车胜单士)',
    attackerPieces: [{ type: 'chariot', count: 1 }],
    defenderPieces: [{ type: 'general', count: 1 }, { type: 'advisor', count: 1 }],
    result: 'win',
    technique: 'Force the advisor to the edge, then use chariot to pin it against the general.',
    keyPositions: [
      '4ka3/9/9/9/9/9/9/9/9/3R5 w', // Chariot on d-file, advisor on a-file
      '4ka3/9/9/9/9/9/9/9/9/4R4 w', // Chariot on e-file
    ],
  },
  {
    name: 'Horse vs Advisor (单马胜单士)',
    attackerPieces: [{ type: 'horse', count: 1 }],
    defenderPieces: [{ type: 'general', count: 1 }, { type: 'advisor', count: 1 }],
    result: 'win',
    technique: 'Use the horse to control the advisor and force it into a fork position.',
    keyPositions: [
      '4ka3/9/9/9/9/9/9/9/9/5N3 w',
    ],
  },
  {
    name: 'Cannon + Soldier vs Soldier + Advisor + Elephant (炮兵胜士象)',
    attackerPieces: [
      { type: 'cannon', count: 1 },
      { type: 'soldier', count: 1 },
    ],
    defenderPieces: [
      { type: 'general', count: 1 },
      { type: 'advisor', count: 1 },
      { type: 'elephant', count: 1 },
    ],
    result: 'win',
    technique: 'Advance the soldier to the palace edge, use cannon to control the advisor.',
    keyPositions: [
      '4k4/9/9/9/9/9/9/9/4P4/3C5 w',
    ],
  },
  {
    name: 'Two Horses vs General (双马胜将)',
    attackerPieces: [{ type: 'horse', count: 2 }],
    defenderPieces: [{ type: 'general', count: 1 }],
    result: 'win',
    technique: 'Coordinate the two horses to form a mating net around the general.',
    keyPositions: [
      '4k4/9/9/9/9/9/9/9/3N5/4N4 w',
    ],
  },
  {
    name: 'Chariot + Horse vs General (车马冷着)',
    attackerPieces: [
      { type: 'chariot', count: 1 },
      { type: 'horse', count: 1 },
    ],
    defenderPieces: [{ type: 'general', count: 1 }],
    result: 'win',
    technique: 'Use chariot to control ranks, horse to control files, deliver checkmate.',
    keyPositions: [
      '4k4/9/9/9/9/9/9/9/9/3R1N3 w',
    ],
  },
];

// ---------------------------------------------------------------------------
// Signature helper: count pieces by type for each player
// ---------------------------------------------------------------------------

interface MaterialSignature {
  [type: string]: number;
}

function getSignature(state: XiangqiState, player: Player): MaterialSignature {
  const sig: MaterialSignature = {};
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 10; y++) {
      const p = state.board[x][y];
      if (p && p.player === player) {
        sig[p.type] = (sig[p.type] || 0) + 1;
      }
    }
  }
  return sig;
}

function signatureMatches(
  sig: MaterialSignature,
  required: { type: PieceType; count: number }[],
): boolean {
  for (const req of required) {
    if ((sig[req.type] || 0) !== req.count) return false;
  }
  // Ensure no extra piece types (only listed ones)
  const totalInSig = Object.values(sig).reduce((a, b) => a + b, 0);
  const totalRequired = required.reduce((a, b) => a + b.count, 0);
  return totalInSig === totalRequired;
}

// ---------------------------------------------------------------------------
// Endgame move lookup
// ---------------------------------------------------------------------------

/**
 * Check if the current position matches a known endgame pattern.
 * Returns a recommended move when a winning pattern is found.
 */
export function findEndgameMove(state: XiangqiState): { from: Position; to: Position } | null {
  const currentSig = getSignature(state, state.currentPlayer);
  const opponent: Player = state.currentPlayer === 1 ? 2 : 1;
  const oppSig = getSignature(state, opponent);

  for (const entry of ENDGAME_TABLE) {
    const attackerIsCurrent = signatureMatches(currentSig, entry.attackerPieces);
    const defenderIsOpponent = signatureMatches(oppSig, entry.defenderPieces);
    const attackerIsOpponent = signatureMatches(oppSig, entry.attackerPieces);
    const defenderIsCurrent = signatureMatches(currentSig, entry.defenderPieces);

    const match = (attackerIsCurrent && defenderIsOpponent) ||
                  (attackerIsOpponent && defenderIsCurrent);
    if (!match) continue;

    // Try to find a direct winning move: capture the advisor/elephant if exposed,
    // or move toward the general.
    const move = findWinningMove(state, entry);
    if (move) return move;
  }

  return null;
}

/**
 * Simple heuristic: in endgames, prioritize captures and checks.
 */
function findWinningMove(
  state: XiangqiState,
  _entry: EndgameEntry,
): { from: Position; to: Position } | null {
  // Find all moves, prefer captures of advisors/elephants, then checks
  const moves = getAllPseudoLegalMoves(state);

  // 1. Capture advisor or elephant
  for (const move of moves) {
    const target = state.board[move.to.x][move.to.y];
    if (target && (target.type === 'advisor' || target.type === 'elephant')) {
      return move;
    }
  }

  // 2. Check the general
  for (const move of moves) {
    const target = state.board[move.to.x][move.to.y];
    if (target && target.type === 'general') {
      return move;
    }
  }

  // 3. Move toward the enemy general
  const enemyGeneral = findPiece(state, 'general', state.currentPlayer === 1 ? 2 : 1);
  if (enemyGeneral) {
    let best = null;
    let bestDist = Infinity;
    for (const move of moves) {
      const dist = Math.abs(move.to.x - enemyGeneral.x) + Math.abs(move.to.y - enemyGeneral.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = move;
      }
    }
    if (best) return best;
  }

  return moves.length > 0 ? moves[0] : null;
}

// ---------------------------------------------------------------------------
// Pseudo-legal move generator (simplified, used for endgame heuristics)
// ---------------------------------------------------------------------------

function getAllPseudoLegalMoves(
  state: XiangqiState,
): { from: Position; to: Position }[] {
  const result: { from: Position; to: Position }[] = [];
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 10; y++) {
      const p = state.board[x][y];
      if (p && p.player === state.currentPlayer) {
        // Use simple rule-based generation for speed
        const targets = generatePseudoMovesForPiece(state, x, y);
        for (const t of targets) {
          result.push({ from: { x, y }, to: t });
        }
      }
    }
  }
  return result;
}

function generatePseudoMovesForPiece(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y];
  if (!p) return [];

  switch (p.type) {
    case 'chariot':
      return generateChariotMoves(state, x, y);
    case 'horse':
      return generateHorseMoves(state, x, y);
    case 'cannon':
      return generateCannonMoves(state, x, y);
    case 'soldier':
      return generateSoldierMoves(state, x, y);
    case 'general':
      return generateGeneralMoves(state, x, y);
    case 'advisor':
      return generateAdvisorMoves(state, x, y);
    case 'elephant':
      return generateElephantMoves(state, x, y);
    default:
      return [];
  }
}

function generateChariotMoves(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y]!;
  const moves: Position[] = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
      const t = state.board[nx][ny];
      if (!t) {
        moves.push({ x: nx, y: ny });
      } else {
        if (t.player !== p.player) moves.push({ x: nx, y: ny });
        break;
      }
      nx += dx; ny += dy;
    }
  }
  return moves;
}

function generateHorseMoves(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y]!;
  const moves: Position[] = [];
  const leaps = [
    [1, 2], [1, -2], [-1, 2], [-1, -2],
    [2, 1], [2, -1], [-2, 1], [-2, -1],
  ];
  for (const [dx, dy] of leaps) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= 9 || ny < 0 || ny >= 10) continue;
    // Blocking check
    const blockX = Math.abs(dx) === 2 ? x + (dx > 0 ? 1 : -1) : x;
    const blockY = Math.abs(dy) === 2 ? y + (dy > 0 ? 1 : -1) : y;
    if (state.board[blockX][blockY]) continue;
    const t = state.board[nx][ny];
    if (!t || t.player !== p.player) moves.push({ x: nx, y: ny });
  }
  return moves;
}

function generateCannonMoves(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y]!;
  const moves: Position[] = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    let foundPlatform = false;
    while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
      const t = state.board[nx][ny];
      if (!foundPlatform) {
        if (!t) {
          moves.push({ x: nx, y: ny });
        } else {
          foundPlatform = true;
        }
      } else {
        if (t) {
          if (t.player !== p.player) moves.push({ x: nx, y: ny });
          break;
        }
      }
      nx += dx; ny += dy;
    }
  }
  return moves;
}

function generateSoldierMoves(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y]!;
  const moves: Position[] = [];
  const forward = p.player === 1 ? 1 : -1;
  const fy = y + forward;
  if (fy >= 0 && fy < 10) {
    const t = state.board[x][fy];
    if (!t || t.player !== p.player) moves.push({ x, y: fy });
  }
  const crossed = p.player === 1 ? y >= 5 : y <= 4;
  if (crossed) {
    for (const sx of [x - 1, x + 1]) {
      if (sx >= 0 && sx < 9) {
        const t = state.board[sx][y];
        if (!t || t.player !== p.player) moves.push({ x: sx, y });
      }
    }
  }
  return moves;
}

function generateGeneralMoves(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y]!;
  const moves: Position[] = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    const palace = p.player === 1
      ? (nx >= 3 && nx <= 5 && ny >= 0 && ny <= 2)
      : (nx >= 3 && nx <= 5 && ny >= 7 && ny <= 9);
    if (palace) {
      const t = state.board[nx][ny];
      if (!t || t.player !== p.player) moves.push({ x: nx, y: ny });
    }
  }
  return moves;
}

function generateAdvisorMoves(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y]!;
  const moves: Position[] = [];
  const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    const palace = p.player === 1
      ? (nx >= 3 && nx <= 5 && ny >= 0 && ny <= 2)
      : (nx >= 3 && nx <= 5 && ny >= 7 && ny <= 9);
    if (palace) {
      const t = state.board[nx][ny];
      if (!t || t.player !== p.player) moves.push({ x: nx, y: ny });
    }
  }
  return moves;
}

function generateElephantMoves(state: XiangqiState, x: number, y: number): Position[] {
  const p = state.board[x][y]!;
  const moves: Position[] = [];
  const leaps = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
  for (const [dx, dy] of leaps) {
    const nx = x + dx, ny = y + dy;
    const ownSide = p.player === 1 ? ny <= 4 : ny >= 5;
    if (nx < 0 || nx >= 9 || ny < 0 || ny >= 10 || !ownSide) continue;
    const blockX = (x + nx) / 2;
    const blockY = (y + ny) / 2;
    if (state.board[blockX][blockY]) continue;
    const t = state.board[nx][ny];
    if (!t || t.player !== p.player) moves.push({ x: nx, y: ny });
  }
  return moves;
}

function findPiece(state: XiangqiState, type: PieceType, player: Player): Position | null {
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 10; y++) {
      const p = state.board[x][y];
      if (p && p.type === type && p.player === player) return { x, y };
    }
  }
  return null;
}

export default ENDGAME_TABLE;
