/**
 * 斗地主配置管理单元测试
 */

import {
  SETTING_GROUPS,
  SETTINGS_TABS,
  CONFIG_PRESETS,
  validateConfig,
  mergeConfig,
  exportConfig,
  importConfig,
  GAME_SETTINGS,
  AI_SETTINGS,
  ADVANCED_SETTINGS,
} from '../doudizhu.settings';
import { DEFAULT_DOUDIZHU_CONFIG, type DoudizhuConfig } from '../doudizhu.types';

describe('DoudizhuSettings - 设置结构', () => {
  it('应有3个设置分组', () => {
    expect(SETTING_GROUPS).toHaveLength(3);
  });

  it('应包含游戏设置分组', () => {
    const gameGroup = SETTING_GROUPS.find((g) => g.key === 'game');
    expect(gameGroup).toBeDefined();
    expect(gameGroup?.label).toBe('游戏设置');
  });

  it('应包含AI设置分组', () => {
    const aiGroup = SETTING_GROUPS.find((g) => g.key === 'ai');
    expect(aiGroup).toBeDefined();
    expect(aiGroup?.label).toBe('AI设置');
  });

  it('应包含高级设置分组', () => {
    const advGroup = SETTING_GROUPS.find((g) => g.key === 'advanced');
    expect(advGroup).toBeDefined();
    expect(advGroup?.label).toBe('高级设置');
  });

  it('游戏设置应有有效字段', () => {
    expect(GAME_SETTINGS.length).toBeGreaterThan(0);
    for (const field of GAME_SETTINGS) {
      expect(field.key).toBeDefined();
      expect(field.label).toBeDefined();
      expect(field.type).toBeDefined();
      expect(field.defaultValue).toBeDefined();
    }
  });

  it('AI设置应有难度选项', () => {
    const difficultyField = AI_SETTINGS.find((f) => f.key === 'aiDifficulty');
    expect(difficultyField).toBeDefined();
    expect(difficultyField?.type).toBe('select');
    expect(difficultyField?.options?.length).toBe(3);
  });

  it('设置Tab应有正确的图标', () => {
    expect(SETTINGS_TABS).toHaveLength(3);
    expect(SETTINGS_TABS[0].icon).toBeDefined();
  });
});

describe('DoudizhuSettings - 配置预设', () => {
  it('应有3个预设', () => {
    expect(CONFIG_PRESETS).toHaveLength(3);
  });

  it('经典模式预设应存在', () => {
    const preset = CONFIG_PRESETS.find((p) => p.key === 'classic');
    expect(preset).toBeDefined();
    expect(preset?.label).toBe('经典模式');
  });

  it('快速游戏预设应存在', () => {
    const preset = CONFIG_PRESETS.find((p) => p.key === 'quick');
    expect(preset).toBeDefined();
    expect(preset?.label).toBe('快速游戏');
  });

  it('竞技模式预设应存在', () => {
    const preset = CONFIG_PRESETS.find((p) => p.key === 'competitive');
    expect(preset).toBeDefined();
    expect(preset?.label).toBe('竞技模式');
  });

  it('经典模式应使用中等AI难度', () => {
    const preset = CONFIG_PRESETS.find((p) => p.key === 'classic');
    expect(preset?.config.aiDifficulty).toBe('medium');
  });

  it('快速游戏应有较短超时', () => {
    const preset = CONFIG_PRESETS.find((p) => p.key === 'quick');
    expect(preset?.config.playTimeout).toBeLessThan(
      DEFAULT_DOUDIZHU_CONFIG.playTimeout,
    );
  });
});

describe('DoudizhuSettings - 配置验证', () => {
  it('有效配置应通过验证', () => {
    const config: Partial<DoudizhuConfig> = {
      baseScore: 5,
      maxRounds: 10,
      aiDifficulty: 'hard',
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('底分小于1应失败', () => {
    const result = validateConfig({ baseScore: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('底分'))).toBe(true);
  });

  it('底分大于100应失败', () => {
    const result = validateConfig({ baseScore: 101 });
    expect(result.valid).toBe(false);
  });

  it('负局数应失败', () => {
    const result = validateConfig({ maxRounds: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('局数'))).toBe(true);
  });

  it('负超时时间应失败', () => {
    const result = validateConfig({ playTimeout: -1 });
    expect(result.valid).toBe(false);
  });

  it('无效AI难度应失败', () => {
    const result = validateConfig({
      aiDifficulty: 'invalid' as 'easy',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('AI难度'))).toBe(true);
  });

  it('无效AI类型应失败', () => {
    const result = validateConfig({
      aiType: 'invalid' as 'rule_based',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('AI类型'))).toBe(true);
  });

  it('空配置应通过验证', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
  });
});

describe('DoudizhuSettings - 配置合并', () => {
  it('空配置应返回默认配置', () => {
    const config = mergeConfig({});
    expect(config.baseScore).toBe(DEFAULT_DOUDIZHU_CONFIG.baseScore);
    expect(config.aiDifficulty).toBe(DEFAULT_DOUDIZHU_CONFIG.aiDifficulty);
    expect(config.maxRounds).toBe(DEFAULT_DOUDIZHU_CONFIG.maxRounds);
  });

  it('应覆盖默认配置', () => {
    const config = mergeConfig({ baseScore: 10, aiDifficulty: 'hard' });
    expect(config.baseScore).toBe(10);
    expect(config.aiDifficulty).toBe('hard');
    // 未修改的应保持默认
    expect(config.maxRounds).toBe(DEFAULT_DOUDIZHU_CONFIG.maxRounds);
  });

  it('应返回完整配置', () => {
    const config = mergeConfig({});
    expect(config).toHaveProperty('baseScore');
    expect(config).toHaveProperty('maxRounds');
    expect(config).toHaveProperty('aiDifficulty');
    expect(config).toHaveProperty('aiType');
    expect(config).toHaveProperty('playTimeout');
    expect(config).toHaveProperty('bidTimeout');
    expect(config).toHaveProperty('enableGrab');
    expect(config).toHaveProperty('enableShowCards');
  });
});

describe('DoudizhuSettings - 配置导入导出', () => {
  it('应能导出配置为JSON', () => {
    const config = mergeConfig({ baseScore: 5 });
    const json = exportConfig(config);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('导出JSON应包含配置值', () => {
    const config = mergeConfig({ baseScore: 7, aiDifficulty: 'hard' });
    const json = exportConfig(config);
    const parsed = JSON.parse(json);
    expect(parsed.baseScore).toBe(7);
    expect(parsed.aiDifficulty).toBe('hard');
  });

  it('应能导入有效JSON配置', () => {
    const json = JSON.stringify({ baseScore: 5, aiDifficulty: 'medium' });
    const result = importConfig(json);
    expect(result.success).toBe(true);
    expect(result.config?.baseScore).toBe(5);
  });

  it('导入无效JSON应失败', () => {
    const result = importConfig('not valid json');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('导入无效配置值应失败', () => {
    const json = JSON.stringify({ baseScore: -1 });
    const result = importConfig(json);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('导入空JSON应使用默认配置', () => {
    const result = importConfig('{}');
    expect(result.success).toBe(true);
    expect(result.config?.baseScore).toBe(DEFAULT_DOUDIZHU_CONFIG.baseScore);
  });
});

describe('DoudizhuSettings - 设置字段类型', () => {
  it('baseScore应为number类型', () => {
    const field = GAME_SETTINGS.find((f) => f.key === 'baseScore');
    expect(field?.type).toBe('number');
    expect(field?.min).toBeDefined();
    expect(field?.max).toBeDefined();
  });

  it('aiDifficulty应为select类型', () => {
    const field = AI_SETTINGS.find((f) => f.key === 'aiDifficulty');
    expect(field?.type).toBe('select');
    expect(field?.options).toBeDefined();
    expect(field?.options!.length).toBeGreaterThan(0);
  });

  it('aiDifficulty选项应包含所有难度', () => {
    const field = AI_SETTINGS.find((f) => f.key === 'aiDifficulty');
    const values = field?.options?.map((o) => o.value);
    expect(values).toContain('easy');
    expect(values).toContain('medium');
    expect(values).toContain('hard');
  });

  it('enableGrab应为boolean类型', () => {
    const field = ADVANCED_SETTINGS.find((f) => f.key === 'enableGrab');
    expect(field?.type).toBe('boolean');
  });

  it('playTimeout应为range类型', () => {
    const field = GAME_SETTINGS.find((f) => f.key === 'playTimeout');
    expect(field?.type).toBe('range');
    expect(field?.min).toBeDefined();
    expect(field?.max).toBeDefined();
  });
});
