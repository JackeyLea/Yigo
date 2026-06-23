/**
 * 麻将插件 - 设置模块
 * Mahjong Plugin - Settings Module
 */

import {
  MahjongSettings,
  MahjongEngineConfig,
  DEFAULT_SETTINGS,
  AIDifficulty,
} from './mahjong.types';

/** 设置变更监听器 */
export type SettingsChangeListener = (settings: MahjongSettings) => void;

export class MahjongSettingsManager {
  private settings: MahjongSettings;
  private listeners: SettingsChangeListener[] = [];

  constructor(initialSettings?: Partial<MahjongSettings>) {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...initialSettings,
      engineConfig: {
        ...DEFAULT_SETTINGS.engineConfig,
        ...initialSettings?.engineConfig,
      },
    };
  }

  /** 获取当前设置 */
  getSettings(): MahjongSettings {
    return { ...this.settings };
  }

  /** 获取引擎配置 */
  getEngineConfig(): MahjongEngineConfig {
    return { ...this.settings.engineConfig };
  }

  /** 更新设置 */
  updateSettings(partial: Partial<MahjongSettings>): void {
    this.settings = {
      ...this.settings,
      ...partial,
      engineConfig: {
        ...this.settings.engineConfig,
        ...partial.engineConfig,
      },
    };
    this.notifyListeners();
  }

  /** 更新引擎配置 */
  updateEngineConfig(config: Partial<MahjongEngineConfig>): void {
    this.settings.engineConfig = {
      ...this.settings.engineConfig,
      ...config,
    };
    this.notifyListeners();
  }

  /** 设置AI难度 */
  setAIDifficulty(difficulty: AIDifficulty): void {
    this.settings.aiDifficulty = difficulty;
    this.notifyListeners();
  }

  /** 重置为默认设置 */
  resetToDefaults(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.notifyListeners();
  }

  /** 订阅设置变更 */
  onChange(listener: SettingsChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    const settings = this.getSettings();
    for (const listener of this.listeners) {
      listener(settings);
    }
  }

  /** 序列化设置 */
  serialize(): string {
    return JSON.stringify(this.settings);
  }

  /** 反序列化设置 */
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data);
      this.updateSettings(parsed);
    } catch (e) {
      console.error('Failed to deserialize mahjong settings:', e);
    }
  }
}

/** 预设配置 */
export const PRESET_CONFIGS = {
  /** 标准立直麻将 */
  standard: {
    ...DEFAULT_SETTINGS,
  },

  /** 快速对局（无立直棒，无宝牌） */
  quick: {
    ...DEFAULT_SETTINGS,
    engineConfig: {
      ...DEFAULT_SETTINGS.engineConfig,
      enableDora: false,
      enableRiichi: false,
    },
    timeLimit: 15,
  },

  /** 竞技模式（严格规则） */
  competitive: {
    ...DEFAULT_SETTINGS,
    engineConfig: {
      ...DEFAULT_SETTINGS.engineConfig,
      enableKuitan: false,
    },
    aiDifficulty: 'hard' as AIDifficulty,
    timeLimit: 30,
  },

  /** 练习模式（提示开启） */
  practice: {
    ...DEFAULT_SETTINGS,
    aiDifficulty: 'easy' as AIDifficulty,
    enableHints: true,
    timeLimit: 0, // 无时间限制
  },
};
