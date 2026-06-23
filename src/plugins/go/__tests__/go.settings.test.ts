/**
 * Go Plugin Settings Unit Tests
 *
 * Tests for settings validation, management, and schema.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
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
} from '../go.settings';

describe('Validators', () => {
  describe('isValidBoardSize', () => {
    it('should accept 9', () => {
      expect(isValidBoardSize(9)).toBe(true);
    });
    it('should accept 13', () => {
      expect(isValidBoardSize(13)).toBe(true);
    });
    it('should accept 19', () => {
      expect(isValidBoardSize(19)).toBe(true);
    });
    it('should reject other sizes', () => {
      expect(isValidBoardSize(5)).toBe(false);
      expect(isValidBoardSize(21)).toBe(false);
      expect(isValidBoardSize(0)).toBe(false);
    });
  });

  describe('isValidKomi', () => {
    it('should accept common komi values', () => {
      expect(isValidKomi(0)).toBe(true);
      expect(isValidKomi(5.5)).toBe(true);
      expect(isValidKomi(6.5)).toBe(true);
      expect(isValidKomi(7.5)).toBe(true);
    });
    it('should reject invalid komi', () => {
      expect(isValidKomi(-1)).toBe(false);
      expect(isValidKomi(21)).toBe(false);
    });
    it('should accept half-point increments', () => {
      expect(isValidKomi(0.5)).toBe(true);
      expect(isValidKomi(1.5)).toBe(true);
    });
  });

  describe('isValidHandicap', () => {
    it('should accept 0', () => {
      expect(isValidHandicap(0)).toBe(true);
    });
    it('should accept 2', () => {
      expect(isValidHandicap(2)).toBe(true);
    });
    it('should accept 9', () => {
      expect(isValidHandicap(9)).toBe(true);
    });
    it('should reject negative', () => {
      expect(isValidHandicap(-1)).toBe(false);
    });
    it('should reject too high', () => {
      expect(isValidHandicap(10)).toBe(false);
    });
    it('should consider board size for 9x9', () => {
      expect(isValidHandicap(6, 9)).toBe(false);
      expect(isValidHandicap(5, 9)).toBe(true);
    });
    it('should consider board size for 13x13', () => {
      expect(isValidHandicap(6, 13)).toBe(false);
      expect(isValidHandicap(5, 13)).toBe(true);
    });
  });

  describe('isValidAIDifficulty', () => {
    it('should accept all valid difficulties', () => {
      expect(isValidAIDifficulty('beginner')).toBe(true);
      expect(isValidAIDifficulty('elementary')).toBe(true);
      expect(isValidAIDifficulty('intermediate')).toBe(true);
      expect(isValidAIDifficulty('advanced')).toBe(true);
    });
    it('should reject invalid difficulties', () => {
      expect(isValidAIDifficulty('expert')).toBe(false);
      expect(isValidAIDifficulty('')).toBe(false);
    });
  });

  describe('isValidTheme', () => {
    it('should accept valid themes', () => {
      expect(isValidTheme('classic')).toBe(true);
      expect(isValidTheme('modern')).toBe(true);
      expect(isValidTheme('dark')).toBe(true);
    });
    it('should reject invalid themes', () => {
      expect(isValidTheme('blue')).toBe(false);
      expect(isValidTheme('')).toBe(false);
    });
  });
});

describe('DEFAULT_GO_SETTINGS', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_GO_SETTINGS.defaultBoardSize).toBe(19);
    expect(DEFAULT_GO_SETTINGS.defaultKomi).toBe(7.5);
    expect(DEFAULT_GO_SETTINGS.defaultHandicap).toBe(0);
    expect(DEFAULT_GO_SETTINGS.defaultAIDifficulty).toBe('intermediate');
    expect(DEFAULT_GO_SETTINGS.enableSuperKo).toBe(true);
    expect(DEFAULT_GO_SETTINGS.enableScoring).toBe(true);
    expect(DEFAULT_GO_SETTINGS.enableAI).toBe(true);
    expect(DEFAULT_GO_SETTINGS.enableSGF).toBe(true);
    expect(DEFAULT_GO_SETTINGS.theme).toBe('classic');
    expect(DEFAULT_GO_SETTINGS.showCoordinates).toBe(true);
    expect(DEFAULT_GO_SETTINGS.showLastMove).toBe(true);
    expect(DEFAULT_GO_SETTINGS.showMoveNumber).toBe(false);
    expect(DEFAULT_GO_SETTINGS.soundEnabled).toBe(true);
    expect(DEFAULT_GO_SETTINGS.animationEnabled).toBe(true);
  });
});

describe('GO_SETTINGS_SCHEMA', () => {
  it('should have schema entries for all settings', () => {
    const keys = GO_SETTINGS_SCHEMA.map((e) => e.key);
    expect(keys).toContain('defaultBoardSize');
    expect(keys).toContain('defaultKomi');
    expect(keys).toContain('defaultHandicap');
    expect(keys).toContain('defaultAIDifficulty');
    expect(keys).toContain('enableSuperKo');
    expect(keys).toContain('enableAI');
    expect(keys).toContain('theme');
    expect(keys).toContain('showCoordinates');
    expect(keys).toContain('showLastMove');
    expect(keys).toContain('showMoveNumber');
    expect(keys).toContain('soundEnabled');
    expect(keys).toContain('animationEnabled');
  });

  it('should have correct categories', () => {
    const categories = new Set(GO_SETTINGS_SCHEMA.map((e) => e.category));
    expect(categories.has('game')).toBe(true);
    expect(categories.has('ai')).toBe(true);
    expect(categories.has('rules')).toBe(true);
    expect(categories.has('ui')).toBe(true);
  });

  it('each entry should have required fields', () => {
    for (const entry of GO_SETTINGS_SCHEMA) {
      expect(entry.key).toBeDefined();
      expect(entry.type).toBeDefined();
      expect(entry.default).toBeDefined();
      expect(entry.description).toBeDefined();
      expect(entry.category).toBeDefined();
      expect(entry.validate).toBeDefined();
    }
  });
});

describe('GoSettingsManager', () => {
  let manager: GoSettingsManager;

  beforeEach(() => {
    manager = new GoSettingsManager();
  });

  describe('Construction', () => {
    it('should initialize with defaults', () => {
      const settings = manager.getSettings();
      expect(settings.defaultBoardSize).toBe(19);
      expect(settings.defaultKomi).toBe(7.5);
    });

    it('should accept initial settings', () => {
      const manager = new GoSettingsManager({ defaultBoardSize: 9, defaultKomi: 6.5 });
      expect(manager.get('defaultBoardSize')).toBe(9);
      expect(manager.get('defaultKomi')).toBe(6.5);
    });
  });

  describe('get/set', () => {
    it('should get a setting value', () => {
      expect(manager.get('defaultBoardSize')).toBe(19);
      expect(manager.get('enableAI')).toBe(true);
    });

    it('should set a valid setting', () => {
      const result = manager.set('defaultBoardSize', 13);
      expect(result).toBe(true);
      expect(manager.get('defaultBoardSize')).toBe(13);
    });

    it('should reject invalid value', () => {
      const result = manager.set('defaultBoardSize', 21 as any);
      expect(result).toBe(false);
      expect(manager.get('defaultBoardSize')).toBe(19); // Unchanged
    });

    it('should handle unknown key', () => {
      const result = manager.set('unknownKey' as any, 'value');
      expect(result).toBe(false);
    });
  });

  describe('setMultiple', () => {
    it('should set multiple valid settings', () => {
      const result = manager.setMultiple({
        defaultBoardSize: 9,
        defaultKomi: 6.5,
        theme: 'dark',
      });
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(manager.get('defaultBoardSize')).toBe(9);
      expect(manager.get('defaultKomi')).toBe(6.5);
      expect(manager.get('theme')).toBe('dark');
    });

    it('should handle invalid settings gracefully', () => {
      const result = manager.setMultiple({
        defaultBoardSize: 21 as any, // Invalid
        defaultKomi: 6.5, // Valid
      });
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Valid setting should still be applied
      expect(manager.get('defaultKomi')).toBe(6.5);
    });

    it('should handle unknown keys', () => {
      const result = manager.setMultiple({
        unknownKey: 'value',
      } as any);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Unknown setting: unknownKey');
    });
  });

  describe('reset', () => {
    it('should reset all settings to defaults', () => {
      manager.set('defaultBoardSize', 9);
      manager.set('theme', 'dark');
      manager.reset();

      expect(manager.get('defaultBoardSize')).toBe(19);
      expect(manager.get('theme')).toBe('classic');
    });
  });

  describe('resetKey', () => {
    it('should reset a single key to default', () => {
      manager.set('defaultBoardSize', 9);
      manager.resetKey('defaultBoardSize');
      expect(manager.get('defaultBoardSize')).toBe(19);
    });
  });

  describe('validateAll', () => {
    it('should validate default settings', () => {
      const result = manager.validateAll();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getByCategory', () => {
    it('should return game settings', () => {
      const game = manager.getByCategory('game');
      expect(game.defaultBoardSize).toBeDefined();
      expect(game.defaultKomi).toBeDefined();
      expect(game.defaultHandicap).toBeDefined();
    });

    it('should return AI settings', () => {
      const ai = manager.getByCategory('ai');
      expect(ai.defaultAIDifficulty).toBeDefined();
      expect(ai.enableAI).toBeDefined();
    });

    it('should return rule settings', () => {
      const rules = manager.getByCategory('rules');
      expect(rules.enableSuperKo).toBeDefined();
      expect(rules.enableScoring).toBeDefined();
      expect(rules.enableSGF).toBeDefined();
    });

    it('should return UI settings', () => {
      const ui = manager.getByCategory('ui');
      expect(ui.theme).toBeDefined();
      expect(ui.showCoordinates).toBeDefined();
    });
  });

  describe('serialize/deserialize', () => {
    it('should serialize to JSON', () => {
      const json = manager.serialize();
      const parsed = JSON.parse(json);
      expect(parsed.defaultBoardSize).toBe(19);
      expect(parsed.defaultKomi).toBe(7.5);
    });

    it('should deserialize from JSON', () => {
      const json = JSON.stringify({ defaultBoardSize: 9, theme: 'dark' });
      const result = manager.deserialize(json);
      expect(result.success).toBe(true);
      expect(manager.get('defaultBoardSize')).toBe(9);
      expect(manager.get('theme')).toBe('dark');
    });

    it('should reject invalid JSON', () => {
      const result = manager.deserialize('not json');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid JSON format');
    });

    it('should round-trip correctly', () => {
      manager.set('defaultBoardSize', 9);
      manager.set('defaultKomi', 6.5);
      manager.set('theme', 'dark');

      const json = manager.serialize();
      const newManager = new GoSettingsManager();
      newManager.deserialize(json);

      expect(newManager.get('defaultBoardSize')).toBe(9);
      expect(newManager.get('defaultKomi')).toBe(6.5);
      expect(newManager.get('theme')).toBe('dark');
    });
  });

  describe('schema queries', () => {
    it('should return full schema', () => {
      const schema = manager.getSchema();
      expect(schema.length).toBeGreaterThan(0);
    });

    it('should return schema entry for key', () => {
      const entry = manager.getSchemaEntry('defaultBoardSize');
      expect(entry).toBeDefined();
      expect(entry!.key).toBe('defaultBoardSize');
    });

    it('should return undefined for unknown key', () => {
      const entry = manager.getSchemaEntry('unknown');
      expect(entry).toBeUndefined();
    });

    it('should check if key exists', () => {
      expect(manager.hasKey('defaultBoardSize')).toBe(true);
      expect(manager.hasKey('unknown')).toBe(false);
    });
  });

  describe('static methods', () => {
    it('should get defaults statically', () => {
      const defaults = GoSettingsManager.getDefaults();
      expect(defaults.defaultBoardSize).toBe(19);
    });

    it('should create with factory', () => {
      const manager = GoSettingsManager.create({ defaultBoardSize: 9 });
      expect(manager.get('defaultBoardSize')).toBe(9);
    });
  });
});

describe('Utility Functions', () => {
  describe('mergeWithDefaults', () => {
    it('should use defaults when no partial', () => {
      const settings = mergeWithDefaults();
      expect(settings.defaultBoardSize).toBe(19);
    });

    it('should override defaults', () => {
      const settings = mergeWithDefaults({ defaultBoardSize: 9 });
      expect(settings.defaultBoardSize).toBe(9);
      expect(settings.defaultKomi).toBe(7.5); // Default preserved
    });
  });

  describe('getAIDifficultyPresets', () => {
    it('should return all difficulty presets', () => {
      const presets = getAIDifficultyPresets();
      expect(presets.beginner).toBeDefined();
      expect(presets.elementary).toBeDefined();
      expect(presets.intermediate).toBeDefined();
      expect(presets.advanced).toBeDefined();
    });

    it('should have correct simulation counts', () => {
      const presets = getAIDifficultyPresets();
      expect(presets.beginner.simulations).toBe(0);
      expect(presets.elementary.simulations).toBe(100);
      expect(presets.intermediate.simulations).toBe(1000);
      expect(presets.advanced.simulations).toBe(5000);
    });
  });

  describe('createGameOptionsFromSettings', () => {
    it('should create options from settings', () => {
      const settings = GoSettingsManager.getDefaults();
      const options = createGameOptionsFromSettings(settings);
      expect(options.boardSize).toBe(19);
      expect(options.komi).toBe(7.5);
      expect(options.handicap).toBe(0);
      expect(options.aiDifficulty).toBe('intermediate');
    });

    it('should apply overrides', () => {
      const settings = GoSettingsManager.getDefaults();
      const options = createGameOptionsFromSettings(settings, {
        defaultBoardSize: 9,
      });
      expect(options.boardSize).toBe(9);
      expect(options.komi).toBe(7.5);
    });

    it('should not include aiDifficulty when AI disabled', () => {
      const settings = { ...GoSettingsManager.getDefaults(), enableAI: false };
      const options = createGameOptionsFromSettings(settings);
      expect(options.aiDifficulty).toBeUndefined();
    });
  });
});
