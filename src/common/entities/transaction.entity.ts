/**
 * Transaction Entity - 资产流水表
 * 所有资产变更的不可变记录，保证账务可追溯与幂等性
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
import { User } from './user.entity';

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  FREEZE = 'freeze',
  UNFREEZE = 'unfreeze',
  GAME_SETTLE = 'game_settle',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  tx_id: string;

  @Column({ type: 'bigint', nullable: false })
  @Index()
  user_id: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
    nullable: false,
  })
  tx_type: TransactionType;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: false })
  amount: string;

  @Column({ type: 'varchar', length: 16, nullable: false })
  currency: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: false })
  balance_after: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reference_id: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  reference_type: string | null;

  @Column({ type: 'varchar', length: 64, nullable: false })
  @Index({ unique: true })
  idempotency_key: string;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'user_id' })
  user: User;
}
