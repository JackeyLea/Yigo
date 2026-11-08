import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CohortType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

@Entity('retention_cohorts')
@Index(['cohortDate', 'cohortType'])
@Index(['cohortType'])
export class RetentionCohort {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'date' })
  cohortDate: Date;

  @Column({
    type: 'enum',
    enum: CohortType,
    default: CohortType.DAILY,
  })
  cohortType: CohortType;

  @Column({ type: 'int', default: 0 })
  totalUsers: number;

  // Day 0 = 100% (same day return)
  @Column({ type: 'int', default: 0 })
  day0Active: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 100.0 })
  day0Rate: number;

  @Column({ type: 'int', default: 0 })
  day1Active: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  day1Rate: number;

  @Column({ type: 'int', default: 0 })
  day3Active: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  day3Rate: number;

  @Column({ type: 'int', default: 0 })
  day7Active: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  day7Rate: number;

  @Column({ type: 'int', default: 0 })
  day14Active: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  day14Rate: number;

  @Column({ type: 'int', default: 0 })
  day30Active: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  day30Rate: number;

  @Column({ type: 'boolean', default: false })
  isComplete: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
