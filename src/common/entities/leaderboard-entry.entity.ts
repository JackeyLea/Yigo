/**
 * LeaderboardEntry Entity - 排行榜条目表
 * 按游戏类型与赛季维度存储玩家的ELO评分与战绩统计
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('leaderboard_entries')
@Unique(['game_type', 'season_id', 'user_id'])
@Index(['game_type', 'season_id', 'rating_score'])
export class LeaderboardEntry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  entry_id: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  game_type: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  plugin_id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  user_id: string;

  @Column({ type: 'varchar', length: 32, nullable: false, default: 'all_time' })
  season_id: string;

  @Column({ type: 'int', nullable: false, default: 1000 })
  rating_score: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  games_played: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  games_won: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  games_drawn: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  games_lost: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  best_streak: number;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updated_at: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.leaderboard_entries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user: User;
}
