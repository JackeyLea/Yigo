import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Club } from './club.entity';

export enum RoomStatus {
  WAITING = 'waiting',
  PLAYING = 'playing',
  CLOSED = 'closed',
}

@Entity('club_rooms')
export class ClubRoom {
  @PrimaryGeneratedColumn('uuid')
  roomId: string;

  @Column({ type: 'varchar' })
  clubId: string;

  @Column({ type: 'int' })
  creatorId: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  gameType: string;

  @Column({ type: 'int', default: 2 })
  maxPlayers: number;

  @Column({ type: 'int', default: 0 })
  currentPlayers: number;

  @Column({
    type: 'enum',
    enum: RoomStatus,
    default: RoomStatus.WAITING,
  })
  status: RoomStatus;

  @Column({ type: 'simple-json', nullable: true })
  config: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Club, (club) => club.rooms, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club: Club;
}
