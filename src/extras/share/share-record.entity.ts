/**
 * ShareRecord Entity - 分享记录表
 * 记录用户生成的分享卡片及点击追踪信息
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('share_records')
export class ShareRecord {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  share_id: string;

  @Column({ type: 'bigint' })
  @Index()
  user_id: number;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'jsonb' })
  data: Record<string, any>;

  @Column({ type: 'int', default: 0 })
  click_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_clicked_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
