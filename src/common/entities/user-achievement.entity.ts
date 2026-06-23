/**
 * UserAchievement Entity - 用户成就进度表
 * 记录每个用户对每个成就的解锁进度与领取状态
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Achievement } from './achievement.entity';

@Entity('user_achievements')
@Unique(['user_id', 'achievement_id'])
export class UserAchievement {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  user_id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  achievement_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  unlocked_at: Date | null;

  @Column({ type: 'jsonb', nullable: false, default: {} })
  progress_json: Record<string, any>;

  @Column({ type: 'boolean', nullable: false, default: false })
  is_claimed: boolean;

  // Relations
  @ManyToOne(() => User, (user) => user.user_achievements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user: User;

  @ManyToOne(() => Achievement, (achievement) => achievement.user_achievements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'achievement_id', referencedColumnName: 'achievement_id' })
  achievement: Achievement;
}
