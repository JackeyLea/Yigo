/**
 * Xiangqi Opening Book
 *
 * Contains common opening lines with FEN-keyed lookup.
 * Openings covered:
 *   - Central Cannon (当头炮 / 中炮)
 *   - Screen Horse Defence (屏风马)
 *   - Elephant Opening (飞相局)
 *   - Fairy Deity Pawn (仙人指路)
 *   - Cross Palace Cannon (过宫炮)
 *   - Corner Cannon (士角炮)
 *
 * Lookup function: findOpeningMove(state) → { from, to } | null
 */

import { type XiangqiState, type Position, type OpeningBook } from './xiangqi.types';

// ---------------------------------------------------------------------------
// Opening book data: keyed by FEN prefix (board part only)
// Each entry lists preferred follow-up moves in UCI-like notation "fromXfromYtoXtoY"
// ---------------------------------------------------------------------------

export const OPENING_BOOK: OpeningBook = {
  // -----------------------------------------------------------------------
  // Initial position
  // -----------------------------------------------------------------------
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR': [
    {
      name: 'Central Cannon (当头炮)',
      category: 'aggressive',
      moves: ['7174'], // cannon from (7,2) to (7,4) — 炮二平五
      description: 'Most popular opening: deploys cannon to central file threatening the enemy soldier.',
    },
    {
      name: 'Fairy Deity Pawn (仙人指路)',
      category: 'flexible',
      moves: ['6263'], // soldier from (6,3) to (6,4) — 兵三进一
      description: 'Flexible development: advances the third-file soldier to control the river.',
    },
    {
      name: 'Elephant Opening (飞相局)',
      category: 'defensive',
      moves: ['6062'], // elephant from (6,0) to (6,2) — 相三进五
      description: 'Solid defensive opening: develops elephant to protect the centre.',
    },
    {
      name: 'Cross Palace Cannon (过宫炮)',
      category: 'positional',
      moves: ['7172'], // cannon shifts to the other file — 炮二平六
      description: 'Develops cannon to the left flank for a concentrated attack.',
    },
    {
      name: 'Corner Cannon (士角炮)',
      category: 'tricky',
      moves: ['7172'], // cannon to corner — 炮二平四
      description: 'Unusual setup that can transpose into various systems.',
    },
  ],

  // -----------------------------------------------------------------------
  // After 1. Cannon to centre (炮二平五) — Red has played C=2=5
  // FEN: rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w
  // Wait, same FEN.  We distinguish by move history instead via helper below.
  // -----------------------------------------------------------------------
};

// ---------------------------------------------------------------------------
// Opening move sequences keyed by move-history hash (simpler approach)
// ---------------------------------------------------------------------------

interface OpeningLine {
  name: string;
  category: string;
  description: string;
  moves: string[]; // sequence of 4-char UCI moves
}

/** Opening lines indexed by the number of half-moves played. */
const OPENING_LINES: Record<number, OpeningLine[]> = {
  0: [
    { name: 'Central Cannon', category: 'aggressive', description: '当头炮', moves: ['7174'] },
    { name: 'Fairy Deity Pawn', category: 'flexible', description: '仙人指路', moves: ['6263'] },
    { name: 'Elephant Opening', category: 'defensive', description: '飞相局', moves: ['6062'] },
    { name: 'Horse Development', category: 'developing', description: '起马局', moves: ['7162'] },
    { name: 'Cross Palace Cannon', category: 'positional', description: '过宫炮', moves: ['7172'] },
  ],
  1: [
    // After any Black first move, Red continues
    { name: 'Develop Left Horse', category: 'developing', description: '马八进七', moves: ['7174', '1727'] },
  ],
  2: [
    { name: 'Central Cannon + Horse', category: 'aggressive', description: '中炮马来跳', moves: ['7174', '1727', '7767'] },
    { name: 'Cannon + Chariot', category: 'aggressive', description: '中炮出车', moves: ['7174', '1727', '8988'] },
  ],
};

// ---------------------------------------------------------------------------
// Helper: encode a move as 4-char string "x1y1x2y2"
// ---------------------------------------------------------------------------

function moveToKey(from: Position, to: Position): string {
  return `${from.x}${from.y}${to.x}${to.y}`;
}

function keyToMove(key: string): { from: Position; to: Position } | null {
  if (key.length !== 4) return null;
  const nums = key.split('').map(Number);
  return {
    from: { x: nums[0], y: nums[1] },
    to: { x: nums[2], y: nums[3] },
  };
}

// ---------------------------------------------------------------------------
// Match opening by move history
// ---------------------------------------------------------------------------

/**
 * Find a recommended opening move for the current state.
 * Returns null if no opening recommendation is found.
 */
export function findOpeningMove(state: XiangqiState): { from: Position; to: Position } | null {
  // Convert move history to keys
  const historyKeys = state.moveHistory.map(m => moveToKey(m.from, m.to));

  // Find lines that match current history
  const nextMoveIndex = historyKeys.length;
  const candidates = OPENING_LINES[nextMoveIndex];
  if (!candidates || candidates.length === 0) return null;

  // Filter lines that match the move history so far
  const matching = candidates.filter(line => {
    for (let i = 0; i < historyKeys.length; i++) {
      if (line.moves[i] !== historyKeys[i]) return false;
    }
    return true;
  });

  if (matching.length === 0) return null;

  // Pick one at random from matching lines
  const line = matching[Math.floor(Math.random() * matching.length)];
  const nextKey = line.moves[nextMoveIndex];
  if (!nextKey) return null;

  return keyToMove(nextKey);
}

/**
 * Get opening name / info for a given state (for UI display).
 */
export function getOpeningInfo(state: XiangqiState): { name: string; description: string } | null {
  const historyKeys = state.moveHistory.map(m => moveToKey(m.from, m.to));
  const idx = historyKeys.length;
  const candidates = OPENING_LINES[idx];
  if (!candidates) return null;

  const matching = candidates.filter(line => {
    for (let i = 0; i < historyKeys.length; i++) {
      if (line.moves[i] !== historyKeys[i]) return false;
    }
    return true;
  });

  if (matching.length === 0) return null;
  const line = matching[0];
  return { name: line.name, description: line.description };
}

export default OPENING_BOOK;
