/**
 * Xiangqi (Chinese Chess) Plugin Entry Point
 *
 * Exports the game engine, AI, opening book, and type definitions.
 * Provides a unified interface for the chess platform to interact with
 * the Xiangqi game module.
 */

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { XiangqiEngine } from './xiangqi.engine';
export { XiangqiAI } from './ai/xiangqi-ai';
export { OPENING_BOOK, findOpeningMove, getOpeningInfo } from './xiangqi-opening-book';
export { ENDGAME_TABLE, findEndgameMove } from './xiangqi-endgame';
export * from './xiangqi.types';
export { getDefaultSettings, validateSettings } from './xiangqi.settings';

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

export const XIANGQI_PLUGIN = {
  name: 'xiangqi',
  displayName: 'Chinese Chess (Xiangqi)',
  displayNameCN: '中国象棋',
  version: '1.0.0',
  description: 'Traditional Chinese Chess with full rule support, AI opponent, and opening book.',
  author: 'Chess Platform Team',
  minEngineVersion: '1.0.0',

  // Game characteristics
  boardSize: { cols: 9, rows: 10 },
  players: 2,
  firstPlayer: 1, // Red moves first

  // Feature flags
  features: {
    hasAI: true,
    hasOpeningBook: true,
    hasEndgameTable: true,
    supportsUndo: true,
    supportsReplay: true,
    supportsFEN: true,
    supportsNotation: false, // TODO: Chinese algebraic notation
  },
} as const;

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

import { XiangqiEngine } from './xiangqi.engine';
import { XiangqiAI } from './ai/xiangqi-ai';
import type { XiangqiSettings } from './xiangqi.types';
import { getDefaultSettings } from './xiangqi.settings';

/** Create a new game engine instance */
export function createEngine(): XiangqiEngine {
  return new XiangqiEngine();
}

/** Create an AI opponent with the given difficulty */
export function createAI(
  difficulty: 'easy' | 'medium' | 'hard' | 'master' = 'medium',
): XiangqiAI {
  return new XiangqiAI(difficulty);
}

/** Quick-start: create engine + AI with settings */
export function createGame(settings?: Partial<XiangqiSettings>): {
  engine: XiangqiEngine;
  ai: XiangqiAI | null;
  settings: XiangqiSettings;
} {
  const merged = { ...getDefaultSettings(), ...settings };
  const engine = createEngine();
  const ai = merged.aiDifficulty !== undefined
    ? createAI(merged.aiDifficulty)
    : null;
  return { engine, ai, settings: merged };
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Get a human-readable piece name */
export function getPieceName(type: string, player: number, lang: 'en' | 'zh' = 'en'): string {
  const names: Record<string, Record<string, string>> = {
    en: {
      'general-1': 'General', 'general-2': 'General',
      'advisor-1': 'Advisor', 'advisor-2': 'Advisor',
      'elephant-1': 'Elephant', 'elephant-2': 'Elephant',
      'horse-1': 'Horse', 'horse-2': 'Horse',
      'chariot-1': 'Chariot', 'chariot-2': 'Chariot',
      'cannon-1': 'Cannon', 'cannon-2': 'Cannon',
      'soldier-1': 'Soldier', 'soldier-2': 'Soldier',
    },
    zh: {
      'general-1': '帅', 'general-2': '将',
      'advisor-1': '仕', 'advisor-2': '士',
      'elephant-1': '相', 'elephant-2': '象',
      'horse-1': '傌', 'horse-2': '馬',
      'chariot-1': '俥', 'chariot-2': '車',
      'cannon-1': '炮', 'cannon-2': '砲',
      'soldier-1': '兵', 'soldier-2': '卒',
    },
  };
  return names[lang]?.[`${type}-${player}`] ?? type;
}

/** Get player display name */
export function getPlayerName(player: number, lang: 'en' | 'zh' = 'en'): string {
  if (lang === 'zh') return player === 1 ? '红方' : '黑方';
  return player === 1 ? 'Red' : 'Black';
}

/** Convert position to Chinese algebraic notation (e.g. "炮二平五") */
export function toChineseNotation(
  from: { x: number; y: number },
  to: { x: number; y: number },
  pieceType: string,
  player: number,
): string {
  // Simplified notation: just return coordinate notation for now
  const files = '九八七六五四三二一';
  const fromFile = files[from.x];
  const toFile = files[to.x];
  const fromRank = player === 1 ? from.y + 1 : 10 - from.y;
  const toRank = player === 1 ? to.y + 1 : 10 - to.y;
  const pieceName = getPieceName(pieceType, player, 'zh');
  return `${pieceName}${fromFile}${from.y < to.y ? '进' : from.y > to.y ? '退' : '平'}${toFile}`;
}

export default XIANGQI_PLUGIN;
