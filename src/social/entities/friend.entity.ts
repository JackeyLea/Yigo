/**
 * Friend Entity - 好友关系表 (social_friends)
 * 存储用户之间的好友关系及状态
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FriendStatus {
  PENDING = 'pending',   // 待确认
  ACCEPTED = 'accepted', // 已接受
  BLOCKED = 'blocked',   // 已拉黑
}

@Entity('social_friends')
@Index(['user_id', 'friend_id'], { unique: true })
export class Friend {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', nullable: false })
  user_id: string;

  @Column({ type: 'bigint', nullable: false })
  friend_id: string;

  @Column({
    type: 'enum',
    enum: FriendStatus,
    nullable: false,
    default: FriendStatus.PENDING,
  })
  status: FriendStatus;

  // 请求方向：user_id 是请求发送方，friend_id 是接收方
  @Column({ type: 'bigint', nullable: true })
  requester_id: string | null;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', nullable: false })
  updated_at: Date;
}
