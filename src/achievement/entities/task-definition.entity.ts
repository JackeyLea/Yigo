/**
 * TaskDefinition Entity - 任务定义表
 * 存储任务的基本信息、完成条件与奖励配置
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { UserTaskProgress } from './user-task-progress.entity';

export enum TaskType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

@Entity('task_definitions')
export class TaskDefinition {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  task_id: string;

  @Column({ type: 'varchar', length: 64, nullable: false })
  @Index({ unique: true })
  task_code: string;

  @Column({ type: 'varchar', length: 128, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: false })
  description: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  icon_url: string | null;

  @Column({
    type: 'enum',
    enum: TaskType,
    nullable: false,
  })
  task_type: TaskType;

  @Column({ type: 'jsonb', nullable: false })
  requirement_json: Record<string, any>;

  @Column({ type: 'jsonb', nullable: false })
  reward_json: Record<string, any>;

  @Column({ type: 'int', nullable: false, default: 1 })
  sort_order: number;

  @Column({ type: 'boolean', nullable: false, default: true })
  is_enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  // Relations
  @OneToMany(() => UserTaskProgress, (utp) => utp.task_definition)
  user_task_progresses: UserTaskProgress[];
}
