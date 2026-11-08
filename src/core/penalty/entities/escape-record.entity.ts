/**
 * EscapeRecord - 逃跑记录实体
 *
 * 存储在PostgreSQL中用于持久化逃跑记录
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('escape_records')
@Index(['user_id', 'created_at'])
@Index(['room_id'])
export class EscapeRecord {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '用户ID' })
  user_id: string;

  @Column({ type: 'varchar', length: 32, comment: '房间ID' })
  room_id: string;

  @Column({ type: 'varchar', length: 64, comment: '游戏类型' })
  game_type: string;

  @Column({ type: 'int', default: 0, comment: '逃跑时扣分' })
  score_deducted: number;

  @Column({ type: 'varchar', length: 20, default: 'active', comment: '记录状态' })
  status: string; // active | forgiven | appealed

  @Column({ type: 'text', nullable: true, comment: '备注' })
  note: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
