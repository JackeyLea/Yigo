/**
 * Xiangqi Plugin Settings
 *
 * Default configuration and validation for the Xiangqi game plugin.
 */

import type { XiangqiSettings } from './xiangqi.types';

// ---------------------------------------------------------------------------
// Default settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: XiangqiSettings = {
  aiDifficulty: 'medium',
  showLegalMoves: true,
  showLastMove: true,
  enableSound: true,
  boardTheme: 'wood',
  pieceStyle: 'traditional',
  animationSpeed: 300, // milliseconds
  enableOpeningBook: true,
};

// ---------------------------------------------------------------------------
// Difficulty options for UI
// ---------------------------------------------------------------------------

export const DIFFICULTY_OPTIONS = [
  { value: 'easy' as const, label: 'Easy', labelZh: '简单', depth: 2 },
  { value: 'medium' as const, label: 'Medium', labelZh: '中等', depth: 4 },
  { value: 'hard' as const, label: 'Hard', labelZh: '困难', depth: 6 },
  { value: 'master' as const, label: 'Master', labelZh: '大师', depth: 8 },
];

export const BOARD_THEME_OPTIONS = [
  { value: 'wood' as const, label: 'Wood', labelZh: '木质' },
  { value: 'green' as const, label: 'Green', labelZh: '绿色' },
  { value: 'blue' as const, label: 'Blue', labelZh: '蓝色' },
];

export const PIECE_STYLE_OPTIONS = [
  { value: 'traditional' as const, label: 'Traditional', labelZh: '传统' },
  { value: 'simplified' as const, label: 'Simplified', labelZh: '简约' },
];

// ---------------------------------------------------------------------------
// Getters / validation
// ---------------------------------------------------------------------------

export function getDefaultSettings(): XiangqiSettings {
  return { ...DEFAULT_SETTINGS };
}

export function validateSettings(settings: Partial<XiangqiSettings>): XiangqiSettings {
  const validated = { ...DEFAULT_SETTINGS };

  if (settings.aiDifficulty && ['easy', 'medium', 'hard', 'master'].includes(settings.aiDifficulty)) {
    validated.aiDifficulty = settings.aiDifficulty;
  }

  if (typeof settings.showLegalMoves === 'boolean') {
    validated.showLegalMoves = settings.showLegalMoves;
  }

  if (typeof settings.showLastMove === 'boolean') {
    validated.showLastMove = settings.showLastMove;
  }

  if (typeof settings.enableSound === 'boolean') {
    validated.enableSound = settings.enableSound;
  }

  if (settings.boardTheme && ['wood', 'green', 'blue'].includes(settings.boardTheme)) {
    validated.boardTheme = settings.boardTheme;
  }

  if (settings.pieceStyle && ['traditional', 'simplified'].includes(settings.pieceStyle)) {
    validated.pieceStyle = settings.pieceStyle;
  }

  if (typeof settings.animationSpeed === 'number' && settings.animationSpeed >= 0 && settings.animationSpeed <= 2000) {
    validated.animationSpeed = settings.animationSpeed;
  }

  if (typeof settings.enableOpeningBook === 'boolean') {
    validated.enableOpeningBook = settings.enableOpeningBook;
  }

  return validated;
}

export default DEFAULT_SETTINGS;
