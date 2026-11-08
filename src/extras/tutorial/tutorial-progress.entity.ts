/**
 * TutorialProgress Entity - 新手引导进度表
 * 记录每个用户完成的新手引导步骤
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tutorial_progress')
export class TutorialProgress {
  @PrimaryColumn({ type: 'int' })
  user_id: number;

  @Column({ type: 'jsonb', default: [] })
  completed_steps: string[];

  @Column({ type: 'boolean', default: false })
  is_completed: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
