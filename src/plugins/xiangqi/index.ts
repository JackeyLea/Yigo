/**
 * Xiangqi (Chinese Chess) Plugin
 *
 * Main entry point - exports everything needed by the chess platform.
 */

export * from './xiangqi.types';
export { XiangqiEngine } from './xiangqi.engine';
export { XiangqiAI } from './ai/xiangqi-ai';
export {
  OPENING_BOOK,
  findOpeningMove,
  getOpeningInfo,
} from './xiangqi-opening-book';
export {
  ENDGAME_TABLE,
  findEndgameMove,
} from './xiangqi-endgame';
export {
  XIANGQI_PLUGIN,
  createEngine,
  createAI,
  createGame,
  getPieceName,
  getPlayerName,
  toChineseNotation,
} from './xiangqi.plugin';
export {
  DEFAULT_SETTINGS,
  getDefaultSettings,
  validateSettings,
  DIFFICULTY_OPTIONS,
  BOARD_THEME_OPTIONS,
  PIECE_STYLE_OPTIONS,
} from './xiangqi.settings';

export { default } from './xiangqi.plugin';
