import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum EventType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  GAME_START = 'game_start',
  GAME_END = 'game_end',
  PURCHASE = 'purchase',
  SHARE = 'share',
  INVITE = 'invite',
  REGISTER = 'register',
  ROOM_JOIN = 'room_join',
  ROOM_LEAVE = 'room_leave',
  CLUB_JOIN = 'club_join',
  CLUB_DONATE = 'club_donate',
  PUSH_OPEN = 'push_open',
  TUTORIAL_COMPLETE = 'tutorial_complete',
}

@Entity('analytics_events')
@Index(['userId', 'eventType', 'createdAt'])
@Index(['eventType', 'createdAt'])
@Index(['createdAt'])
export class AnalyticsEvent {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({
    type: 'enum',
    enum: EventType,
  })
  eventType: EventType;

  @Column({ type: 'simple-json', nullable: true })
  eventData: Record<string, any>;

  @Column({ type: 'varchar', length: 50, nullable: true })
  gameType: string;

  @Column({ type: 'int', nullable: true })
  sessionId: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ipAddress: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
