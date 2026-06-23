import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface ShareData {
  shareUrl: string;
  shareId: string;
  title: string;
  description: string;
  imageUrl: string;
}

export type ShareType = 'game_result' | 'room_invite' | 'achievement' | 'profile';

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);
  private readonly shareBaseUrl: string;
  private readonly cdnBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.shareBaseUrl =
      this.configService.get<string>('SHARE_BASE_URL') ?? 'https://game.example.com/s';
    this.cdnBaseUrl =
      this.configService.get<string>('CDN_BASE_URL') ?? 'https://cdn.example.com';
  }

  /**
   * 生成分享卡片
   * @param userId 用户ID
   * @param type 分享类型
   * @param data 分享数据
   * @returns 分享图片URL
   */
  async generateShareCard(
    userId: number,
    type: string,
    data: Record<string, any>,
  ): Promise<string> {
    const shareId = this.generateShareId();

    await this.prisma.shareRecord.create({
      data: {
        shareId,
        userId,
        type: type as ShareType,
        data,
        clickCount: 0,
      },
    });

    const imageUrl = `${this.cdnBaseUrl}/share-cards/${shareId}.png`;

    this.logger.log(`分享卡片已生成: ${shareId}, 类型: ${type}`);

    return imageUrl;
  }

  /**
   * 分享游戏战绩
   */
  async shareGameResult(userId: number, recordId: number): Promise<ShareData> {
    const gameRecord = await this.prisma.gameRecord.findUnique({
      where: { id: recordId },
      include: {
        user: { select: { nickname: true, avatar: true } },
        opponent: { select: { nickname: true, avatar: true } },
      },
    });

    if (!gameRecord) {
      throw new Error('游戏记录不存在');
    }

    if (gameRecord.userId !== userId) {
      throw new Error('无权分享该战绩');
    }

    const shareId = this.generateShareId();
    const isWin = gameRecord.result === 'win';
    const resultText = isWin ? '胜利' : gameRecord.result === 'lose' ? '失败' : '平局';

    const title = `${gameRecord.user.nickname} 的${gameRecord.gameType}战绩`;
    const description = `在 ${gameRecord.gameType} 对局中${resultText}！快来观战吧！`;

    await this.prisma.shareRecord.create({
      data: {
        shareId,
        userId,
        type: 'game_result',
        data: {
          recordId,
          gameType: gameRecord.gameType,
          result: gameRecord.result,
          opponentName: gameRecord.opponent?.nickname,
        },
        clickCount: 0,
      },
    });

    const shareUrl = `${this.shareBaseUrl}/game/${shareId}`;
    const imageUrl = `${this.cdnBaseUrl}/share-cards/${shareId}.png`;

    this.logger.log(`用户 ${userId} 分享了游戏战绩: ${recordId}`);

    return {
      shareUrl,
      shareId,
      title,
      description,
      imageUrl,
    };
  }

  /**
   * 分享房间邀请
   */
  async shareRoomInvite(userId: number, roomId: string): Promise<ShareData> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true },
    });

    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new Error('房间不存在');
    }

    const shareId = this.generateShareId();
    const title = `${user?.nickname ?? '玩家'} 邀请您加入游戏房间`;
    const description = `快来加入 ${room.gameType} 房间，一起对局吧！`;

    await this.prisma.shareRecord.create({
      data: {
        shareId,
        userId,
        type: 'room_invite',
        data: {
          roomId,
          gameType: room.gameType,
          inviterName: user?.nickname,
        },
        clickCount: 0,
      },
    });

    const shareUrl = `${this.shareBaseUrl}/room/${shareId}`;
    const imageUrl = `${this.cdnBaseUrl}/share-cards/${shareId}.png`;

    this.logger.log(`用户 ${userId} 分享了房间邀请: ${roomId}`);

    return {
      shareUrl,
      shareId,
      title,
      description,
      imageUrl,
    };
  }

  /**
   * 追踪分享点击
   */
  async trackShare(shareId: string): Promise<void> {
    const shareRecord = await this.prisma.shareRecord.findUnique({
      where: { shareId },
    });

    if (!shareRecord) {
      throw new Error('分享记录不存在');
    }

    await this.prisma.shareRecord.update({
      where: { shareId },
      data: {
        clickCount: { increment: 1 },
        lastClickedAt: new Date(),
      },
    });

    this.logger.log(`分享链接被点击: ${shareId}`);
  }

  /**
   * 获取分享记录详情
   */
  async getShareRecord(shareId: string) {
    const record = await this.prisma.shareRecord.findUnique({
      where: { shareId },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });

    if (!record) {
      throw new Error('分享记录不存在');
    }

    return record;
  }

  /**
   * 分享成就
   */
  async shareAchievement(
    userId: number,
    achievementId: string,
    achievementName: string,
  ): Promise<ShareData> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true },
    });

    const shareId = this.generateShareId();
    const title = `${user?.nickname ?? '玩家'} 解锁了新成就！`;
    const description = `恭喜获得成就「${achievementName}」，一起来挑战吧！`;

    await this.prisma.shareRecord.create({
      data: {
        shareId,
        userId,
        type: 'achievement',
        data: {
          achievementId,
          achievementName,
        },
        clickCount: 0,
      },
    });

    const shareUrl = `${this.shareBaseUrl}/achievement/${shareId}`;
    const imageUrl = `${this.cdnBaseUrl}/share-cards/${shareId}.png`;

    this.logger.log(`用户 ${userId} 分享了成就: ${achievementId}`);

    return {
      shareUrl,
      shareId,
      title,
      description,
      imageUrl,
    };
  }

  /**
   * 分享个人主页
   */
  async shareProfile(userId: number): Promise<ShareData> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, avatar: true },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    const shareId = this.generateShareId();
    const title = `${user.nickname} 的个人主页`;
    const description = '来看看我的游戏战绩和成就吧！';

    await this.prisma.shareRecord.create({
      data: {
        shareId,
        userId,
        type: 'profile',
        data: {
          userId,
          nickname: user.nickname,
        },
        clickCount: 0,
      },
    });

    const shareUrl = `${this.shareBaseUrl}/profile/${shareId}`;
    const imageUrl = `${this.cdnBaseUrl}/share-cards/${shareId}.png`;

    this.logger.log(`用户 ${userId} 分享了个人主页`);

    return {
      shareUrl,
      shareId,
      title,
      description,
      imageUrl,
    };
  }

  /**
   * 生成唯一分享ID
   */
  private generateShareId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}${random}`;
  }
}
