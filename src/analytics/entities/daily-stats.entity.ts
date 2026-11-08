import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('daily_stats')
export class DailyStats {
  @PrimaryColumn({ type: 'date' })
  date: Date;

  @Column({ type: 'int', default: 0 })
  dau: number;

  @Column({ type: 'int', default: 0 })
  newUsers: number;

  @Column({ type: 'int', default: 0 })
  totalUsers: number;

  @Column({ type: 'int', default: 0 })
  activeRooms: number;

  @Column({ type: 'int', default: 0 })
  gamesPlayed: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  avgSessionDuration: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  revenue: number;

  @Column({ type: 'int', default: 0 })
  purchaseCount: number;

  @Column({ type: 'int', default: 0 })
  paidUsers: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  retentionD1: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  retentionD7: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  topGame: string;

  @Column({ type: 'simple-json', nullable: true })
  hourlyDistribution: Record<string, number>;

  @Column({ type: 'simple-json', nullable: true })
  gameTypeDistribution: Record<string, number>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
