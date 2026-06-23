/**
 * ChatMessage Entity - 聊天消息表 (social_chat_messages)
 * 存储私聊和房间聊天消息
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ChatMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  SYSTEM = 'system',
}

export enum ChatTargetType {
  PRIVATE = 'private', // 私聊
  ROOM = 'room',       // 房间聊天
}

@Entity('social_chat_messages')
@Index(['sender_id', 'receiver_id', 'target_type'])
@Index(['room_id', 'created_at'])
export class ChatMessage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  message_id: string;

  @Column({ type: 'bigint', nullable: false })
  sender_id: string;

  // 私聊时为目标用户ID，房间聊天时为null
  @Column({ type: 'bigint', nullable: true })
  receiver_id: string | null;

  // 房间ID（房间聊天时使用）
  @Column({ type: 'varchar', length: 32, nullable: true })
  room_id: string | null;

  @Column({
    type: 'enum',
    enum: ChatTargetType,
    nullable: false,
    default: ChatTargetType.PRIVATE,
  })
  target_type: ChatTargetType;

  @Column({ type: 'text', nullable: false })
  content: string;

  @Column({
    type: 'enum',
    enum: ChatMessageType,
    nullable: false,
    default: ChatMessageType.TEXT,
  })
  message_type: ChatMessageType;

  // 是否已读（仅私聊有效）
  @Column({ type: 'boolean', nullable: false, default: false })
  is_read: boolean;

  @CreateDateColumn({ type: 'timestamptz', nullable: false })
  created_at: Date;
}
