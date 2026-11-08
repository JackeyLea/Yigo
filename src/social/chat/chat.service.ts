/**
 * ChatService - 聊天服务
 * 管理私聊、房间聊天、消息历史、未读消息
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { ChatMessage, ChatMessageType, ChatTargetType } from '../entities/chat-message.entity';
import { Friend, FriendStatus } from '../entities/friend.entity';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { RecentChat } from '../interfaces/recent-chat.interface';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly redis: Redis;
  private readonly redisRecentPrefix = 'chat:recent:';
  private readonly redisUnreadPrefix = 'chat:unread:';
  private readonly redisBlockPrefix = 'friend:block:';
  private readonly maxRecentCache = 100;

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(Friend)
    private readonly friendRepository: Repository<Friend>,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB, 10) || 0,
      keyPrefix: 'social:',
    });
  }

  /**
   * 发送私聊消息
   */
  async sendMessage(
    fromUserId: number,
    toUserId: number,
    content: string,
    type: ChatMessageType = ChatMessageType.TEXT,
  ): Promise<ChatMessage> {
    if (fromUserId === toUserId) {
      throw new BadRequestException('Cannot send message to yourself');
    }

    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Message content cannot be empty');
    }

    // 检查是否被拉黑
    const isBlocked = await this.isBlocked(toUserId, fromUserId);
    if (isBlocked) {
      throw new ForbiddenException('You have been blocked by this user');
    }

    const trimmedContent = content.trim();

    // 保存消息到数据库
    const message = this.chatMessageRepository.create({
      sender_id: String(fromUserId),
      receiver_id: String(toUserId),
      room_id: null,
      target_type: ChatTargetType.PRIVATE,
      content: trimmedContent,
      message_type: type,
      is_read: false,
    });

    const saved = await this.chatMessageRepository.save(message);

    // 更新Redis未读计数
    await this.redis.hincrby(
      `${this.redisUnreadPrefix}${toUserId}`,
      String(fromUserId),
      1,
    );

    // 更新Redis最近消息缓存（双向）
    const recentEntry = JSON.stringify({
      senderId: fromUserId,
      content: trimmedContent.substring(0, 200),
      type,
      timestamp: saved.created_at.toISOString(),
    });

    const pipeline = this.redis.pipeline();

    // 添加到接收方的最近消息
    pipeline.lpush(`${this.redisRecentPrefix}${toUserId}:${fromUserId}`, recentEntry);
    pipeline.ltrim(`${this.redisRecentPrefix}${toUserId}:${fromUserId}`, 0, this.maxRecentCache - 1);
    pipeline.expire(`${this.redisRecentPrefix}${toUserId}:${fromUserId}`, 86400 * 7);

    // 添加到发送方的最近消息
    pipeline.lpush(`${this.redisRecentPrefix}${fromUserId}:${toUserId}`, recentEntry);
    pipeline.ltrim(`${this.redisRecentPrefix}${fromUserId}:${toUserId}`, 0, this.maxRecentCache - 1);
    pipeline.expire(`${this.redisRecentPrefix}${fromUserId}:${toUserId}`, 86400 * 7);

    await pipeline.exec();

    this.logger.debug(`Private message sent: ${fromUserId} -> ${toUserId}`);

    return saved;
  }

  /**
   * 发送房间聊天消息
   */
  async sendRoomMessage(
    fromUserId: number,
    roomId: string,
    content: string,
  ): Promise<ChatMessage> {
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const trimmedContent = content.trim();

    const message = this.chatMessageRepository.create({
      sender_id: String(fromUserId),
      receiver_id: null,
      room_id: roomId,
      target_type: ChatTargetType.ROOM,
      content: trimmedContent,
      message_type: ChatMessageType.TEXT,
      is_read: true, // 房间消息默认已读
    });

    const saved = await this.chatMessageRepository.save(message);

    // 更新Redis房间最近消息缓存
    const recentEntry = JSON.stringify({
      senderId: fromUserId,
      roomId,
      content: trimmedContent.substring(0, 200),
      timestamp: saved.created_at.toISOString(),
    });

    await this.redis.lpush(`${this.redisRecentPrefix}room:${roomId}`, recentEntry);
    await this.redis.ltrim(`${this.redisRecentPrefix}room:${roomId}`, 0, this.maxRecentCache - 1);
    await this.redis.expire(`${this.redisRecentPrefix}room:${roomId}`, 86400);

    this.logger.debug(`Room message sent: ${fromUserId} -> room ${roomId}`);

    return saved;
  }

  /**
   * 获取私聊历史记录
   */
  async getHistory(
    userId: number,
    withUserId: number,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<ChatMessage>> {
    const [items, total] = await this.chatMessageRepository.findAndCount({
      where: [
        {
          sender_id: String(userId),
          receiver_id: String(withUserId),
          target_type: ChatTargetType.PRIVATE,
        },
        {
          sender_id: String(withUserId),
          receiver_id: String(userId),
          target_type: ChatTargetType.PRIVATE,
        },
      ],
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取房间聊天历史
   */
  async getRoomHistory(
    roomId: string,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<PaginatedResult<ChatMessage>> {
    const [items, total] = await this.chatMessageRepository.findAndCount({
      where: {
        room_id: roomId,
        target_type: ChatTargetType.ROOM,
      },
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取未读消息总数
   */
  async getUnreadCount(userId: number): Promise<number> {
    // 先尝试从Redis获取
    const unreadMap = await this.redis.hgetall(`${this.redisUnreadPrefix}${userId}`);
    if (Object.keys(unreadMap).length > 0) {
      return Object.values(unreadMap).reduce(
        (sum, val) => sum + parseInt(val as string, 10),
        0,
      );
    }

    // 回退到数据库查询
    const count = await this.chatMessageRepository.count({
      where: {
        receiver_id: String(userId),
        is_read: false,
        target_type: ChatTargetType.PRIVATE,
      },
    });

    return count;
  }

  /**
   * 获取指定用户的未读消息数
   */
  async getUnreadCountFrom(userId: number, fromUserId: number): Promise<number> {
    const count = await this.redis.hget(
      `${this.redisUnreadPrefix}${userId}`,
      String(fromUserId),
    );
    if (count !== null) {
      return parseInt(count, 10);
    }

    // 回退到数据库
    return this.chatMessageRepository.count({
      where: {
        sender_id: String(fromUserId),
        receiver_id: String(userId),
        is_read: false,
        target_type: ChatTargetType.PRIVATE,
      },
    });
  }

  /**
   * 标记消息为已读
   */
  async markAsRead(userId: number, fromUserId: number): Promise<void> {
    // 更新数据库
    await this.chatMessageRepository.update(
      {
        sender_id: String(fromUserId),
        receiver_id: String(userId),
        is_read: false,
        target_type: ChatTargetType.PRIVATE,
      },
      { is_read: true },
    );

    // 清除Redis未读计数
    await this.redis.hdel(`${this.redisUnreadPrefix}${userId}`, String(fromUserId));

    this.logger.debug(`Messages marked as read: user ${userId} from ${fromUserId}`);
  }

  /**
   * 获取最近聊天列表
   */
  async getRecentChats(userId: number): Promise<RecentChat[]> {
    // 从数据库获取最近有消息往来的用户列表
    const query = this.chatMessageRepository
      .createQueryBuilder('msg')
      .select('DISTINCT ON (LEAST(msg.sender_id::bigint, msg.receiver_id::bigint), GREATEST(msg.sender_id::bigint, msg.receiver_id::bigint))')
      .addSelect('msg.sender_id', 'sender_id')
      .addSelect('msg.receiver_id', 'receiver_id')
      .addSelect('msg.content', 'last_content')
      .addSelect('msg.message_type', 'message_type')
      .addSelect('msg.created_at', 'last_message_time')
      .where(
        '(msg.sender_id = :userId OR msg.receiver_id = :userId) AND msg.target_type = :targetType',
        { userId: String(userId), targetType: ChatTargetType.PRIVATE },
      )
      .orderBy('LEAST(msg.sender_id::bigint, msg.receiver_id::bigint)')
      .addOrderBy('GREATEST(msg.sender_id::bigint, msg.receiver_id::bigint)')
      .addOrderBy('msg.created_at', 'DESC')
      .limit(50);

    const recentMessages = await query.getRawMany();

    if (recentMessages.length === 0) {
      return [];
    }

    // 获取每个对话用户的未读数
    const recentChats: RecentChat[] = [];

    for (const msg of recentMessages) {
      const otherUserId =
        String(msg.sender_id) === String(userId)
          ? Number(msg.receiver_id)
          : Number(msg.sender_id);

      const unreadCount = await this.getUnreadCountFrom(userId, otherUserId);

      // 获取用户信息（简单查询）
      const userInfo = await this.getUserInfo(otherUserId);

      recentChats.push({
        userId: otherUserId,
        username: userInfo?.username || '',
        nickname: userInfo?.nickname || '',
        avatarUrl: userInfo?.avatar_url || null,
        lastMessage: msg.last_content || '',
        lastMessageType: msg.message_type || ChatMessageType.TEXT,
        lastMessageTime: msg.last_message_time,
        unreadCount,
      });
    }

    // 按最后消息时间排序
    recentChats.sort(
      (a, b) =>
        new Date(b.lastMessageTime).getTime() -
        new Date(a.lastMessageTime).getTime(),
    );

    return recentChats;
  }

  /**
   * 检查用户是否被拉黑（Redis + 数据库回退）
   */
  private async isBlocked(userId: number, byUserId: number): Promise<boolean> {
    // 先检查Redis缓存
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
   * 获取用户信息（简易缓存）
   */
  private async getUserInfo(userId: number): Promise<{ username: string; nickname: string; avatar_url: string | null } | null> {
    // 这里简化为直接查询，实际项目中可以从UserService获取
    // 为避免循环依赖，使用简单查询
    try {
      const result = await this.chatMessageRepository.query(
        `SELECT username, nickname, avatar_url FROM users WHERE user_id = $1 LIMIT 1`,
        [String(userId)],
      );
      return result[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * 撤回消息
   */
  async recallMessage(
    userId: number,
    messageId: string,
  ): Promise<void> {
    const message = await this.chatMessageRepository.findOne({
      where: { message_id: messageId },
    });

    if (!message) {
      throw new BadRequestException('Message not found');
    }

    if (String(message.sender_id) !== String(userId)) {
      throw new ForbiddenException('Can only recall your own messages');
    }

    // 只能撤回2分钟内的消息
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    if (message.created_at < twoMinutesAgo) {
      throw new BadRequestException('Can only recall messages within 2 minutes');
    }

    message.content = '[Message recalled]';
    message.message_type = ChatMessageType.SYSTEM;
    await this.chatMessageRepository.save(message);

    this.logger.log(`Message recalled: ${messageId} by user ${userId}`);
  }
}
