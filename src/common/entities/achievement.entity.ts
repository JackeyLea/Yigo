/**
 * Achievement Entity - 成就定义表
 * 存储成就的基本信息、解锁条件DSL与奖励配置，支持跨游戏复用
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { UserAchievement } from './user-achievement.entity';

export enum AchievementCategory {
  CROSS_GAME = 'cross_game',
  GAME_SPECIFIC = 'game_specific',
  EVENT = 'event',
}

@Entity('achievements')
export class Achievement {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  achievement_id: string;

  @Column({ type: 'varchar', length: 64, nullable: false })
  @Index({ unique: true })
  achievement_code: string;

  @Column({ type: 'varchar', length: 128, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: false })
  description: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  icon_url: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  game_type: string | null;

  @Column({ type: 'jsonb', nullable: false })
  unlock_condition_json: Record<string, any>;

  @Column({ type: 'jsonb', nullable: false })
  reward_json: Record<string, any>;

  @Column({
    type: 'enum',
    enum: AchievementCategory,
    nullable: false,
  })
  category: AchievementCategory;

  @Column({ type: 'boolean', nullable: false, default: false })
  is_hidden: boolean;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  // Relations
  @OneToMany(() => UserAchievement, (ua) => ua.achievement)
  user_achievements: UserAchievement[];
}
