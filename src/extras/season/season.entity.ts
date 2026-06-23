import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum SeasonStatus {
  UPCOMING = 'upcoming',
  ACTIVE = 'active',
  ENDED = 'ended',
}

@Entity('seasons')
export class Season {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  gameType: string;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({
    type: 'enum',
    enum: SeasonStatus,
    default: SeasonStatus.UPCOMING,
  })
  @Index()
  status: SeasonStatus;

  @Column({ type: 'simple-json', nullable: true })
  rewardsConfig: SeasonRewardsConfig;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export interface SeasonRewardsConfig {
  ranks: {
    minRank: number;
    maxRank: number;
    title: string;
    gold: number;
    avatarFrame?: string;
  }[];
  participation: {
    title: string;
    gold: number;
  };
}

@Entity('season_rewards')
export class SeasonReward {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  @Index()
  seasonId: string;

  @Column({ type: 'int' })
  @Index()
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  rewardName: string;

  @Column({ type: 'varchar', length: 50 })
  rewardType: string;

  @Column({ type: 'simple-json', nullable: true })
  rewardData: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isClaimed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('season_rankings')
export class SeasonRanking {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  @Index()
  seasonId: string;

  @Column({ type: 'int' })
  @Index()
  userId: number;

  @Column({ type: 'int', default: 0 })
  score: number;

  @Column({ type: 'int', default: 0 })
  wins: number;

  @Column({ type: 'int', default: 0 })
  losses: number;

  @Column({ type: 'int', default: 0 })
  draws: number;

  @Column({ type: 'int', default: 0 })
  rank: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
