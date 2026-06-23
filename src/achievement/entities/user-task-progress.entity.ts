/**
 * UserTaskProgress Entity - 用户任务进度表
 * 记录每个用户对每个任务的完成进度与领取状态
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
} from 'typeorm';
import { TaskDefinition } from './task-definition.entity';

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CLAIMED = 'claimed',
}

@Entity('user_task_progresses')
@Unique(['user_id', 'task_id', 'cycle_start'])
export class UserTaskProgress {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  user_id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  task_id: string;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    nullable: false,
    default: TaskStatus.PENDING,
  })
  status: TaskStatus;

  @Column({ type: 'jsonb', nullable: false, default: {} })
  progress_json: Record<string, any>;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  claimed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: false })
  cycle_start: Date;

  @Column({ type: 'timestamptz', nullable: false })
  cycle_end: Date;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  // Relations
  @ManyToOne(() => TaskDefinition, (td) => td.user_task_progresses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'task_id' })
  task_definition: TaskDefinition;
}
