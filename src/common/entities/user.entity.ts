/**
 * User Entity - 用户表
 * 存储平台用户的基础信息、等级与状态
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  OneToMany,
  Unique,
} from 'typeorm';
import { Room } from './room.entity';
import { RoomPlayer } from './room-player.entity';
import { LeaderboardEntry } from './leaderboard-entry.entity';
import { UserAchievement } from './user-achievement.entity';
import { Transaction } from './transaction.entity';
import { Wallet } from './wallet.entity';

export enum UserStatus {
  ACTIVE = 'active',
  BANNED = 'banned',
  INACTIVE = 'inactive',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  user_id: string;

  @Column({ type: 'varchar', length: 32, nullable: false })
  @Index({ unique: true })
  username: string;

  @Column({ type: 'varchar', length: 255, nullable: false, select: false })
  password_hash: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index({ unique: true })
  email: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  @Index({ unique: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar_url: string | null;

  @Column({ type: 'varchar', length: 32, nullable: false, default: 'Player' })
  nickname: string;

  @Column({ type: 'int', nullable: false, default: 1 })
  level: number;

  @Column({ type: 'bigint', nullable: false, default: 0 })
  xp: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    nullable: false,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;

  // Relations
  @OneToMany(() => Room, (room) => room.host)
  hosted_rooms: Room[];

  @OneToMany(() => RoomPlayer, (roomPlayer) => roomPlayer.user)
  room_players: RoomPlayer[];

  @OneToMany(() => LeaderboardEntry, (entry) => entry.user)
  leaderboard_entries: LeaderboardEntry[];

  @OneToMany(() => UserAchievement, (ua) => ua.user)
  user_achievements: UserAchievement[];

  @OneToMany(() => Transaction, (tx) => tx.user)
  transactions: Transaction[];

  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets: Wallet[];
}
