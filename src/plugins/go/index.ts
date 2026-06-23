/**
 * Go (围棋) Plugin - Main Export
 *
 * This is the entry point for the Go game plugin.
 * All major components are re-exported from here.
 */

// Core engine
export { GoEngine } from './go.engine';

// AI
export { GoAI } from './ai/go-ai';

// Plugin
export { GoPlugin } from './go.plugin';

// Settings
export {
  GoSettingsManager,
  DEFAULT_GO_SETTINGS,
  GO_SETTINGS_SCHEMA,
  isValidBoardSize,
  isValidKomi,
  isValidHandicap,
  isValidAIDifficulty,
  isValidTheme,
  mergeWithDefaults,
  getAIDifficultyPresets,
  createGameOptionsFromSettings,
} from './go.settings';

// Types
export type {
  BoardSize,
  Cell,
  Board,
  Player,
  GoState,
  GoMove,
  Position,
  GamePhase,
  SGFNode,
  GoGameOptions,
  GoGameEvents,
  GoSettings,
  ScoreDetail,
  TerritoryResult,
  AIDifficultyConfig,
  SettingSchemaEntry,
} from './go.types';
