/**
 * Go (围棋) Plugin - Settings Schema
 *
 * Defines the default configuration, validation rules,
 * and schema for all plugin settings.
 */

import type {
  BoardSize,
  GoSettings,
  AIDifficultyConfig,
  SettingSchemaEntry,
} from './go.types';

// ---------------------------------------------------------------------------
// Default Settings
// ---------------------------------------------------------------------------

/** Default plugin settings */
export const DEFAULT_GO_SETTINGS: GoSettings = {
  defaultBoardSize: 19,
  defaultKomi: 7.5,
  defaultHandicap: 0,
  defaultAIDifficulty: 'intermediate',
  enableSuperKo: true,
  enableScoring: true,
  enableAI: true,
  enableSGF: true,
  theme: 'classic',
  showCoordinates: true,
  showLastMove: true,
  showMoveNumber: false,
  soundEnabled: true,
  animationEnabled: true,
};

// ---------------------------------------------------------------------------
// Setting Validators
// ---------------------------------------------------------------------------

/** Validate board size */
export function isValidBoardSize(size: number): size is BoardSize {
  return size === 9 || size === 13 || size === 19;
}

/** Validate komi value */
export function isValidKomi(komi: number): boolean {
  return komi >= 0 && komi <= 20 && (komi * 2) % 1 === 0; // Half-point increments
}

/** Validate handicap */
export function isValidHandicap(handicap: number, boardSize?: number): boolean {
  if (handicap < 0 || handicap > 9) return false;
  if (boardSize === 9 && handicap > 5) return false;
  if (boardSize === 13 && handicap > 5) return false;
  return true;
}

/** Validate AI difficulty */
export function isValidAIDifficulty(
  difficulty: string
): difficulty is 'beginner' | 'elementary' | 'intermediate' | 'advanced' {
  return ['beginner', 'elementary', 'intermediate', 'advanced'].includes(
    difficulty
  );
}

/** Validate theme */
export function isValidTheme(
  theme: string
): theme is 'classic' | 'modern' | 'dark' {
  return ['classic', 'modern', 'dark'].includes(theme);
}

// ---------------------------------------------------------------------------
// Settings Schema Definition
// ---------------------------------------------------------------------------

/** Complete settings schema */
export const GO_SETTINGS_SCHEMA: SettingSchemaEntry[] = [
  // Game settings
  {
    key: 'defaultBoardSize',
    type: 'enum',
    default: 19,
    description: 'Default board size (9x9, 13x13, or 19x19)',
    category: 'game',
    validate: (v) => isValidBoardSize(Number(v)),
    options: [9, 13, 19],
  },
  {
    key: 'defaultKomi',
    type: 'number',
    default: 7.5,
    description: 'Default komi (compensation points for White)',
    category: 'game',
    validate: (v) => isValidKomi(Number(v)),
    min: 0,
    max: 20,
  },
  {
    key: 'defaultHandicap',
    type: 'number',
    default: 0,
    description: 'Default handicap stones for Black',
    category: 'game',
    validate: (v) => isValidHandicap(Number(v)),
    min: 0,
    max: 9,
  },

  // AI settings
  {
    key: 'defaultAIDifficulty',
    type: 'enum',
    default: 'intermediate',
    description: 'Default AI difficulty level',
    category: 'ai',
    validate: (v) => isValidAIDifficulty(String(v)),
    options: ['beginner', 'elementary', 'intermediate', 'advanced'],
  },
  {
    key: 'enableAI',
    type: 'boolean',
    default: true,
    description: 'Enable AI opponent',
    category: 'ai',
    validate: (v) => typeof v === 'boolean',
  },

  // Rule settings
  {
    key: 'enableSuperKo',
    type: 'boolean',
    default: true,
    description: 'Enable Super Ko (positional) rule',
    category: 'rules',
    validate: (v) => typeof v === 'boolean',
  },
  {
    key: 'enableScoring',
    type: 'boolean',
    default: true,
    description: 'Enable endgame scoring',
    category: 'rules',
    validate: (v) => typeof v === 'boolean',
  },
  {
    key: 'enableSGF',
    type: 'boolean',
    default: true,
    description: 'Enable SGF import/export support',
    category: 'rules',
    validate: (v) => typeof v === 'boolean',
  },

  // UI settings
  {
    key: 'theme',
    type: 'enum',
    default: 'classic',
    description: 'Board visual theme',
    category: 'ui',
    validate: (v) => isValidTheme(String(v)),
    options: ['classic', 'modern', 'dark'],
  },
  {
    key: 'showCoordinates',
    type: 'boolean',
    default: true,
    description: 'Show board coordinates (A-T, 1-19)',
    category: 'ui',
    validate: (v) => typeof v === 'boolean',
  },
  {
    key: 'showLastMove',
    type: 'boolean',
    default: true,
    description: 'Highlight the last move played',
    category: 'ui',
    validate: (v) => typeof v === 'boolean',
  },
  {
    key: 'showMoveNumber',
    type: 'boolean',
    default: false,
    description: 'Show move numbers on stones',
    category: 'ui',
    validate: (v) => typeof v === 'boolean',
  },
  {
    key: 'soundEnabled',
    type: 'boolean',
    default: true,
    description: 'Enable sound effects',
    category: 'ui',
    validate: (v) => typeof v === 'boolean',
  },
  {
    key: 'animationEnabled',
    type: 'boolean',
    default: true,
    description: 'Enable piece placement animations',
    category: 'ui',
    validate: (v) => typeof v === 'boolean',
  },
];

// ---------------------------------------------------------------------------
// Settings Manager
// ---------------------------------------------------------------------------

/**
 * Settings manager for the Go plugin
 * Handles validation, merging, and serialization of settings
 */
export class GoSettingsManager {
  private settings: GoSettings;

  constructor(initialSettings?: Partial<GoSettings>) {
    this.settings = { ...DEFAULT_GO_SETTINGS, ...initialSettings };
    this.validateAll();
  }

  /** Get all current settings */
  getSettings(): GoSettings {
    return { ...this.settings };
  }

  /** Get a specific setting */
  get<K extends keyof GoSettings>(key: K): GoSettings[K] {
    return this.settings[key];
  }

  /** Set a specific setting with validation */
  set<K extends keyof GoSettings>(key: K, value: GoSettings[K]): boolean {
    const schemaEntry = GO_SETTINGS_SCHEMA.find((e) => e.key === key);
    if (!schemaEntry) {
      console.warn(`Unknown setting: ${String(key)}`);
      return false;
    }

    if (!schemaEntry.validate(value)) {
      console.warn(`Invalid value for setting ${String(key)}: ${value}`);
      return false;
    }

    this.settings = { ...this.settings, [key]: value };
    return true;
  }

  /** Set multiple settings at once */
  setMultiple(settings: Partial<GoSettings>): {
    success: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const newSettings = { ...this.settings };

    for (const [key, value] of Object.entries(settings)) {
      const schemaEntry = GO_SETTINGS_SCHEMA.find((e) => e.key === key);
      if (!schemaEntry) {
        errors.push(`Unknown setting: ${key}`);
        continue;
      }

      if (!schemaEntry.validate(value)) {
        errors.push(`Invalid value for setting ${key}: ${value}`);
        continue;
      }

      (newSettings as Record<string, unknown>)[key] = value;
    }

    const success = errors.length === 0;
    if (success) {
      this.settings = newSettings as GoSettings;
    }

    return { success, errors };
  }

  /** Reset all settings to defaults */
  reset(): void {
    this.settings = { ...DEFAULT_GO_SETTINGS };
  }

  /** Reset a single setting to default */
  resetKey<K extends keyof GoSettings>(key: K): void {
    const schemaEntry = GO_SETTINGS_SCHEMA.find((e) => e.key === key);
    if (schemaEntry) {
      this.settings = { ...this.settings, [key]: schemaEntry.default as GoSettings[K] };
    }
  }

  /** Validate all current settings */
  validateAll(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const entry of GO_SETTINGS_SCHEMA) {
      const value = this.settings[entry.key as keyof GoSettings];
      if (!entry.validate(value)) {
        errors.push(`Invalid value for setting ${entry.key}: ${value}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Get settings by category */
  getByCategory(
    category: 'game' | 'ai' | 'ui' | 'rules'
  ): Partial<GoSettings> {
    const entries = GO_SETTINGS_SCHEMA.filter((e) => e.category === category);
    const result: Partial<GoSettings> = {};

    for (const entry of entries) {
      (result as Record<string, unknown>)[entry.key] =
        this.settings[entry.key as keyof GoSettings];
    }

    return result;
  }

  /** Serialize settings to JSON string */
  serialize(): string {
    return JSON.stringify(this.settings, null, 2);
  }

  /** Deserialize settings from JSON string */
  deserialize(json: string): { success: boolean; errors: string[] } {
    try {
      const parsed = JSON.parse(json) as Partial<GoSettings>;
      return this.setMultiple(parsed);
    } catch {
      return { success: false, errors: ['Invalid JSON format'] };
    }
  }

  /** Get schema definition */
  getSchema(): SettingSchemaEntry[] {
    return [...GO_SETTINGS_SCHEMA];
  }

  /** Get schema entry for a key */
  getSchemaEntry(key: string): SettingSchemaEntry | undefined {
    return GO_SETTINGS_SCHEMA.find((e) => e.key === key);
  }

  /** Check if a setting exists */
  hasKey(key: string): boolean {
    return GO_SETTINGS_SCHEMA.some((e) => e.key === key);
  }

  /** Get default settings */
  static getDefaults(): GoSettings {
    return { ...DEFAULT_GO_SETTINGS };
  }

  /** Create from partial settings */
  static create(partial?: Partial<GoSettings>): GoSettingsManager {
    return new GoSettingsManager(partial);
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Merge partial settings with defaults
 */
export function mergeWithDefaults(
  partial?: Partial<GoSettings>
): GoSettings {
  return { ...DEFAULT_GO_SETTINGS, ...partial };
}

/**
 * Get difficulty presets for AI configuration
 */
export function getAIDifficultyPresets(): Record<
  string,
  AIDifficultyConfig
> {
  return {
    beginner: {
      name: 'Beginner',
      simulations: 0,
      useHeuristics: false,
      explorationConstant: 0,
      maxPlayoutDepth: 0,
    },
    elementary: {
      name: 'Elementary',
      simulations: 100,
      useHeuristics: false,
      explorationConstant: Math.sqrt(2),
      maxPlayoutDepth: 200,
    },
    intermediate: {
      name: 'Intermediate',
      simulations: 1000,
      useHeuristics: false,
      explorationConstant: Math.sqrt(2),
      maxPlayoutDepth: 200,
    },
    advanced: {
      name: 'Advanced',
      simulations: 5000,
      useHeuristics: true,
      explorationConstant: Math.sqrt(2),
      maxPlayoutDepth: 250,
    },
  };
}

/**
 * Create game options from settings
 */
export function createGameOptionsFromSettings(
  settings: GoSettings,
  overrides?: Partial<GoSettings>
): {
  boardSize: BoardSize;
  komi: number;
  handicap: number;
  aiDifficulty?: 'beginner' | 'elementary' | 'intermediate' | 'advanced';
} {
  const merged = { ...settings, ...overrides };
  return {
    boardSize: (merged.defaultBoardSize ?? 19) as BoardSize,
    komi: merged.defaultKomi ?? 7.5,
    handicap: merged.defaultHandicap ?? 0,
    aiDifficulty: merged.enableAI
      ? (merged.defaultAIDifficulty ?? 'intermediate')
      : undefined,
  };
}

// Re-export types
export type { GoSettings, AIDifficultyConfig } from './go.types';
