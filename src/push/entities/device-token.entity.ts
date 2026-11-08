import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum Platform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

@Entity('user_devices')
@Index(['userId', 'platform'])
@Index(['deviceToken'], { unique: true })
export class DeviceToken {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'varchar', length: 512 })
  deviceToken: string;

  @Column({
    type: 'enum',
    enum: Platform,
    default: Platform.IOS,
  })
  platform: Platform;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceModel: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  osVersion: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  appVersion: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
