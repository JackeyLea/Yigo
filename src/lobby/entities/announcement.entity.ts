/**
 * Announcement Entity - 公告表
 * 存储大厅公告、轮播图和活动信息
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('announcements')
export class Announcement {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  content: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  image_url: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  link_url: string | null;

  @Column({ type: 'timestamptz', nullable: false })
  start_time: Date;

  @Column({ type: 'timestamptz', nullable: false })
  end_time: Date;

  @Column({ type: 'int', nullable: false, default: 0 })
  priority: number;

  @Column({ type: 'boolean', nullable: false, default: true })
  is_enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updated_at: Date;
}
