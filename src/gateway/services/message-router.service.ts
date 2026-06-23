/**
 * MessageRouterService - 消息路由服务
 *
 * 根据消息类型将消息路由到对应的处理器，确保房间隔离。
 * 支持广播（房间内所有人）、组播（指定座位）、单播（指定用户）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConnectionManagerService } from './connection-manager.service';

/** 消息路由模式 */
export enum RoutingMode {
  /** 广播 - 房间内所有成员 */
  BROADCAST = 'broadcast',
  /** 组播 - 指定座位 */
  MULTICAST = 'multicast',
  /** 单播 - 指定用户 */
  UNICAST = 'unicast',
  /** 排除发送者的广播 */
  BROADCAST_EXCLUDE_SELF = 'broadcast_exclude_self',
}

/** 路由消息结构 */
export interface RoutedMessage {
  /** 房间ID */
  roomId: string;
  /** 事件名称 */
  event: string;
  /** 消息负载 */
  payload: any;
  /** 路由模式 */
  mode: RoutingMode;
  /** 发送者用户ID（用于排除自身） */
  senderId?: number;
  /** 目标用户ID列表（单播/组播时使用） */
  targetUserIds?: number[];
  /** 目标座位号列表（组播时使用） */
  targetSeats?: number[];
}

@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);

  constructor(
    private readonly connectionManager: ConnectionManagerService,
  ) {}

  /**
   * 路由消息到目标接收者
   * @param message - 路由消息
   */
  async route(message: RoutedMessage): Promise<void> {
    const { roomId, event, payload, mode, senderId, targetUserIds, targetSeats } = message;

    try {
      switch (mode) {
        case RoutingMode.BROADCAST:
          await this.handleBroadcast(roomId, event, payload);
          break;

        case RoutingMode.BROADCAST_EXCLUDE_SELF:
          await this.handleBroadcastExcludeSelf(roomId, event, payload, senderId);
          break;

        case RoutingMode.MULTICAST:
          await this.handleMulticast(roomId, event, payload, targetUserIds, targetSeats);
          break;

        case RoutingMode.UNICAST:
          await this.handleUnicast(event, payload, targetUserIds);
          break;

        default:
          this.logger.warn(`Unknown routing mode: ${mode}`);
      }
    } catch (error) {
      this.logger.error(`Message routing failed: ${error.message}`, error.stack);
    }
  }

  /**
   * 广播消息到房间内所有成员（包括观战者）
   */
  private async handleBroadcast(
    roomId: string,
    event: string,
    payload: any,
  ): Promise<void> {
    this.connectionManager.broadcastToRoom(roomId, event, payload);
    this.logger.debug(`Broadcast to room ${roomId}: ${event}`);
  }

  /**
   * 广播消息到房间内除发送者外的所有成员
   */
  private async handleBroadcastExcludeSelf(
    roomId: string,
    event: string,
    payload: any,
    senderId?: number,
  ): Promise<void> {
    if (!senderId) {
      // 没有发送者ID，退化为普通广播
      this.connectionManager.broadcastToRoom(roomId, event, payload);
      return;
    }

    // 获取房间内所有用户
    const roomUsers = await this.connectionManager.getRoomUsers(roomId);
    const targetUsers = roomUsers.filter((uid) => uid !== senderId);

    // 获取观战者并加入目标列表
    const spectators = await this.connectionManager.getRoomUsers(`${roomId}:spectators`);
    const allTargets = [...new Set([...targetUsers, ...spectators])].filter(
      (uid) => uid !== senderId,
    );

    if (allTargets.length > 0) {
      await this.connectionManager.sendToUsers(allTargets, event, payload);
    }

    this.logger.debug(
      `Broadcast(exclude self) to room ${roomId}: ${event}, targets=${allTargets.length}`,
    );
  }

  /**
   * 组播消息到指定用户或座位
   */
  private async handleMulticast(
    roomId: string,
    event: string,
    payload: any,
    targetUserIds?: number[],
    targetSeats?: number[],
  ): Promise<void> {
    const recipients = new Set<number>();

    // 添加指定用户
    if (targetUserIds && targetUserIds.length > 0) {
      for (const uid of targetUserIds) {
        recipients.add(uid);
      }
    }

    // 通过座位号查找对应用户
    if (targetSeats && targetSeats.length > 0) {
      for (const seatIndex of targetSeats) {
        // 通过seat room查找socket
        const server = this.connectionManager.getServer();
        if (server) {
          const seatRoomName = `room:${roomId}:seat:${seatIndex}`;
          const sockets = await server.in(seatRoomName).fetchSockets();
          for (const socket of sockets) {
            // 从socket.data中获取userId
            const userId = socket.data?.userId as number | undefined;
            if (userId) {
              recipients.add(userId);
            }
          }
        }
      }
    }

    if (recipients.size > 0) {
      await this.connectionManager.sendToUsers(Array.from(recipients), event, payload);
    }

    this.logger.debug(
      `Multicast to room ${roomId}: ${event}, recipients=${recipients.size}`,
    );
  }

  /**
   * 单播消息到指定用户
   */
  private async handleUnicast(
    event: string,
    payload: any,
    targetUserIds?: number[],
  ): Promise<void> {
    if (!targetUserIds || targetUserIds.length === 0) {
      return;
    }

    for (const userId of targetUserIds) {
      await this.connectionManager.sendToUser(userId, event, payload);
    }

    this.logger.debug(`Unicast to ${targetUserIds.length} users: ${event}`);
  }

  /**
   * 便捷方法：广播到房间
   */
  broadcast(roomId: string, event: string, payload: any, excludeUserId?: number): void {
    if (excludeUserId !== undefined) {
      this.route({
        roomId,
        event,
        payload,
        mode: RoutingMode.BROADCAST_EXCLUDE_SELF,
        senderId: excludeUserId,
      });
    } else {
      this.connectionManager.broadcastToRoom(roomId, event, payload);
    }
  }

  /**
   * 便捷方法：发送给单个用户
   */
  async unicast(userId: number, event: string, payload: any): Promise<void> {
    await this.connectionManager.sendToUser(userId, event, payload);
  }

  /**
   * 便捷方法：发送给多个用户
   */
  async multicast(userIds: number[], event: string, payload: any): Promise<void> {
    await this.connectionManager.sendToUsers(userIds, event, payload);
  }
}
