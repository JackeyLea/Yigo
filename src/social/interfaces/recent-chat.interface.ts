import { ChatMessageType } from '../entities/chat-message.entity';

export interface RecentChat {
  userId: number;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  lastMessage: string;
  lastMessageType: ChatMessageType;
  lastMessageTime: Date;
  unreadCount: number;
}
