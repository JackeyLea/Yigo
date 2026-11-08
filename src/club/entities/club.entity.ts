import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ClubMember } from './club-member.entity';
import { ClubRoom } from './club-room.entity';

@Entity('clubs')
export class Club {
  @PrimaryGeneratedColumn('uuid')
  clubId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatar: string;

  @Column({ type: 'int' })
  ownerId: number;

  @Column({ type: 'int', default: 1 })
  memberCount: number;

  @Column({ type: 'int', default: 100 })
  maxMembers: number;

  @Column({ type: 'int', default: 0 })
  activityScore: number;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ type: 'int', default: 0 })
  totalDonations: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ClubMember, (member) => member.club, { cascade: true })
  members: ClubMember[];

  @OneToMany(() => ClubRoom, (room) => room.club, { cascade: true })
  rooms: ClubRoom[];
}
