import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum PushStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  DELIVERED = 'delivered',
}

export enum PushType {
  UNICAST = 'unicast',
  BROADCAST = 'broadcast',
  ROOM_INVITE = 'room_invite',
  GAME_REMINDER = 'game_reminder',
  ACTIVITY = 'activity',
}

@Entity('push_logs')
@Index(['userId', 'createdAt'])
@Index(['status'])
export class PushLog {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'int', nullable: true })
  userId: number;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'simple-json', nullable: true })
  data: Record<string, any>;

  @Column({
    type: 'enum',
    enum: PushStatus,
    default: PushStatus.PENDING,
  })
  status: PushStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
