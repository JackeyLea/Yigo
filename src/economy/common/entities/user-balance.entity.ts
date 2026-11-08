import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('user_balances')
@Index(['userId'], { unique: true })
export class UserBalance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  userId: number;

  @Column({ type: 'bigint', default: 0 })
  coins: number;

  @Column({ type: 'bigint', default: 0 })
  totalEarned: number;

  @Column({ type: 'bigint', default: 0 })
  totalSpent: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
