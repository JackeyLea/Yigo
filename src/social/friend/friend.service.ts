/**
 * FriendService - 好友服务
 * 管理好友请求、好友列表、黑名单、在线状态
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import * as Redis from 'ioredis';
import { Friend, FriendStatus } from '../entities/friend.entity';
import { User } from '../../common/entities/user.entity';
import { FriendInfo } from '../interfaces/friend-request.interface';

export interface FriendRequest {
  id: string;
  userId: number;
  friendId: number;
  status: FriendStatus;
  requesterId: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FriendService {
  private readonly logger = new Logger(FriendService.name);
  private readonly redis: Redis.Redis;
  private readonly redisOnlinePrefix = 'friend:online:';
  private readonly redisBlockPrefix = 'friend:block:';

  constructor(
    @InjectRepository(Friend)
    private readonly friendRepository: Repository<Friend>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.redis = new Redis.default({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB, 10) || 0,
      keyPrefix: 'social:',
    });
  }

  /**
   * 发送好友请求
   */
  async sendFriendRequest(fromUserId: number, toUserId: number): Promise<void> {
    if (fromUserId === toUserId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    // 检查目标用户是否存在
    const targetUser = await this.userRepository.findOne({
      where: { user_id: String(toUserId) },
    });
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    // 检查是否已在黑名单中
    const isBlocked = await this.isBlocked(toUserId, fromUserId);
    if (isBlocked) {
      throw new ForbiddenException('You have been blocked by this user');
    }

    // 检查是否已有好友关系（任一方向）
    const existing = await this.friendRepository
      .createQueryBuilder('friend')
      .where(
        new Brackets((qb) => {
          qb.where('friend.user_id = :fromUserId AND friend.friend_id = :toUserId', {
            fromUserId: String(fromUserId),
            toUserId: String(toUserId),
          }).orWhere(
            'friend.user_id = :toUserId2 AND friend.friend_id = :fromUserId2',
            { toUserId2: String(toUserId), fromUserId2: String(fromUserId) },
          );
        }),
      )
      .getOne();

    if (existing) {
      if (existing.status === FriendStatus.ACCEPTED) {
        throw new ConflictException('Already friends');
      }
      if (existing.status === FriendStatus.PENDING) {
        throw new ConflictException('Friend request already pending');
      }
      if (existing.status === FriendStatus.BLOCKED) {
        throw new ConflictException('Cannot send request to this user');
      }
    }

    // 创建好友请求记录（双向存储）
    const forward = this.friendRepository.create({
      user_id: String(fromUserId),
      friend_id: String(toUserId),
      status: FriendStatus.PENDING,
      requester_id: String(fromUserId),
    });

    const backward = this.friendRepository.create({
      user_id: String(toUserId),
      friend_id: String(fromUserId),
      status: FriendStatus.PENDING,
      requester_id: String(fromUserId),
    });

    await this.friendRepository.save([forward, backward]);
    this.logger.log(`Friend request sent: ${fromUserId} -> ${toUserId}`);
  }

  /**
   * 接受好友请求
   */
  async acceptFriendRequest(userId: number, requestId: string): Promise<void> {
    const request = await this.friendRepository.findOne({
      where: { id: requestId, friend_id: String(userId) },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendStatus.PENDING) {
      throw new BadRequestException('Friend request is not pending');
    }

    const fromUserId = request.requester_id;

    // 更新双向记录为 ACCEPTED
    await this.friendRepository.update(
      {
        user_id: String(userId),
        friend_id: fromUserId,
      },
      { status: FriendStatus.ACCEPTED },
    );

    await this.friendRepository.update(
      {
        user_id: fromUserId,
        friend_id: String(userId),
      },
      { status: FriendStatus.ACCEPTED },
    );

    this.logger.log(`Friend request accepted: ${userId} accepted from ${fromUserId}`);
  }

  /**
   * 拒绝好友请求
   */
  async rejectFriendRequest(userId: number, requestId: string): Promise<void> {
    const request = await this.friendRepository.findOne({
      where: { id: requestId, friend_id: String(userId) },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendStatus.PENDING) {
      throw new BadRequestException('Friend request is not pending');
    }

    const fromUserId = request.requester_id;

    // 删除双向记录
    await this.friendRepository.delete({
      user_id: String(userId),
      friend_id: fromUserId,
    });

    await this.friendRepository.delete({
      user_id: fromUserId,
      friend_id: String(userId),
    });

    this.logger.log(`Friend request rejected: ${userId} rejected from ${fromUserId}`);
  }

  /**
   * 删除好友
   */
  async removeFriend(userId: number, friendId: number): Promise<void> {
    const result1 = await this.friendRepository.delete({
      user_id: String(userId),
      friend_id: String(friendId),
      status: FriendStatus.ACCEPTED,
    });

    const result2 = await this.friendRepository.delete({
      user_id: String(friendId),
      friend_id: String(userId),
      status: FriendStatus.ACCEPTED,
    });

    if (result1.affected === 0 && result2.affected === 0) {
      throw new NotFoundException('Friend relationship not found');
    }

    // 清理Redis在线状态
    await this.redis.srem(`${this.redisOnlinePrefix}${userId}`, String(friendId));
    await this.redis.srem(`${this.redisOnlinePrefix}${friendId}`, String(userId));

    this.logger.log(`Friend removed: ${userId} removed ${friendId}`);
  }

  /**
   * 获取好友列表（含在线状态）
   */
  async getFriendList(userId: number): Promise<FriendInfo[]> {
    const friends = await this.friendRepository.find({
      where: {
        user_id: String(userId),
        status: FriendStatus.ACCEPTED,
      },
      order: { created_at: 'DESC' },
    });

    if (friends.length === 0) {
      return [];
    }

    // 批量获取好友用户信息
    const friendIds = friends.map((f) => f.friend_id);
    const onlineSet = await this.redis.smembers(`${this.redisOnlinePrefix}${userId}`);
    const onlineSetNormalized = new Set(onlineSet);

    const users = await this.userRepository.findByIds(friendIds.map(Number));
    const userMap = new Map(users.map((u) => [u.user_id, u]));

    return friends.map((friend) => {
      const user = userMap.get(friend.friend_id);
      return {
        id: friend.id,
        userId: Number(friend.user_id),
        friendId: Number(friend.friend_id),
        friendName: user?.username || '',
        friendNickname: user?.nickname || '',
        friendAvatar: user?.avatar_url || null,
        status: friend.status,
        isOnline: onlineSetNormalized.has(friend.friend_id),
        createdAt: friend.created_at,
      };
    });
  }

  /**
   * 获取待处理的好友请求列表
   */
  async getFriendRequests(userId: number): Promise<FriendRequest[]> {
    const requests = await this.friendRepository.find({
      where: {
        friend_id: String(userId),
        status: FriendStatus.PENDING,
      },
      order: { created_at: 'DESC' },
    });

    return requests.map((r) => ({
      id: r.id,
      userId: Number(r.user_id),
      friendId: Number(r.friend_id),
      status: r.status,
      requesterId: Number(r.requester_id),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * 搜索玩家
   */
  async searchPlayers(userId: number, keyword: string): Promise<User[]> {
    if (!keyword || keyword.trim().length === 0) {
      return [];
    }

    const trimmed = keyword.trim();

    const users = await this.userRepository
      .createQueryBuilder('user')
      .where(
        new Brackets((qb) => {
          qb.where('user.username ILIKE :keyword', { keyword: `%${trimmed}%` })
            .orWhere('user.nickname ILIKE :keyword', { keyword: `%${trimmed}%` });
        }),
      )
      .andWhere('user.user_id != :userId', { userId: String(userId) })
      .andWhere('user.status = :status', { status: 'active' })
      .limit(20)
      .getMany();

    return users;
  }

  /**
   * 拉黑用户
   */
  async blockUser(userId: number, blockUserId: number): Promise<void> {
    if (userId === blockUserId) {
      throw new BadRequestException('Cannot block yourself');
    }

    // 检查目标用户是否存在
    const targetUser = await this.userRepository.findOne({
      where: { user_id: String(blockUserId) },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // 删除已有的好友关系（任一方向）
    await this.friendRepository
      .createQueryBuilder()
      .delete()
      .where(
        new Brackets((qb) => {
          qb.where('user_id = :uid AND friend_id = :fuid', {
            uid: String(userId),
            fuid: String(blockUserId),
          }).orWhere('user_id = :fuid2 AND friend_id = :uid2', {
            fuid2: String(blockUserId),
            uid2: String(userId),
          });
        }),
      )
      .execute();

    // 创建拉黑记录（单向）
    const blockRecord = this.friendRepository.create({
      user_id: String(userId),
      friend_id: String(blockUserId),
      status: FriendStatus.BLOCKED,
      requester_id: String(userId),
    });

    await this.friendRepository.save(blockRecord);

    // 添加到Redis黑名单缓存
    await this.redis.sadd(`${this.redisBlockPrefix}${userId}`, String(blockUserId));

    this.logger.log(`User blocked: ${userId} blocked ${blockUserId}`);
  }

  /**
   * 取消拉黑
   */
  async unblockUser(userId: number, blockUserId: number): Promise<void> {
    const result = await this.friendRepository.delete({
      user_id: String(userId),
      friend_id: String(blockUserId),
      status: FriendStatus.BLOCKED,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Block record not found');
    }

    // 从Redis黑名单缓存移除
    await this.redis.srem(`${this.redisBlockPrefix}${userId}`, String(blockUserId));

    this.logger.log(`User unblocked: ${userId} unblocked ${blockUserId}`);
  }

  /**
   * 获取黑名单列表
   */
  async getBlockedList(userId: number): Promise<number[]> {
    // 优先从Redis获取
    const blockedIds = await this.redis.smembers(`${this.redisBlockPrefix}${userId}`);
    if (blockedIds && blockedIds.length > 0) {
      return blockedIds.map(Number);
    }

    // 回退到数据库
    const blocked = await this.friendRepository.find({
      where: {
        user_id: String(userId),
        status: FriendStatus.BLOCKED,
      },
    });

    const ids = blocked.map((b) => Number(b.friend_id));

    // 回写Redis
    if (ids.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const id of ids) {
        pipeline.sadd(`${this.redisBlockPrefix}${userId}`, String(id));
      }
      await pipeline.exec();
    }

    return ids;
  }

  /**
   * 检查用户是否被拉黑
   */
  private async isBlocked(userId: number, byUserId: number): Promise<boolean> {
    const blockedSet = await this.redis.smembers(`${this.redisBlockPrefix}${userId}`);
    if (blockedSet.includes(String(byUserId))) {
      return true;
    }

    // 回退到数据库检查
    const record = await this.friendRepository.findOne({
      where: {
        user_id: String(userId),
        friend_id: String(byUserId),
        status: FriendStatus.BLOCKED,
      },
    });

    return !!record;
  }

  /**
   * 更新用户在线状态到好友的Redis集合
   */
  async updateOnlineStatus(userId: number, isOnline: boolean): Promise<void> {
    // 获取所有好友ID
    const friends = await this.friendRepository.find({
      where: {
        user_id: String(userId),
        status: FriendStatus.ACCEPTED,
      },
      select: ['friend_id'],
    });

    const pipeline = this.redis.pipeline();
    for (const friend of friends) {
      const key = `${this.redisOnlinePrefix}${friend.friend_id}`;
      if (isOnline) {
        pipeline.sadd(key, String(userId));
      } else {
        pipeline.srem(key, String(userId));
      }
    }

    // 也更新自己的集合（用于后续离线清理）
    if (!isOnline) {
      pipeline.del(`${this.redisOnlinePrefix}${userId}`);
    }

    await pipeline.exec();
  }

  /**
   * 检查两个用户是否为好友
   */
  async areFriends(userId1: number, userId2: number): Promise<boolean> {
    const record = await this.friendRepository.findOne({
      where: {
        user_id: String(userId1),
        friend_id: String(userId2),
        status: FriendStatus.ACCEPTED,
      },
    });
    return !!record;
  }
}
