/**
 * Achievement Seeder
 * 种子数据：框架内置成就定义，包含跨游戏成就与游戏专属成就
 */
import { MigrationInterface, QueryRunner } from 'typeorm';
import { AchievementCategory } from '../../src/common/entities';

export interface AchievementSeedData {
  achievement_code: string;
  name: string;
  description: string;
  icon_url: string | null;
  game_type: string | null;
  unlock_condition_json: Record<string, any>;
  reward_json: Record<string, any>;
  category: AchievementCategory;
  is_hidden: boolean;
}

const ACHIEVEMENT_SEEDS: AchievementSeedData[] = [
  // === 跨游戏成就 (cross_game) ===
  {
    achievement_code: 'first_victory',
    name: '初出茅庐',
    description: '在任意游戏中取得第一次胜利',
    icon_url: '/assets/achievements/first_victory.png',
    game_type: null,
    unlock_condition_json: {
      type: 'game_won',
      count: 1,
      filter: { any_game: true },
    },
    reward_json: { coins: 100, xp: 50 },
    category: AchievementCategory.CROSS_GAME,
    is_hidden: false,
  },
  {
    achievement_code: 'ten_victories',
    name: '十连胜手',
    description: '在任意游戏中累计取得10场胜利',
    icon_url: '/assets/achievements/ten_victories.png',
    game_type: null,
    unlock_condition_json: {
      type: 'game_won',
      count: 10,
      filter: { any_game: true },
    },
    reward_json: { coins: 500, xp: 200 },
    category: AchievementCategory.CROSS_GAME,
    is_hidden: false,
  },
  {
    achievement_code: 'hundred_games',
    name: '百战老兵',
    description: '累计完成对局100场（任意游戏）',
    icon_url: '/assets/achievements/hundred_games.png',
    game_type: null,
    unlock_condition_json: {
      type: 'games_played',
      count: 100,
      filter: { any_game: true },
    },
    reward_json: { coins: 2000, xp: 500, title: '百战老兵' },
    category: AchievementCategory.CROSS_GAME,
    is_hidden: false,
  },
  {
    achievement_code: 'jack_of_all_trades',
    name: '全能王',
    description: '体验5款不同的游戏',
    icon_url: '/assets/achievements/jack_of_all_trades.png',
    game_type: null,
    unlock_condition_json: {
      type: 'unique_games_played',
      count: 5,
    },
    reward_json: { coins: 5000, xp: 1000, title: '全能王' },
    category: AchievementCategory.CROSS_GAME,
    is_hidden: false,
  },
  {
    achievement_code: 'social_butterfly',
    name: '社交达人',
    description: '添加10位好友',
    icon_url: '/assets/achievements/social_butterfly.png',
    game_type: null,
    unlock_condition_json: {
      type: 'friends_added',
      count: 10,
    },
    reward_json: { coins: 300, xp: 100 },
    category: AchievementCategory.CROSS_GAME,
    is_hidden: false,
  },
  {
    achievement_code: 'winning_streak_5',
    name: '势不可挡',
    description: '在任意游戏中取得5连胜',
    icon_url: '/assets/achievements/winning_streak_5.png',
    game_type: null,
    unlock_condition_json: {
      type: 'winning_streak',
      count: 5,
      filter: { any_game: true },
    },
    reward_json: { coins: 1000, xp: 300 },
    category: AchievementCategory.CROSS_GAME,
    is_hidden: false,
  },
  {
    achievement_code: 'legendary_streak',
    name: '传说连胜',
    description: '在任意游戏中取得10连胜（隐藏成就）',
    icon_url: '/assets/achievements/legendary_streak.png',
    game_type: null,
    unlock_condition_json: {
      type: 'winning_streak',
      count: 10,
      filter: { any_game: true },
    },
    reward_json: { coins: 10000, xp: 2000, title: '传说' },
    category: AchievementCategory.CROSS_GAME,
    is_hidden: true,
  },
  // === 棋类游戏专属成就 ===
  {
    achievement_code: 'gomoku_master',
    name: '五子棋大师',
    description: '在五子棋中取得50场胜利',
    icon_url: '/assets/achievements/gomoku_master.png',
    game_type: 'gomoku',
    unlock_condition_json: {
      type: 'game_won',
      count: 50,
      filter: { game_type: 'gomoku' },
    },
    reward_json: { coins: 2000, xp: 500, title: '五子棋大师' },
    category: AchievementCategory.GAME_SPECIFIC,
    is_hidden: false,
  },
  {
    achievement_code: 'go_master',
    name: '围棋宗师',
    description: '在围棋中取得50场胜利',
    icon_url: '/assets/achievements/go_master.png',
    game_type: 'go',
    unlock_condition_json: {
      type: 'game_won',
      count: 50,
      filter: { game_type: 'go' },
    },
    reward_json: { coins: 2000, xp: 500, title: '围棋宗师' },
    category: AchievementCategory.GAME_SPECIFIC,
    is_hidden: false,
  },
  {
    achievement_code: 'xiangqi_master',
    name: '象棋国手',
    description: '在象棋中取得50场胜利',
    icon_url: '/assets/achievements/xiangqi_master.png',
    game_type: 'xiangqi',
    unlock_condition_json: {
      type: 'game_won',
      count: 50,
      filter: { game_type: 'xiangqi' },
    },
    reward_json: { coins: 2000, xp: 500, title: '象棋国手' },
    category: AchievementCategory.GAME_SPECIFIC,
    is_hidden: false,
  },
  // === 牌类游戏专属成就 ===
  {
    achievement_code: 'texas_shark',
    name: '德州鲨鱼',
    description: '在德州扑克中取得50场胜利',
    icon_url: '/assets/achievements/texas_shark.png',
    game_type: 'texas_holdem',
    unlock_condition_json: {
      type: 'game_won',
      count: 50,
      filter: { game_type: 'texas_holdem' },
    },
    reward_json: { coins: 3000, xp: 600, title: '德州鲨鱼' },
    category: AchievementCategory.GAME_SPECIFIC,
    is_hidden: false,
  },
  {
    achievement_code: 'doudizhu_master',
    name: '斗地主之王',
    description: '在斗地主中取得50场胜利',
    icon_url: '/assets/achievements/doudizhu_master.png',
    game_type: 'doudizhu',
    unlock_condition_json: {
      type: 'game_won',
      count: 50,
      filter: { game_type: 'doudizhu' },
    },
    reward_json: { coins: 2000, xp: 500, title: '斗地主之王' },
    category: AchievementCategory.GAME_SPECIFIC,
    is_hidden: false,
  },
  // === 麻将专属成就 ===
  {
    achievement_code: 'mahjong_master',
    name: '雀圣',
    description: '在麻将中取得50场胜利',
    icon_url: '/assets/achievements/mahjong_master.png',
    game_type: 'mahjong',
    unlock_condition_json: {
      type: 'game_won',
      count: 50,
      filter: { game_type: 'mahjong' },
    },
    reward_json: { coins: 2000, xp: 500, title: '雀圣' },
    category: AchievementCategory.GAME_SPECIFIC,
    is_hidden: false,
  },
  // === 活动成就 ===
  {
    achievement_code: 'weekend_warrior',
    name: '周末战士',
    description: '在周末期间完成对局10场（活动限定）',
    icon_url: '/assets/achievements/weekend_warrior.png',
    game_type: null,
    unlock_condition_json: {
      type: 'games_played',
      count: 10,
      filter: { day_of_week: [6, 7] },
    },
    reward_json: { coins: 1000, xp: 300, item: 'weekend_avatar_frame' },
    category: AchievementCategory.EVENT,
    is_hidden: false,
  },
];

export class SeedAchievements implements MigrationInterface {
  name = 'SeedAchievements';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const ach of ACHIEVEMENT_SEEDS) {
      await queryRunner.query(
        `INSERT INTO achievements (
          achievement_code, name, description, icon_url,
          game_type, unlock_condition_json, reward_json,
          category, is_hidden
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (achievement_code) DO NOTHING`,
        [
          ach.achievement_code,
          ach.name,
          ach.description,
          ach.icon_url,
          ach.game_type,
          JSON.stringify(ach.unlock_condition_json),
          JSON.stringify(ach.reward_json),
          ach.category,
          ach.is_hidden,
        ],
      );
    }

    console.log(`[Seeder] Inserted ${ACHIEVEMENT_SEEDS.length} achievements.`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = ACHIEVEMENT_SEEDS.map((a) => a.achievement_code);
    await queryRunner.query(
      `DELETE FROM achievements WHERE achievement_code = ANY($1)`,
      [codes],
    );
    console.log(`[Seeder] Removed ${ACHIEVEMENT_SEEDS.length} achievements.`);
  }
}
