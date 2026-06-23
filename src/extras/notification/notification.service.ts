import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type NotificationType =
  | 'system'
  | 'game_invite'
  | 'friend_request'
  | 'achievement'
  | 'reward'
  | 'tournament';

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  content: string;
  data: Record<string, any> | null;
  isRead: boolean;
  createdAt: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly DEFAULT_PAGE_SIZE = 20;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 发送通知给指定用户
   */
  async sendNotification(
    userId: number,
    type: NotificationType,
    title: string,
    content: string,
    data?: Record<string, any>,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        content,
        data: data ?? null,
        isRead: false,
      },
    });

    this.logger.log(`通知已发送给用户 ${userId}: [${type}] ${title}`);
  }

  /**
   * 获取用户的通知列表（分页）
   */
  async getNotifications(
    userId: number,
    page = 1,
  ): Promise<PaginatedResult<Notification>> {
    const pageSize = this.DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({
        where: { userId },
      }),
    ]);

    return {
      items: items as Notification[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 标记单条通知为已读
   */
  async markAsRead(userId: number, notificationId: number): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new Error('通知不存在或无权访问');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, updatedAt: new Date() },
    });

    this.logger.log(`用户 ${userId} 标记通知 ${notificationId} 为已读`);
  }

  /**
   * 标记用户全部通知为已读
   */
  async markAllAsRead(userId: number): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, updatedAt: new Date() },
    });

    this.logger.log(`用户 ${userId} 标记全部通知为已读`);
  }

  /**
   * 获取用户未读通知数量
   */
  async getUnreadCount(userId: number): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * 发送广播通知
   * target 可以是 'all' 或特定用户群体的标识
   */
  async sendBroadcast(
    title: string,
    content: string,
    target = 'all',
  ): Promise<void> {
    if (target === 'all') {
      const users = await this.prisma.user.findMany({
        select: { id: true },
      });

      const batchSize = 500;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await this.prisma.notification.createMany({
          data: batch.map((user) => ({
            userId: user.id,
            type: 'system' as NotificationType,
            title,
            content,
            isRead: false,
          })),
          skipDuplicates: true,
        });
      }

      this.logger.log(`广播通知已发送给所有用户: ${title}`);
    } else {
      await this.sendNotification(Number(target), 'system', title, content);
    }
  }

  /**
   * 删除指定通知
   */
  async deleteNotification(userId: number, notificationId: number): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new Error('通知不存在或无权访问');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  /**
   * 发送游戏邀请通知
   */
  async sendGameInvite(
    fromUserId: number,
    toUserId: number,
    gameType: string,
    roomId: string,
  ): Promise<void> {
    const fromUser = await this.prisma.user.findUnique({
      where: { id: fromUserId },
      select: { nickname: true },
    });

    await this.sendNotification(
      toUserId,
      'game_invite',
      '游戏邀请',
      `${fromUser?.nickname ?? '未知用户'} 邀请您进行一场 ${gameType} 对局`,
      { fromUserId, gameType, roomId },
    );
  }

  /**
   * 发送好友请求通知
   */
  async sendFriendRequest(
    fromUserId: number,
    toUserId: number,
  ): Promise<void> {
    const fromUser = await this.prisma.user.findUnique({
      where: { id: fromUserId },
      select: { nickname: true },
    });

    await this.sendNotification(
      toUserId,
      'friend_request',
      '好友请求',
      `${fromUser?.nickname ?? '未知用户'} 请求添加您为好友`,
      { fromUserId },
    );
  }

  /**
   * 发送成就解锁通知
   */
  async sendAchievementNotification(
    userId: number,
    achievementName: string,
    achievementDesc: string,
  ): Promise<void> {
    await this.sendNotification(
      userId,
      'achievement',
      '成就解锁',
      `恭喜您解锁成就「${achievementName}」：${achievementDesc}`,
      { achievementName },
    );
  }

  /**
   * 发送奖励发放通知
   */
  async sendRewardNotification(
    userId: number,
    rewardTitle: string,
    rewardDesc: string,
    rewardData?: Record<string, any>,
  ): Promise<void> {
    await this.sendNotification(
      userId,
      'reward',
      rewardTitle,
      rewardDesc,
      rewardData,
    );
  }
}
