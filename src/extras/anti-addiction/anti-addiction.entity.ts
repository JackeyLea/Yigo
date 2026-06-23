import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 实名认证信息
 */
@Entity('real_name_verifications')
export class RealNameVerification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  userId: number;

  @Column({ type: 'varchar', length: 50 })
  realName: string;

  @Column({ type: 'varchar', length: 18, unique: true })
  idCard: string;

  @Column({ type: 'date' })
  birthDate: Date;

  @Column({ type: 'boolean', default: false })
  isAdult: boolean;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 每日游戏时长记录
 */
@Entity('daily_play_time')
export class DailyPlayTime {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  @Index()
  userId: number;

  @Column({ type: 'date' })
  @Index()
  date: string;

  @Column({ type: 'int', default: 0 })
  totalMinutes: number;

  @Column({ type: 'timestamp', nullable: true })
  lastSessionStart: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSessionEnd: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 节假日配置
 */
@Entity('holiday_config')
export class HolidayConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date', unique: true })
  holidayDate: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'boolean', default: true })
  isPlayable: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
