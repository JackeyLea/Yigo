/**
 * CollectedGame - 收藏对局实体
 *
 * 存储用户收藏的对局记录
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('collected_games')
@Index(['user_id', 'created_at'])
@Index(['record_id'])
@Index(['game_type'])
@Unique(['user_id', 'record_id'])
export class CollectedGame {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '用户ID' })
  user_id: string;

  @Column({ type: 'int', comment: '对局记录ID' })
  record_id: number;

  @Column({ type: 'varchar', length: 64, comment: '游戏类型' })
  game_type: string;

  @Column({ type: 'varchar', length: 256, nullable: true, comment: '自定义备注' })
  note: string | null;

  @Column({ type: 'simple-json', nullable: true, comment: '标签列表' })
  tags: string[] | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '分享token' })
  share_token: string | null;

  @Column({ type: 'int', default: 0, comment: '查看次数' })
  view_count: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
