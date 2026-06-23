/**
 * Report Entity - 举报表 (social_reports)
 * 存储用户举报信息及处理状态
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ReportStatus {
  PENDING = 'pending',     // 待处理
  PROCESSING = 'processing', // 处理中
  RESOLVED = 'resolved',   // 已解决
  REJECTED = 'rejected',   // 已驳回
}

export enum ReportType {
  CHEATING = 'cheating',       // 作弊
  HARASSMENT = 'harassment',   // 骚扰
  ABUSE = 'abuse',             // 辱骂
  SPAM = 'spam',               // 垃圾信息
  OTHER = 'other',             // 其他
}

export enum ReportAction {
  WARN = 'warn',           // 警告
  MUTE = 'mute',           // 禁言
  BAN = 'ban',             // 封号
  DISMISS = 'dismiss',     // 驳回
}

@Entity('social_reports')
@Index(['status'])
@Index(['target_id'])
export class Report {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  report_id: string;

  @Column({ type: 'bigint', nullable: false })
  reporter_id: string;

  @Column({ type: 'bigint', nullable: false })
  target_id: string;

  @Column({
    type: 'enum',
    enum: ReportType,
    nullable: false,
  })
  type: ReportType;

  @Column({ type: 'text', nullable: false })
  reason: string;

  // 证据JSON（截图、聊天记录等URL列表）
  @Column({ type: 'text', nullable: true })
  evidence: string | null;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    nullable: false,
    default: ReportStatus.PENDING,
  })
  status: ReportStatus;

  // 处理结果
  @Column({
    type: 'enum',
    enum: ReportAction,
    nullable: true,
  })
  action: ReportAction | null;

  // 处理备注
  @Column({ type: 'text', nullable: true })
  note: string | null;

  // 处理人ID
  @Column({ type: 'bigint', nullable: true })
  processor_id: string | null;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updated_at: Date;
}
