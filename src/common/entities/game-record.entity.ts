/**
 * GameRecord Entity - 对局记录表
 * 存储每局游戏的完整记录，支持回放与战绩统计
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Room } from './room.entity';

export enum GameRecordStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABORTED = 'aborted',
}

@Entity('game_records')
export class GameRecord {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  record_id: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  @Index()
  room_id: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  game_type: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  plugin_id: string;

  @Column({ type: 'timestamptz', nullable: false })
  start_time: Date;

  @Column({ type: 'timestamptz', nullable: true })
  end_time: Date | null;

  @Column({ type: 'jsonb', nullable: false })
  players_json: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  result_json: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  actions_json: Record<string, any> | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  replay_data_url: string | null;

  @Column({
    type: 'enum',
    enum: GameRecordStatus,
    nullable: false,
  })
  status: GameRecordStatus;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  // Relations
  @ManyToOne(() => Room, (room) => room.game_records, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id', referencedColumnName: 'room_id' })
  room: Room;
}
