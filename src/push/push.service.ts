import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { DeviceToken, Platform, PushLog, PushStatus, PushType } from './entities';
import { RegisterDeviceDto, SendPushDto, BroadcastPushDto, RoomInvitePushDto, GameReminderPushDto } from './dto';

export interface PushFilter {
  platforms?: ('ios' | 'android' | 'web')[];
  minLevel?: number;
  maxLevel?: number;
  vipOnly?: boolean;
  gameTypes?: string[];
}

export interface PushResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly redisQueueKey = 'push:queue';
  private readonly redisStreamKey = 'push:stream';
  private readonly apnsRateLimitKey = 'push:apns:rate';
  private readonly fcmRateLimitKey = 'push:fcm:rate';

  // APNs config
  private apnsHost: string;
  private apnsTeamId: string;
  private apnsKeyId: string;
  private apnsBundleId: string;
  private apnsAuthKey: string;

  // FCM config
  private fcmServerKey: string;

  // Web Push config (VAPID)
  private vapidPublicKey: string;
  private vapidPrivateKey: string;
  private vapidSubject: string;

  constructor(
    @InjectRepository(DeviceToken)
    private readonly deviceTokenRepository: Repository<DeviceToken>,
    @InjectRepository(PushLog)
    private readonly pushLogRepository: Repository<PushLog>,
    @InjectRedis()
    private readonly redis: Redis,
  ) {
    // Initialize from environment variables
    this.apnsHost = process.env.APNS_HOST || 'api.push.apple.com';
    this.apnsTeamId = process.env.APNS_TEAM_ID || '';
    this.apnsKeyId = process.env.APNS_KEY_ID || '';
    this.apnsBundleId = process.env.APNS_BUNDLE_ID || 'com.chess.app';
    this.apnsAuthKey = process.env.APNS_AUTH_KEY?.replace(/\\n/g, '\n') || '';

    this.fcmServerKey = process.env.FCM_SERVER_KEY || '';

    this.vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
    this.vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
    this.vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@chess.com';
  }

  // ===== 设备Token管理 =====

  /**
   * 注册设备Token
   */
  async registerDevice(userId: number, dto: RegisterDeviceDto): Promise<void> {
    // 先检查是否已存在
    const existing = await this.deviceTokenRepository.findOne({
      where: { deviceToken: dto.deviceToken },
    });

    if (existing) {
      // 更新现有记录
      existing.userId = userId;
      existing.platform = dto.platform;
      existing.deviceModel = dto.deviceModel || existing.deviceModel;
      existing.osVersion = dto.osVersion || existing.osVersion;
      existing.appVersion = dto.appVersion || existing.appVersion;
      existing.isActive = true;
      existing.lastActiveAt = new Date();
      await this.deviceTokenRepository.save(existing);
    } else {
      // 创建新记录
      const device = this.deviceTokenRepository.create({
        userId,
        deviceToken: dto.deviceToken,
        platform: dto.platform,
        deviceModel: dto.deviceModel,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        isActive: true,
        lastActiveAt: new Date(),
      });
      await this.deviceTokenRepository.save(device);
    }

    // 更新Redis中的用户设备索引
    await this.redis.sadd(`user:${userId}:devices`, dto.deviceToken);
    await this.redis.hset(`device:${dto.deviceToken}`, {
      userId: userId.toString(),
      platform: dto.platform,
    });
  }

  /**
   * 注销设备Token
   */
  async unregisterDevice(userId: number, deviceToken: string): Promise<void> {
    const device = await this.deviceTokenRepository.findOne({
      where: { userId, deviceToken },
    });

    if (device) {
      device.isActive = false;
      await this.deviceTokenRepository.save(device);
    }

    await this.redis.srem(`user:${userId}:devices`, deviceToken);
    await this.redis.del(`device:${deviceToken}`);
  }

  /**
   * 获取用户设备列表
   */
  async getUserDevices(userId: number): Promise<DeviceToken[]> {
    return this.deviceTokenRepository.find({
      where: { userId, isActive: true },
    });
  }

  // ===== 单播推送 =====

  /**
   * 发送单播推送
   */
  async sendToUser(userId: number, title: string, body: string, data?: Record<string, any>): Promise<void> {
    const devices = await this.getUserDevices(userId);
    if (devices.length === 0) {
      this.logger.warn(`No active devices for user ${userId}`);
      return;
    }

    // 写入推送队列（Redis List）做缓冲
    for (const device of devices) {
      const pushJob = {
        userId,
        deviceToken: device.deviceToken,
        platform: device.platform,
        title,
        body,
        data: data || {},
        type: PushType.UNICAST,
        timestamp: Date.now(),
      };

      await this.redis.lpush(this.redisQueueKey, JSON.stringify(pushJob));
      this.logger.debug(`Push job queued for user ${userId} on ${device.platform}`);
    }

    // 立即触发队列处理
    this.processPushQueue().catch((err) => {
      this.logger.error('Failed to process push queue', err.stack);
    });
  }

  /**
   * 发送广播
   */
  async broadcast(title: string, body: string, filter?: PushFilter): Promise<void> {
    const queryBuilder = this.deviceTokenRepository.createQueryBuilder('device')
      .where('device.isActive = :isActive', { isActive: true });

    if (filter?.platforms && filter.platforms.length > 0) {
      queryBuilder.andWhere('device.platform IN (:...platforms)', {
        platforms: filter.platforms,
      });
    }

    // Note: level/vip filtering would require joining with users table
    // Simplified here - in production, add proper joins

    const devices = await queryBuilder.getMany();
    this.logger.log(`Broadcasting to ${devices.length} devices`);

    // 分批入队，避免内存溢出
    const batchSize = 500;
    for (let i = 0; i < devices.length; i += batchSize) {
      const batch = devices.slice(i, i + batchSize);
      const pipeline = this.redis.pipeline();

      for (const device of batch) {
        const pushJob = {
          userId: device.userId,
          deviceToken: device.deviceToken,
          platform: device.platform,
          title,
          body,
          data: filter || {},
          type: PushType.BROADCAST,
          timestamp: Date.now(),
        };
        pipeline.lpush(this.redisQueueKey, JSON.stringify(pushJob));
      }

      await pipeline.exec();
    }

    // 触发队列处理
    this.processPushQueue().catch((err) => {
      this.logger.error('Failed to process broadcast queue', err.stack);
    });
  }

  // ===== 业务推送 =====

  /**
   * 发送房间邀请推送
   */
  async sendRoomInvite(inviterId: number, inviteeId: number, roomId: string): Promise<void> {
    // 获取邀请者信息
    const inviterName = await this.getUserName(inviterId);
    const title = 'Room Invitation';
    const body = `${inviterName} invited you to join room ${roomId}`;
    const data = {
      type: 'room_invite',
      inviterId: inviterId.toString(),
      roomId,
    };

    await this.sendToUser(inviteeId, title, body, data);

    // 记录推送日志
    await this.logPush(inviteeId, 'all', PushType.ROOM_INVITE, title, body, data);
  }

  /**
   * 发送游戏开始提醒
   */
  async sendGameStartReminder(userId: number, roomId: string): Promise<void> {
    const title = 'Game Starting Soon';
    const body = `Your game in room ${roomId} is about to start!`;
    const data = {
      type: 'game_reminder',
      roomId,
    };

    await this.sendToUser(userId, title, body, data);
    await this.logPush(userId, 'all', PushType.GAME_REMINDER, title, body, data);
  }

  /**
   * 发送活动通知
   */
  async sendActivityNotification(activityId: string, title?: string, body?: string): Promise<void> {
    const activityTitle = title || 'New Activity';
    const activityBody = body || 'A new activity is now available! Check it out!';
    const data = {
      type: 'activity',
      activityId,
    };

    // 发送给所有用户
    await this.broadcast(activityTitle, activityBody, { platforms: [Platform.IOS, Platform.ANDROID, Platform.WEB] });

    // 记录日志
    await this.logPush(null, 'all', PushType.ACTIVITY, activityTitle, activityBody, data);
  }

  // ===== 队列处理 =====

  /**
   * 处理推送队列
   * 从Redis队列中取出任务并发送
   */
  async processPushQueue(): Promise<void> {
    const processingKey = `${this.redisQueueKey}:processing`;
    let processed = 0;
    const maxBatch = 100;

    while (processed < maxBatch) {
      // RPOPLPUSH 保证消息不丢失
      const jobJson = await this.redis.rpoplpush(this.redisQueueKey, processingKey);
      if (!jobJson) break;

      try {
        const job = JSON.parse(jobJson);
        await this.sendToProvider(job);
        processed++;

        // 处理完成后从processing列表删除
        await this.redis.lrem(processingKey, 0, jobJson);
      } catch (error) {
        this.logger.error(`Failed to send push: ${error.message}`, error.stack);

        // 失败重试：记录失败次数，超过3次丢弃
        const failCount = await this.redis.incr(`push:fail:${JSON.parse(jobJson).deviceToken}`);
        if (failCount >= 3) {
          await this.redis.lrem(processingKey, 0, jobJson);
          await this.redis.del(`push:fail:${JSON.parse(jobJson).deviceToken}`);
          // 标记设备可能失效
          await this.markDeviceInactive(JSON.parse(jobJson).deviceToken);
        } else {
          // 放回队列稍后重试
          await this.redis.lpush(this.redisQueueKey, jobJson);
          await this.redis.lrem(processingKey, 0, jobJson);
        }
      }
    }

    if (processed > 0) {
      this.logger.log(`Processed ${processed} push notifications`);
    }
  }

  /**
   * 根据平台发送到对应推送服务商
   */
  private async sendToProvider(job: any): Promise<void> {
    const { platform, deviceToken, title, body, data } = job;

    switch (platform) {
      case Platform.IOS:
        await this.sendAPNs(deviceToken, title, body, data);
        break;
      case Platform.ANDROID:
        await this.sendFCM(deviceToken, title, body, data);
        break;
      case Platform.WEB:
        await this.sendWebPush(deviceToken, title, body, data);
        break;
      default:
        this.logger.warn(`Unknown platform: ${platform}`);
    }
  }

  /**
   * APNs推送 (HTTP/2 API)
   * 使用限流防止超过APNs限制
   */
  private async sendAPNs(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    // 限流检查：APNs每分钟最多200,000条
    const currentMinute = Math.floor(Date.now() / 60000);
    const rateKey = `${this.apnsRateLimitKey}:${currentMinute}`;
    const count = await this.redis.incr(rateKey);
    if (count === 1) {
      await this.redis.expire(rateKey, 120); // 2分钟后过期
    }

    // 如果接近限流，延迟处理
    if (count > 180000) {
      this.logger.warn('APNs rate limit approaching, delaying push');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    try {
      // 使用node-apn或原生http2请求
      const jwt = await this.generateApnsJWT();
      const payload = {
        aps: {
          alert: { title, body },
          badge: 1,
          sound: 'default',
          'mutable-content': 1,
        },
        ...data,
      };

      const https = await import('https');
      const options = {
        hostname: this.apnsHost,
        port: 443,
        path: `/3/device/${deviceToken}`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apns-topic': this.apnsBundleId,
          'apns-push-type': 'alert',
          'Content-Type': 'application/json',
        },
      };

      await new Promise<void>((resolve, reject) => {
        const req = https.request(options, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
              reject(new Error(`APNs error ${res.statusCode}: ${responseData}`));
            });
          }
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
      });

      this.logger.debug(`APNs push sent to ${deviceToken.substring(0, 16)}...`);
    } catch (error) {
      this.logger.error(`APNs push failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * FCM推送
   */
  private async sendFCM(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    // 限流检查
    const currentMinute = Math.floor(Date.now() / 60000);
    const rateKey = `${this.fcmRateLimitKey}:${currentMinute}`;
    const count = await this.redis.incr(rateKey);
    if (count === 1) {
      await this.redis.expire(rateKey, 120);
    }

    try {
      const payload = {
        message: {
          token: deviceToken,
          notification: { title, body },
          data: data ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          ) : {},
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'chess_default',
            },
          },
        },
      };

      const https = await import('https');
      const options = {
        hostname: 'fcm.googleapis.com',
        port: 443,
        path: '/v1/projects/chess-platform/messages:send',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.fcmServerKey}`,
          'Content-Type': 'application/json',
        },
      };

      await new Promise<void>((resolve, reject) => {
        const req = https.request(options, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
              reject(new Error(`FCM error ${res.statusCode}: ${responseData}`));
            });
          }
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
      });

      this.logger.debug(`FCM push sent to ${deviceToken.substring(0, 16)}...`);
    } catch (error) {
      this.logger.error(`FCM push failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Web Push (VAPID)
   */
  private async sendWebPush(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    try {
      // deviceToken for web push is actually the PushSubscription JSON
      const subscription = JSON.parse(deviceToken);

      const payload = JSON.stringify({
        notification: {
          title,
          body,
          icon: '/assets/icon-192x192.png',
          badge: '/assets/badge-72x72.png',
          data: data || {},
          actions: data?.actions || [],
        },
      });

      // 使用web-push库
      const webPush = await import('web-push');
      webPush.default.setVapidDetails(
        this.vapidSubject,
        this.vapidPublicKey,
        this.vapidPrivateKey,
      );

      await webPush.default.sendNotification(subscription, payload);

      this.logger.debug('Web push sent successfully');
    } catch (error) {
      this.logger.error(`Web push failed: ${error.message}`);
      throw error;
    }
  }

  // ===== 辅助方法 =====

  /**
   * 生成APNs JWT Token
   */
  private async generateApnsJWT(): Promise<string> {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      {
        iss: this.apnsTeamId,
        iat: Math.floor(Date.now() / 1000),
      },
      this.apnsAuthKey,
      {
        algorithm: 'ES256',
        header: {
          kid: this.apnsKeyId,
        },
        expiresIn: 3000, // 50分钟有效期
      },
    );
    return token;
  }

  /**
   * 标记设备为失效
   */
  private async markDeviceInactive(deviceToken: string): Promise<void> {
    await this.deviceTokenRepository.update(
      { deviceToken },
      { isActive: false },
    );
    this.logger.log(`Device ${deviceToken.substring(0, 16)}... marked as inactive`);
  }

  /**
   * 记录推送日志
   */
  private async logPush(
    userId: number | null,
    platform: string,
    type: PushType,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const log = this.pushLogRepository.create({
      userId,
      platform,
      type,
      title,
      body,
      data: data || {},
      status: PushStatus.PENDING,
    });
    await this.pushLogRepository.save(log);
  }

  /**
   * 获取用户名
   */
  private async getUserName(userId: number): Promise<string> {
    const name = await this.redis.hget(`user:${userId}`, 'username');
    return name || `User_${userId}`;
  }

  /**
   * 获取推送统计
   */
  async getPushStats(startDate: Date, endDate: Date): Promise<{
    total: number;
    sent: number;
    failed: number;
    byPlatform: Record<string, number>;
  }> {
    const logs = await this.pushLogRepository
      .createQueryBuilder('log')
      .where('log.createdAt BETWEEN :start AND :end', { start: startDate, end: endDate })
      .getMany();

    const stats = {
      total: logs.length,
      sent: logs.filter((l) => l.status === PushStatus.SENT).length,
      failed: logs.filter((l) => l.status === PushStatus.FAILED).length,
      byPlatform: {} as Record<string, number>,
    };

    for (const log of logs) {
      stats.byPlatform[log.platform] = (stats.byPlatform[log.platform] || 0) + 1;
    }

    return stats;
  }
}
