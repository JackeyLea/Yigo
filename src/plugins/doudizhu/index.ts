/**
 * 斗地主插件入口文件
 * 导出所有公共类型、类和函数
 */

// ==================== 类型定义 ====================
export type {
  Suit,
  Rank,
  Card,
  SingleCombo,
  PairCombo,
  TripleCombo,
  TripleWithSingleCombo,
  TripleWithPairCombo,
  StraightCombo,
  StraightPairsCombo,
  AirplaneCombo,
  BombCombo,
  RocketCombo,
  PassCombo,
  CardCombo,
  CardComboType,
  GamePhase,
  DoudizhuPlayer,
  BidRecord,
  WinnerSide,
  DoudizhuState,
  PlayEvent,
  PassEvent,
  BidEvent,
  LandlordConfirmEvent,
  GameOverEvent,
  DoudizhuEvent,
  Difficulty,
  AIType,
  DoudizhuConfig,
  ActionResult,
  HandAnalysis,
  LeaderboardEntry,
} from './doudizhu.types';

export {
  DEFAULT_DOUDIZHU_CONFIG,
} from './doudizhu.types';

// ==================== 游戏引擎 ====================
export {
  DoudizhuEngine,
  RANK_VALUE,
  sortCards,
  sortCardsDesc,
} from './doudizhu.engine';

// ==================== AI ====================
export {
  DoudizhuAI,
} from './ai/doudizhu-ai';

export type {
  Difficulty as AIDifficulty,
} from './ai/doudizhu-ai';

// ==================== 插件主类 ====================
export {
  DoudizhuPlugin,
} from './doudizhu.plugin';

export type {
  PluginEvent,
  RoomState,
  RoomPlayer,
  PluginOptions,
} from './doudizhu.plugin';

// ==================== 配置管理 ====================
export {
  SETTING_GROUPS,
  SETTINGS_TABS,
  CONFIG_PRESETS,
  GAME_SETTINGS,
  AI_SETTINGS,
  ADVANCED_SETTINGS,
  validateConfig,
  mergeConfig,
  exportConfig,
  importConfig,
} from './doudizhu.settings';

export type {
  SettingField,
  SettingsTab,
} from './doudizhu.settings';
