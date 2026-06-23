/**
 * 黑白棋（Reversi/Othello）插件配置 Schema
 *
 * 定义插件的配置项、校验规则、默认值
 * 遵循需求文档第6章 - 黑白棋插件设计需求
 */

import type { ReversiPluginOptions, AIDifficulty } from './reversi.types';

/** 配置项元数据 */
export interface SettingField<T> {
  /** 配置键名 */
  key: string;
  /** 显示名称 */
  label: string;
  /** 描述 */
  description: string;
  /** 配置类型 */
  type: 'boolean' | 'string' | 'number' | 'select';
  /** 默认值 */
  defaultValue: T;
  /** 可选值（select类型用） */
  options?: Array<{ label: string; value: T }>;
  /** 校验规则 */
  validate?: (value: T) => string | null;
  /** 分组 */
  group: 'ai' | 'general' | 'rules';
}

/** AI 难度选项 */
export const AI_DIFFICULTY_OPTIONS: Array<{ label: string; value: AIDifficulty }> = [
  { label: '简单（贪心算法）', value: 'easy' },
  { label: '中等（Minimax 深度3）', value: 'medium' },
  { label: '困难（深度搜索+终局穷举）', value: 'hard' },
];

/** AI 执子选项 */
export const AI_PLAYER_OPTIONS: Array<{ label: string; value: 1 | 2 | null }> = [
  { label: '不启用AI', value: null },
  { label: 'AI执黑（先手）', value: 1 },
  { label: 'AI执白（后手）', value: 2 },
];

/** 完整配置 Schema */
export const REVERSI_SETTINGS_SCHEMA: SettingField<unknown>[] = [
  // ===== AI 设置 =====
  {
    key: 'enableAI',
    label: '启用AI对手',
    description: '是否启用AI对手进行人机对战',
    type: 'boolean',
    defaultValue: false,
    group: 'ai',
  },
  {
    key: 'aiDifficulty',
    label: 'AI 难度',
    description: '选择AI对手的算法难度级别',
    type: 'select',
    defaultValue: 'medium' as AIDifficulty,
    options: AI_DIFFICULTY_OPTIONS,
    group: 'ai',
  },
  {
    key: 'aiPlayer',
    label: 'AI 执子',
    description: '选择AI执黑（先手）或执白（后手）',
    type: 'select',
    defaultValue: null as 1 | 2 | null,
    options: AI_PLAYER_OPTIONS,
    group: 'ai',
  },

  // ===== 通用设置 =====
  {
    key: 'allowUndo',
    label: '允许悔棋',
    description: '是否允许玩家悔棋（撤销上一步）',
    type: 'boolean',
    defaultValue: true,
    group: 'general',
  },
  {
    key: 'showHints',
    label: '显示走法提示',
    description: '是否在棋盘上高亮显示合法走法位置',
    type: 'boolean',
    defaultValue: true,
    group: 'general',
  },
  {
    key: 'moveTimeout',
    label: '走棋限时',
    description: '每步走棋的时间限制（秒），0表示不限时',
    type: 'number',
    defaultValue: 0,
    validate: (value: number) => {
      if (value < 0) return '走棋限时不能为负数';
      if (value > 3600) return '走棋限时不能超过3600秒';
      return null;
    },
    group: 'general',
  },
];

/** 默认配置 */
export const REVERSI_DEFAULT_SETTINGS: ReversiPluginOptions = {
  enableAI: false,
  aiDifficulty: 'medium',
  aiPlayer: null,
  allowUndo: true,
  showHints: true,
  moveTimeout: 0,
};

/**
 * 配置校验函数
 * @param settings - 待校验的配置
 * @returns 校验结果：通过返回 null，失败返回错误信息
 */
export function validateSettings(
  settings: Partial<ReversiPluginOptions>
): string | null {
  if (settings.moveTimeout !== undefined) {
    if (settings.moveTimeout < 0) return '走棋限时不能为负数';
    if (settings.moveTimeout > 3600) return '走棋限时不能超过3600秒';
  }

  if (settings.aiDifficulty !== undefined) {
    const validDifficulties: AIDifficulty[] = ['easy', 'medium', 'hard'];
    if (!validDifficulties.includes(settings.aiDifficulty)) {
      return `无效的AI难度: ${settings.aiDifficulty}`;
    }
  }

  if (settings.aiPlayer !== undefined) {
    if (settings.aiPlayer !== null && settings.aiPlayer !== 1 && settings.aiPlayer !== 2) {
      return `无效的AI执子: ${settings.aiPlayer}`;
    }
  }

  return null;
}

/**
 * 合并配置（用户提供 + 默认值）
 * @param userSettings - 用户提供的配置
 * @returns 完整配置
 */
export function mergeSettings(
  userSettings?: Partial<ReversiPluginOptions>
): ReversiPluginOptions {
  return {
    ...REVERSI_DEFAULT_SETTINGS,
    ...userSettings,
  };
}

/**
 * 获取设置项元数据
 * @param key - 配置键名
 * @returns 设置项元数据
 */
export function getSettingField(key: string): SettingField<unknown> | undefined {
  return REVERSI_SETTINGS_SCHEMA.find((field) => field.key === key);
}

/**
 * 按分组获取设置项
 * @param group - 分组名
 * @returns 该分组下的所有设置项
 */
export function getSettingsByGroup(
  group: 'ai' | 'general' | 'rules'
): SettingField<unknown>[] {
  return REVERSI_SETTINGS_SCHEMA.filter((field) => field.group === group);
}
