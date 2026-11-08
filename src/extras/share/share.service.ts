import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShareRecord } from './share-record.entity';
import { GameRecord } from '../../common/entities/game-record.entity';
import { User } from '../../common/entities/user.entity';
import { Room } from '../../common/entities/room.entity';

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
    @InjectRepository(ShareRecord)
    private readonly shareRecordRepo: Repository<ShareRecord>,
    @InjectRepository(GameRecord)
    private readonly gameRecordRepo: Repository<GameRecord>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
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

    await this.shareRecordRepo.insert({
      share_id: shareId,
      user_id: userId,
      type: type as ShareType,
      data,
      click_count: 0,
    });

    const imageUrl = `${this.cdnBaseUrl}/share-cards/${shareId}.png`;

    this.logger.log(`分享卡片已生成: ${shareId}, 类型: ${type}`);

    return imageUrl;
  }

  /**
   * 分享游戏战绩
   */
  async shareGameResult(userId: number, recordId: number): Promise<ShareData> {
    const gameRecord = await this.gameRecordRepo.findOne({
      where: { record_id: String(recordId) },
    });

    if (!gameRecord) {
      throw new Error('游戏记录不存在');
    }

    if (!this.isRecordPlayer(gameRecord, userId)) {
      throw new Error('无权分享该战绩');
    }

    const shareId = this.generateShareId();
    // result_json 结构未明确，取 result 字段判断，缺省视为平局
    const result = ((gameRecord.result_json as any)?.result as string) ?? 'draw';
    const isWin = result === 'win';
    const resultText = isWin ? '胜利' : result === 'lose' ? '失败' : '平局';

    const user = await this.userRepo.findOne({
      where: { user_id: String(userId) },
    });
    const title = `${user?.nickname ?? '玩家'} 的${gameRecord.game_type}战绩`;
    const description = `在 ${gameRecord.game_type} 对局中${resultText}！快来观战吧！`;

    const payload: Record<string, any> = {
      recordId,
      gameType: gameRecord.game_type,
      result,
      // 对局记录表没有对手信息关联，暂置为 null
      opponentName: null,
    };

    await this.shareRecordRepo.insert({
      share_id: shareId,
      user_id: userId,
      type: 'game_result',
      data: payload,
      click_count: 0,
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
    const user = await this.userRepo.findOne({
      where: { user_id: String(userId) },
    });

    const room = await this.roomRepo.findOne({
      where: { room_id: roomId },
    });

    if (!room) {
      throw new Error('房间不存在');
    }

    const shareId = this.generateShareId();
    const title = `${user?.nickname ?? '玩家'} 邀请您加入游戏房间`;
    const description = `快来加入 ${room.game_type} 房间，一起对局吧！`;

    const payload: Record<string, any> = {
      roomId,
      gameType: room.game_type,
      inviterName: user?.nickname,
    };

    await this.shareRecordRepo.insert({
      share_id: shareId,
      user_id: userId,
      type: 'room_invite',
      data: payload,
      click_count: 0,
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
    const shareRecord = await this.shareRecordRepo.findOne({
      where: { share_id: shareId },
    });

    if (!shareRecord) {
      throw new Error('分享记录不存在');
    }

    await this.shareRecordRepo.update(
      { share_id: shareId },
      {
        click_count: () => 'click_count + 1',
        last_clicked_at: new Date(),
      },
    );

    this.logger.log(`分享链接被点击: ${shareId}`);
  }

  /**
   * 获取分享记录详情
   */
  async getShareRecord(shareId: string) {
    const record = await this.shareRecordRepo.findOne({
      where: { share_id: shareId },
    });

    if (!record) {
      throw new Error('分享记录不存在');
    }

    // 补充分享者信息（对齐原接口返回结构）
    const user = await this.userRepo.findOne({
      where: { user_id: String(record.user_id) },
    });

    return {
      shareId: record.share_id,
      userId: Number(record.user_id),
      type: record.type,
      data: record.data,
      clickCount: record.click_count,
      lastClickedAt: record.last_clicked_at,
      createdAt: record.created_at,
      user: user
        ? {
            id: Number(user.user_id),
            nickname: user.nickname,
            avatar: user.avatar_url,
          }
        : null,
    };
  }

  /**
   * 分享成就
   */
  async shareAchievement(
    userId: number,
    achievementId: string,
    achievementName: string,
  ): Promise<ShareData> {
    const user = await this.userRepo.findOne({
      where: { user_id: String(userId) },
    });

    const shareId = this.generateShareId();
    const title = `${user?.nickname ?? '玩家'} 解锁了新成就！`;
    const description = `恭喜获得成就「${achievementName}」，一起来挑战吧！`;

    const payload: Record<string, any> = {
      achievementId,
      achievementName,
    };

    await this.shareRecordRepo.insert({
      share_id: shareId,
      user_id: userId,
      type: 'achievement',
      data: payload,
      click_count: 0,
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
    const user = await this.userRepo.findOne({
      where: { user_id: String(userId) },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    const shareId = this.generateShareId();
    const title = `${user.nickname} 的个人主页`;
    const description = '来看看我的游戏战绩和成就吧！';

    const payload: Record<string, any> = {
      userId,
      nickname: user.nickname,
    };

    await this.shareRecordRepo.insert({
      share_id: shareId,
      user_id: userId,
      type: 'profile',
      data: payload,
      click_count: 0,
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
   * 判断用户是否参与该对局
   * players_json 结构未明确，兼容对象（以玩家ID为键）与数组两种存储形式
   */
  private isRecordPlayer(record: GameRecord, userId: number): boolean {
    const players = (record.players_json ?? {}) as any;
    if (Array.isArray(players)) {
      return players.some(
        (p) =>
          p?.userId === userId ||
          p?.user_id === Number(userId) ||
          String(p) === String(userId),
      );
    }
    return Object.keys(players).includes(String(userId));
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
