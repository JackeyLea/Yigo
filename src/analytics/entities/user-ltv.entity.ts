import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('user_ltv')
export class UserLtv {
  @PrimaryColumn({ type: 'int' })
  userId: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalSpent: number;

  @Column({ type: 'int', default: 0 })
  purchaseCount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  avgPurchaseValue: number;

  @Column({ type: 'int', default: 0 })
  daysSinceFirstPurchase: number;

  @Column({ type: 'int', default: 0 })
  daysSinceLastPurchase: number;

  @Column({ type: 'timestamp', nullable: true })
  firstPurchaseAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastPurchaseAt: Date;

  @Column({ type: 'int', default: 0 })
  totalGamesPlayed: number;

  @Column({ type: 'int', default: 0 })
  totalSessions: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalSessionMinutes: number;

  @Column({ type: 'int', default: 0 })
  invitedUsers: number;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
