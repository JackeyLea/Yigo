/**
 * Wallet Entity - 用户钱包表
 * 多币种资产账户，每用户每币种唯一，支持余额与冻结金额管理
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('wallets')
@Unique(['user_id', 'currency'])
export class Wallet {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  wallet_id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  user_id: string;

  @Column({ type: 'varchar', length: 16, nullable: false })
  currency: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: false, default: 0 })
  balance: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: false, default: 0 })
  frozen: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: false, default: 0 })
  total_deposited: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: false, default: 0 })
  total_withdrawn: string;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updated_at: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.wallets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user: User;
}
