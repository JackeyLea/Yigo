/**
 * RoomPlayer Entity - 房间玩家关联表
 * 维护房间与玩家的多对多关系，记录座位、准备状态与AI配置
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Room } from './room.entity';
import { User } from './user.entity';

export enum AIDifficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
  EXPERT = 'expert',
}

@Entity('room_players')
export class RoomPlayer {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  @Index()
  room_id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  user_id: string;

  @Column({ type: 'int', nullable: false })
  seat_index: number;

  @Column({ type: 'boolean', nullable: false, default: false })
  is_ready: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  is_host: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  is_ai: boolean;

  @Column({ type: 'varchar', length: 16, nullable: true })
  ai_difficulty: AIDifficulty | null;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  joined_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  left_at: Date | null;

  // Relations
  @ManyToOne(() => Room, (room) => room.room_players, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id', referencedColumnName: 'room_id' })
  room: Room;

  @ManyToOne(() => User, (user) => user.room_players, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user: User;
}
