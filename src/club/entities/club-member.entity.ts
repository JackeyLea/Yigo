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

export enum ClubRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

@Entity('club_members')
export class ClubMember {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'varchar' })
  clubId: string;

  @Column({ type: 'int' })
  userId: number;

  @Column({
    type: 'enum',
    enum: ClubRole,
    default: ClubRole.MEMBER,
  })
  role: ClubRole;

  @Column({ type: 'int', default: 0 })
  activityScore: number;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt: Date;

  @CreateDateColumn()
  joinedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Club, (club) => club.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club: Club;
}
