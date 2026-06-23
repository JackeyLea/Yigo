/**
 * Plugin Seeder
 * 种子数据：内置7款棋牌游戏插件的注册信息
 * 按需求文档1.3.2节定义的游戏类型全景清单
 */
import { MigrationInterface, QueryRunner } from 'typeorm';
import { PluginCategory } from '../../src/common/entities';

export interface PluginSeedData {
  plugin_id: string;
  name: string;
  version: string;
  game_type: string;
  category: PluginCategory;
  min_players: number;
  max_players: number;
  entry_class: string;
  dll_path: string | null;
  is_enabled: boolean;
  meta_json: Record<string, any>;
}

const PLUGIN_SEEDS: PluginSeedData[] = [
  // === 棋类游戏（完全信息博弈）===
  {
    plugin_id: 'gomoku',
    name: '五子棋',
    version: '1.0.0',
    game_type: 'gomoku',
    category: PluginCategory.BOARD,
    min_players: 2,
    max_players: 2,
    entry_class: 'GomokuPlugin',
    dll_path: '/plugins/gomoku/gomoku-plugin.so',
    is_enabled: true,
    meta_json: {
      description: '经典五子连珠棋类游戏，支持双人对弈及观战',
      supported_board_sizes: [15, 19],
      default_board_size: 15,
      allow_spectator: true,
      currencies: ['coin'],
      supported_modes: ['normal', 'ranked'],
      settings_schema: {
        board_size: { type: 'select', options: [15, 19], default: 15, label: '棋盘大小' },
        time_limit: { type: 'slider', min: 30, max: 300, default: 120, label: '每步限时(秒)' },
        allow_renju: { type: 'switch', default: false, label: '启用禁手规则' },
      },
    },
  },
  {
    plugin_id: 'reversi',
    name: '黑白棋',
    version: '1.0.0',
    game_type: 'reversi',
    category: PluginCategory.BOARD,
    min_players: 2,
    max_players: 2,
    entry_class: 'ReversiPlugin',
    dll_path: '/plugins/reversi/reversi-plugin.so',
    is_enabled: true,
    meta_json: {
      description: '通过翻转对方棋子占领棋盘的策略棋类游戏',
      supported_board_sizes: [8],
      default_board_size: 8,
      allow_spectator: true,
      currencies: ['coin'],
      supported_modes: ['normal', 'ranked'],
      settings_schema: {
        time_limit: { type: 'slider', min: 30, max: 300, default: 120, label: '每步限时(秒)' },
      },
    },
  },
  {
    plugin_id: 'go',
    name: '围棋',
    version: '1.0.0',
    game_type: 'go',
    category: PluginCategory.BOARD,
    min_players: 2,
    max_players: 2,
    entry_class: 'GoPlugin',
    dll_path: '/plugins/go/go-plugin.so',
    is_enabled: true,
    meta_json: {
      description: '围棋对弈，支持中国规则、日本规则、韩国规则三种计法',
      supported_board_sizes: [9, 13, 19],
      default_board_size: 19,
      supported_rules: ['chinese', 'japanese', 'korean'],
      allow_spectator: true,
      currencies: ['coin'],
      supported_modes: ['normal', 'ranked'],
      settings_schema: {
        board_size: { type: 'select', options: [9, 13, 19], default: 19, label: '棋盘大小' },
        ruleset: { type: 'select', options: ['chinese', 'japanese', 'korean'], default: 'chinese', label: '计分规则' },
        komi: { type: 'slider', min: 0, max: 10, step: 0.5, default: 7.5, label: '贴目' },
        time_limit: { type: 'slider', min: 60, max: 1800, default: 600, label: '每步限时(秒)' },
      },
    },
  },
  {
    plugin_id: 'xiangqi',
    name: '象棋',
    version: '1.0.0',
    game_type: 'xiangqi',
    category: PluginCategory.BOARD,
    min_players: 2,
    max_players: 2,
    entry_class: 'XiangqiPlugin',
    dll_path: '/plugins/xiangqi/xiangqi-plugin.so',
    is_enabled: true,
    meta_json: {
      description: '中国象棋对弈，支持标准规则及让子、限时等变体',
      allow_spectator: true,
      currencies: ['coin'],
      supported_modes: ['normal', 'ranked'],
      settings_schema: {
        time_limit: { type: 'slider', min: 60, max: 1800, default: 600, label: '每步限时(秒)' },
        handicap: { type: 'select', options: ['none', 'one_horse', 'two_horse'], default: 'none', label: '让子' },
      },
    },
  },
  // === 牌类游戏（非完全信息博弈）===
  {
    plugin_id: 'doudizhu',
    name: '斗地主',
    version: '1.0.0',
    game_type: 'doudizhu',
    category: PluginCategory.CARD,
    min_players: 3,
    max_players: 3,
    entry_class: 'DouDizhuPlugin',
    dll_path: '/plugins/doudizhu/doudizhu-plugin.so',
    is_enabled: true,
    meta_json: {
      description: '经典三人斗地主，包含叫牌、出牌、抢地主等核心机制',
      allow_spectator: true,
      currencies: ['coin'],
      supported_modes: ['normal', 'ranked'],
      settings_schema: {
        base_score: { type: 'select', options: [100, 500, 1000], default: 100, label: '底分' },
        time_limit: { type: 'slider', min: 10, max: 60, default: 30, label: '出牌限时(秒)' },
      },
    },
  },
  {
    plugin_id: 'texas_holdem',
    name: '德州扑克',
    version: '1.0.0',
    game_type: 'texas_holdem',
    category: PluginCategory.CARD,
    min_players: 2,
    max_players: 9,
    entry_class: 'TexasHoldemPlugin',
    dll_path: '/plugins/texas_holdem/texas-holdem-plugin.so',
    is_enabled: true,
    meta_json: {
      description: '德州扑克，支持2至9人，包含四轮下注及摊牌比牌',
      allow_spectator: true,
      currencies: ['coin', 'chip'],
      supported_modes: ['normal', 'ranked', 'tournament'],
      settings_schema: {
        max_players: { type: 'select', options: [2, 6, 9], default: 9, label: '最大人数' },
        small_blind: { type: 'select', options: [10, 50, 100], default: 10, label: '小盲注' },
        big_blind: { type: 'select', options: [20, 100, 200], default: 20, label: '大盲注' },
        buy_in: { type: 'select', options: [1000, 5000, 10000], default: 1000, label: '买入金额' },
        time_limit: { type: 'slider', min: 10, max: 60, default: 30, label: '决策限时(秒)' },
      },
    },
  },
  // === 麻将类游戏 ===
  {
    plugin_id: 'mahjong',
    name: '标准麻将',
    version: '1.0.0',
    game_type: 'mahjong',
    category: PluginCategory.MAHJONG,
    min_players: 4,
    max_players: 4,
    entry_class: 'MahjongPlugin',
    dll_path: '/plugins/mahjong/mahjong-plugin.so',
    is_enabled: true,
    meta_json: {
      description: '标准四人麻将，支持多种地方规则变体',
      allow_spectator: true,
      currencies: ['coin', 'happy_bean'],
      supported_modes: ['normal', 'ranked'],
      settings_schema: {
        rule_set: { type: 'select', options: ['standard', 'sichuan', 'guangdong'], default: 'standard', label: '规则' },
        base_score: { type: 'select', options: [1, 5, 10], default: 1, label: '底分' },
        time_limit: { type: 'slider', min: 10, max: 60, default: 20, label: '出牌限时(秒)' },
      },
    },
  },
];

export class SeedPlugins implements MigrationInterface {
  name = 'SeedPlugins';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = new Date();

    for (const plugin of PLUGIN_SEEDS) {
      await queryRunner.query(
        `INSERT INTO plugins (
          plugin_id, name, version, game_type, category,
          min_players, max_players, entry_class, dll_path,
          is_enabled, meta_json, installed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (plugin_id) DO NOTHING`,
        [
          plugin.plugin_id,
          plugin.name,
          plugin.version,
          plugin.game_type,
          plugin.category,
          plugin.min_players,
          plugin.max_players,
          plugin.entry_class,
          plugin.dll_path,
          plugin.is_enabled,
          JSON.stringify(plugin.meta_json),
          now,
        ],
      );
    }

    console.log(`[Seeder] Inserted ${PLUGIN_SEEDS.length} plugins.`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const pluginIds = PLUGIN_SEEDS.map((p) => p.plugin_id);
    await queryRunner.query(
      `DELETE FROM plugins WHERE plugin_id = ANY($1)`,
      [pluginIds],
    );
    console.log(`[Seeder] Removed ${PLUGIN_SEEDS.length} plugins.`);
  }
}
