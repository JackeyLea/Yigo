/**
 * Room Entity - 房间表
 * 管理游戏房间的生命周期、配置与状态快照
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { User } from './user.entity';
import { RoomPlayer } from './room-player.entity';
import { GameRecord } from './game-record.entity';

export enum RoomStatus {
  WAITING = 'waiting',
  PLAYING = 'playing',
  PAUSED = 'paused',
  FINISHED = 'finished',
}

export enum RoomMode {
  NORMAL = 'normal',
  RANKED = 'ranked',
  TOURNAMENT = 'tournament',
  CUSTOM = 'custom',
}

@Entity('rooms')
export class Room {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  room_id: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  game_type: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  plugin_id: string;

  @Column({
    type: 'enum',
    enum: RoomStatus,
    nullable: false,
    default: RoomStatus.WAITING,
  })
  status: RoomStatus;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  host_id: string;

  @Column({ type: 'int', nullable: false })
  max_players: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  current_players: number;

  @Column({ type: 'jsonb', nullable: false, default: {} })
  config_json: Record<string, any>;

  @Column({ type: 'varchar', length: 32, nullable: false, default: RoomMode.NORMAL })
  mode: RoomMode;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  password_hash: string | null;

  @Column({ type: 'boolean', nullable: false, default: true })
  is_spectator_allowed: boolean;

  @Column({ type: 'int', nullable: false, default: 0 })
  spectator_count: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  current_round: number;

  @Column({ type: 'jsonb', nullable: true })
  state_json: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updated_at: Date;

  @Column({ type: 'timestamptz', nullable: false })
  expired_at: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.hosted_rooms, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_id', referencedColumnName: 'user_id' })
  host: User;

  @OneToMany(() => RoomPlayer, (roomPlayer) => roomPlayer.room)
  room_players: RoomPlayer[];

  @OneToMany(() => GameRecord, (record) => record.room)
  game_records: GameRecord[];
}
