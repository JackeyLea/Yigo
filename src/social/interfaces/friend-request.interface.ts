import { FriendStatus } from '../entities/friend.entity';

export interface FriendRequest {
  id: string;
  userId: number;
  friendId: number;
  status: FriendStatus;
  requesterId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FriendInfo {
  id: string;
  userId: number;
  friendId: number;
  friendName: string;
  friendNickname: string;
  friendAvatar: string | null;
  status: FriendStatus;
  isOnline: boolean;
  createdAt: Date;
}
