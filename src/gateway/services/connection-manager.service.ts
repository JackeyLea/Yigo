/**
 * ConnectionManagerService - 连接管理服务
 *
 * 管理所有WebSocket连接的映射关系，使用Redis存储以支持多实例部署。
 * 提供用户ID与SocketID的双向查找、在线状态检测、房间广播和单播功能。
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import Redis from 'ioredis';

/** Redis 键前缀 */
const REDIS_KEY = {
  USER_SOCKET: (userId: number) => `conn:user:${userId}`,
  SOCKET_USER: (socketId: string) => `conn:socket:${socketId}`,
  USER_ROOM: (userId: number) => `user:room:${userId}`,
  ROOM_USERS: (roomId: string) => `room:users:${roomId}`,
  ROOM_SPECTATORS: (roomId: string) => `room:spectators:${roomId}`,
};

/** 连接映射 TTL（秒）- 7天 */
const CONN_TTL = 60 * 60 * 24 * 7;

@Injectable()
export class ConnectionManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionManagerService.name);
  private readonly redis: Redis;
  private ioServer: Server | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisConfig = this.configService.get('redis');
    this.redis = new Redis({
      host: redisConfig?.host || 'localhost',
      port: redisConfig?.port || 6379,
      password: redisConfig?.password || undefined,
      db: redisConfig?.db || 0,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error:', err.message);
    });
  }

  /**
   * 设置 Socket.IO Server 实例（用于广播）
   */
  setServer(server: Server): void {
    this.ioServer = server;
  }

  /**
   * 获取 Socket.IO Server 实例
   */
  getServer(): Server | null {
    return this.ioServer;
  }

  // ==================== 连接管理 ====================

  /**
   * 添加连接映射
   * @param userId - 用户ID
   * @param socketId - Socket连接ID
   */
  async addConnection(userId: number, socketId: string): Promise<void> {
    try {
      // 双向映射，使用Pipeline批量执行
      const pipeline = this.redis.pipeline();
      pipeline.setex(REDIS_KEY.USER_SOCKET(userId), CONN_TTL, socketId);
      pipeline.setex(REDIS_KEY.SOCKET_USER(socketId), CONN_TTL, String(userId));
      await pipeline.exec();

      this.logger.debug(`Connection added: userId=${userId}, socketId=${socketId}`);
    } catch (error) {
      this.logger.error(`Failed to add connection: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 移除连接映射
   * @param socketId - Socket连接ID
   */
  async removeConnection(socketId: string): Promise<number | undefined> {
    try {
      // 先获取用户ID
      const userIdStr = await this.redis.get(REDIS_KEY.SOCKET_USER(socketId));
      const userId = userIdStr ? Number(userIdStr) : undefined;

      // 删除双向映射
      const pipeline = this.redis.pipeline();
      if (userId !== undefined) {
        pipeline.del(REDIS_KEY.USER_SOCKET(userId));
      }
      pipeline.del(REDIS_KEY.SOCKET_USER(socketId));
      await pipeline.exec();

      this.logger.debug(`Connection removed: socketId=${socketId}, userId=${userId}`);
      return userId;
    } catch (error) {
      this.logger.error(`Failed to remove connection: ${error.message}`, error.stack);
      return undefined;
    }
  }

  /**
   * 根据用户ID获取SocketID
   * @param userId - 用户ID
   * @returns Socket连接ID，不在线返回undefined
   */
  async getSocketId(userId: number): Promise<string | undefined> {
    try {
      const socketId = await this.redis.get(REDIS_KEY.USER_SOCKET(userId));
      return socketId || undefined;
    } catch (error) {
      this.logger.error(`Failed to get socketId: ${error.message}`);
      return undefined;
    }
  }

  /**
   * 根据SocketID获取用户ID
   * @param socketId - Socket连接ID
   * @returns 用户ID，未找到返回undefined
   */
  async getUserId(socketId: string): Promise<number | undefined> {
    try {
      const userIdStr = await this.redis.get(REDIS_KEY.SOCKET_USER(socketId));
      return userIdStr ? Number(userIdStr) : undefined;
    } catch (error) {
      this.logger.error(`Failed to get userId: ${error.message}`);
      return undefined;
    }
  }

  /**
   * 检查用户是否在线
   * @param userId - 用户ID
   */
  async isOnline(userId: number): Promise<boolean> {
    const socketId = await this.getSocketId(userId);
    return !!socketId;
  }

  // ==================== 房间管理 ====================

  /**
   * 将用户加入房间集合
   */
  async addUserToRoom(userId: number, roomId: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      // 添加到房间用户集合
      pipeline.sadd(REDIS_KEY.ROOM_USERS(roomId), String(userId));
      // 记录用户当前所在房间
      pipeline.setex(REDIS_KEY.USER_ROOM(userId), CONN_TTL, roomId);
      await pipeline.exec();
    } catch (error) {
      this.logger.error(`Failed to add user to room: ${error.message}`);
    }
  }

  /**
   * 将用户从房间集合移除
   */
  async removeUserFromRoom(userId: number, roomId: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.srem(REDIS_KEY.ROOM_USERS(roomId), String(userId));
      pipeline.del(REDIS_KEY.USER_ROOM(userId));
      await pipeline.exec();
    } catch (error) {
      this.logger.error(`Failed to remove user from room: ${error.message}`);
    }
  }

  /**
   * 获取房间内的所有用户ID
   */
  async getRoomUsers(roomId: string): Promise<number[]> {
    try {
      const members = await this.redis.smembers(REDIS_KEY.ROOM_USERS(roomId));
      return members.map(Number);
    } catch (error) {
      this.logger.error(`Failed to get room users: ${error.message}`);
      return [];
    }
  }

  /**
   * 将观战者加入房间
   */
  async addSpectatorToRoom(userId: number, roomId: string): Promise<void> {
    try {
      await this.redis.sadd(REDIS_KEY.ROOM_SPECTATORS(roomId), String(userId));
    } catch (error) {
      this.logger.error(`Failed to add spectator: ${error.message}`);
    }
  }

  /**
   * 将观战者从房间移除
   */
  async removeSpectatorFromRoom(userId: number, roomId: string): Promise<void> {
    try {
      await this.redis.srem(REDIS_KEY.ROOM_SPECTATORS(roomId), String(userId));
    } catch (error) {
      this.logger.error(`Failed to remove spectator: ${error.message}`);
    }
  }

  /**
   * 获取用户当前所在的房间ID
   */
  async getUserRoom(userId: number): Promise<string | undefined> {
    try {
      const roomId = await this.redis.get(REDIS_KEY.USER_ROOM(userId));
      return roomId || undefined;
    } catch (error) {
      this.logger.error(`Failed to get user room: ${error.message}`);
      return undefined;
    }
  }

  // ==================== 消息发送 ====================

  /**
   * 广播消息到房间内所有成员（通过Socket.IO Room）
   * @param roomId - 房间ID
   * @param event - 事件名称
   * @param payload - 消息负载
   */
  broadcastToRoom(roomId: string, event: string, payload: any): void {
    if (!this.ioServer) {
      this.logger.warn('Socket.IO server not set, cannot broadcast to room');
      return;
    }

    const roomName = `room:${roomId}`;
    this.ioServer.to(roomName).emit(event, payload);
    this.logger.debug(`Broadcast to ${roomName}: ${event}`);
  }

  /**
   * 发送消息到指定用户
   * @param userId - 用户ID
   * @param event - 事件名称
   * @param payload - 消息负载
   */
  async sendToUser(userId: number, event: string, payload: any): Promise<void> {
    if (!this.ioServer) {
      this.logger.warn('Socket.IO server not set, cannot send to user');
      return;
    }

    const socketId = await this.getSocketId(userId);
    if (!socketId) {
      this.logger.debug(`User ${userId} is offline, cannot send message`);
      return;
    }

    this.ioServer.to(socketId).emit(event, payload);
    this.logger.debug(`Sent to user ${userId}: ${event}`);
  }

  /**
   * 发送消息到多个用户（组播）
   * @param userIds - 用户ID数组
   * @param event - 事件名称
   * @param payload - 消息负载
   */
  async sendToUsers(userIds: number[], event: string, payload: any): Promise<void> {
    if (!this.ioServer || userIds.length === 0) {
      return;
    }

    const socketIds: string[] = [];
    for (const userId of userIds) {
      const socketId = await this.getSocketId(userId);
      if (socketId) {
        socketIds.push(socketId);
      }
    }

    if (socketIds.length > 0) {
      this.ioServer.to(socketIds).emit(event, payload);
      this.logger.debug(`Multicast to ${socketIds.length} users: ${event}`);
    }
  }

  /**
   * 发送消息到指定座位（通过Socket Room）
   * @param roomId - 房间ID
   * @param seatIndex - 座位号
   * @param event - 事件名称
   * @param payload - 消息负载
   */
  sendToSeat(roomId: string, seatIndex: number, event: string, payload: any): void {
    if (!this.ioServer) {
      return;
    }

    const seatRoom = `room:${roomId}:seat:${seatIndex}`;
    this.ioServer.to(seatRoom).emit(event, payload);
  }

  // ==================== 生命周期 ====================

  onModuleDestroy(): void {
    this.redis?.disconnect();
    this.logger.log('ConnectionManagerService destroyed');
  }
}
