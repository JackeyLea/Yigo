/**
 * 斗地主游戏配置Schema
 * 定义游戏设置、界面配置和规则配置
 */

import {
  type DoudizhuConfig,
  type Difficulty,
  type AIType,
  DEFAULT_DOUDIZHU_CONFIG,
} from './doudizhu.types';

// ==================== 配置字段定义 ====================

/** 单个配置项的定义 */
export interface SettingField<T = unknown> {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'select' | 'boolean' | 'range';
  defaultValue: T;
  options?: { label: string; value: T }[];
  min?: number;
  max?: number;
  step?: number;
}

// ==================== 游戏设置Schema ====================

/** 游戏基础设置 */
export const GAME_SETTINGS: SettingField[] = [
  {
    key: 'maxRounds',
    label: '游戏局数限制',
    description: '设置最大游戏局数，0表示无限',
    type: 'number',
    defaultValue: 0,
    min: 0,
    max: 100,
  },
  {
    key: 'baseScore',
    label: '底分',
    description: '每局基础分数',
    type: 'number',
    defaultValue: 1,
    min: 1,
    max: 100,
  },
  {
    key: 'playTimeout',
    label: '出牌超时（秒）',
    description: '玩家出牌超时时间，0表示不限制',
    type: 'range',
    defaultValue: 30,
    min: 0,
    max: 120,
    step: 5,
  },
  {
    key: 'bidTimeout',
    label: '叫分超时（秒）',
    description: '玩家叫分超时时间，0表示不限制',
    type: 'range',
    defaultValue: 15,
    min: 0,
    max: 60,
    step: 5,
  },
];

/** AI设置 */
export const AI_SETTINGS: SettingField[] = [
  {
    key: 'aiDifficulty',
    label: 'AI难度',
    description: '选择AI对手的难度等级',
    type: 'select',
    defaultValue: 'medium' as Difficulty,
    options: [
      { label: '简单（随机出牌）', value: 'easy' },
      { label: '中等（牌型优先）', value: 'medium' },
      { label: '困难（记牌+配合）', value: 'hard' },
    ],
  },
  {
    key: 'aiType',
    label: 'AI类型',
    description: '选择AI决策算法',
    type: 'select',
    defaultValue: 'rule_based' as AIType,
    options: [
      { label: '规则基础', value: 'rule_based' },
      { label: '蒙特卡洛树搜索', value: 'mcts' },
    ],
  },
];

/** 高级设置 */
export const ADVANCED_SETTINGS: SettingField[] = [
  {
    key: 'enableGrab',
    label: '启用抢地主',
    description: '是否允许玩家抢地主（增加游戏变数）',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'enableShowCards',
    label: '启用明牌',
    description: '是否允许玩家明牌（加倍奖励）',
    type: 'boolean',
    defaultValue: false,
  },
];

/** 所有设置分组 */
export const SETTING_GROUPS = [
  { key: 'game', label: '游戏设置', settings: GAME_SETTINGS },
  { key: 'ai', label: 'AI设置', settings: AI_SETTINGS },
  { key: 'advanced', label: '高级设置', settings: ADVANCED_SETTINGS },
];

// ==================== 配置验证 ====================

/** 验证配置合法性 */
export function validateConfig(config: Partial<DoudizhuConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.baseScore !== undefined && (config.baseScore < 1 || config.baseScore > 100)) {
    errors.push('底分必须在1-100之间');
  }

  if (config.maxRounds !== undefined && config.maxRounds < 0) {
    errors.push('游戏局数不能为负数');
  }

  if (config.playTimeout !== undefined && config.playTimeout < 0) {
    errors.push('出牌超时不能为负数');
  }

  if (config.bidTimeout !== undefined && config.bidTimeout < 0) {
    errors.push('叫分超时不能为负数');
  }

  if (
    config.aiDifficulty !== undefined &&
    !['easy', 'medium', 'hard'].includes(config.aiDifficulty)
  ) {
    errors.push('AI难度必须是 easy/medium/hard 之一');
  }

  if (
    config.aiType !== undefined &&
    !['rule_based', 'mcts'].includes(config.aiType)
  ) {
    errors.push('AI类型必须是 rule_based/mcts 之一');
  }

  return { valid: errors.length === 0, errors };
}

/** 合并配置（用户配置覆盖默认配置） */
export function mergeConfig(userConfig: Partial<DoudizhuConfig> = {}): DoudizhuConfig {
  return {
    ...DEFAULT_DOUDIZHU_CONFIG,
    ...userConfig,
  };
}

/** 从本地存储加载配置 */
export function loadConfigFromStorage(): DoudizhuConfig {
  try {
    const stored = localStorage.getItem('doudizhu_config');
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DoudizhuConfig>;
      const { valid, errors } = validateConfig(parsed);
      if (valid) {
        return mergeConfig(parsed);
      }
      console.warn('配置验证失败:', errors);
    }
  } catch {
    // 解析失败使用默认配置
  }
  return { ...DEFAULT_DOUDIZHU_CONFIG };
}

/** 保存配置到本地存储 */
export function saveConfigToStorage(config: DoudizhuConfig): void {
  try {
    localStorage.setItem('doudizhu_config', JSON.stringify(config));
  } catch {
    // 存储失败静默处理
  }
}

/** 导出配置为JSON字符串 */
export function exportConfig(config: DoudizhuConfig): string {
  return JSON.stringify(config, null, 2);
}

/** 从JSON字符串导入配置 */
export function importConfig(json: string): { success: boolean; config?: DoudizhuConfig; error?: string } {
  try {
    const parsed = JSON.parse(json) as Partial<DoudizhuConfig>;
    const { valid, errors } = validateConfig(parsed);
    if (valid) {
      return { success: true, config: mergeConfig(parsed) };
    }
    return { success: false, error: errors.join('; ') };
  } catch (e) {
    return { success: false, error: `JSON解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ==================== 配置UI描述 ====================

/** 设置面板Tab定义 */
export interface SettingsTab {
  key: string;
  label: string;
  icon: string; // 图标名称
}

export const SETTINGS_TABS: SettingsTab[] = [
  { key: 'game', label: '游戏', icon: 'game' },
  { key: 'ai', label: 'AI', icon: 'robot' },
  { key: 'advanced', label: '高级', icon: 'settings' },
];

// ==================== 预设配置 ====================

/** 快速游戏预设 */
export const PRESET_QUICK: Partial<DoudizhuConfig> = {
  playTimeout: 15,
  bidTimeout: 10,
  aiDifficulty: 'easy',
};

/** 经典模式预设 */
export const PRESET_CLASSIC: Partial<DoudizhuConfig> = {
  playTimeout: 30,
  bidTimeout: 15,
  aiDifficulty: 'medium',
  enableGrab: false,
  enableShowCards: false,
};

/** 竞技模式预设 */
export const PRESET_COMPETITIVE: Partial<DoudizhuConfig> = {
  playTimeout: 20,
  bidTimeout: 10,
  aiDifficulty: 'hard',
  enableGrab: true,
  enableShowCards: true,
};

/** 所有预设 */
export const CONFIG_PRESETS = [
  { key: 'classic', label: '经典模式', config: PRESET_CLASSIC },
  { key: 'quick', label: '快速游戏', config: PRESET_QUICK },
  { key: 'competitive', label: '竞技模式', config: PRESET_COMPETITIVE },
];

export default {
  SETTING_GROUPS,
  SETTINGS_TABS,
  CONFIG_PRESETS,
  validateConfig,
  mergeConfig,
  loadConfigFromStorage,
  saveConfigToStorage,
  exportConfig,
  importConfig,
};
