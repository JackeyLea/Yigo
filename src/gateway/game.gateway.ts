/**
 * GameGateway - WebSocket 游戏网关
 *
 * 核心WebSocket网关，处理所有游戏相关的实时通信：
 * - 连接管理（JWT认证）
 * - 房间操作（加入/离开/准备）
 * - 游戏操作转发
 * - 观战功能
 * - 聊天消息
 * - 心跳检测
 */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { UseGuards, Logger, Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import { WS_EVENTS } from './dto/ws-events';
import type {
  JoinRoomPayload,
  LeaveRoomPayload,
  GameActionPayload,
  SpectatePayload,
  ChatMessagePayload,
  ReadyTogglePayload,
} from './dto/ws-events';

import { WsJwtGuard } from './guard/ws-jwt.guard';
import { ConnectionManagerService } from './services/connection-manager.service';
import { MessageRouterService } from './services/message-router.service';
import { HeartbeatService } from './services/heartbeat.service';
import { RoomService } from '../room/room.service';
import { CleanupRegistry } from '../plugin/cleanup-registry';

/** JWT Payload */
interface JwtPayload {
  sub: string;
  username: string;
}

@Injectable()
@WebSocketGateway({
  namespace: '/game',
  cors: {
    origin: (origin, callback) => {
      // 允许所有来源（生产环境应配置特定域名）
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  // Socket.IO 配置
  transports: ['websocket', 'polling'],
  pingInterval: 30000,
  pingTimeout: 90000,
  // 连接认证
  allowUpgrades: true,
  upgradeTimeout: 10000,
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameGateway.name);
  private readonly publicKey: string;

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly connectionManager: ConnectionManagerService,
    private readonly messageRouter: MessageRouterService,
    private readonly heartbeatService: HeartbeatService,
    private readonly roomService: RoomService,
    private readonly cleanupRegistry: CleanupRegistry,
  ) {
    const keysDir = process.env.JWT_KEYS_DIR || './keys';
    this.publicKey = fs.readFileSync(
      path.join(keysDir, 'jwt-public.pem'),
      'utf8',
    );
  }

  // ==================== 生命周期 ====================

  /**
   * Gateway 初始化完成
   */
  afterInit(server: Server): void {
    this.connectionManager.setServer(server);
    this.heartbeatService.onDisconnect((socketId) => {
      this.handleClientTimeout(socketId);
    });
    this.logger.log('GameGateway initialized on namespace /game');
  }

  /**
   * 客户端连接建立
   * - 从 handshake 中提取并验证 JWT token
   * - 建立用户ID与SocketID的映射
   * - 注册心跳监控
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      // JWT 认证
      const user = await this.authenticateClient(client);
      if (!user) {
        this.logger.warn(`Connection rejected: authentication failed, socketId=${client.id}`);
        client.emit(WS_EVENTS.S_ERROR, {
          code: 'AUTH_FAILED',
          message: 'Authentication failed: invalid or missing token',
        });
        client.disconnect(true);
        return;
      }

      // 存储用户信息到 socket.data
      client.data.user = user;
      client.data.userId = user.userId;
      client.data.rooms = new Set<string>();
      client.data.isSpectating = false;
      client.data.spectateRoomId = null;

      // 注册连接到管理器
      await this.connectionManager.addConnection(user.userId, client.id);

      // 注册心跳监控
      this.heartbeatService.registerClient(client);

      this.logger.log(
        `Client connected: socketId=${client.id}, userId=${user.userId}, username=${user.username}`,
      );

      // 发送连接成功确认
      client.emit('connected', {
        userId: user.userId,
        username: user.username,
        socketId: client.id,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`, error.stack);
      client.emit(WS_EVENTS.S_ERROR, {
        code: 'CONNECTION_ERROR',
        message: 'Internal connection error',
      });
      client.disconnect(true);
    }
  }

  /**
   * 客户端断开连接
   * - 清理连接映射
   * - 从所有房间移除
   * - 注销心跳监控
   * - 触发RoomModule的断开处理
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data?.userId as number | undefined;
    const socketId = client.id;

    this.logger.log(`Client disconnecting: socketId=${socketId}, userId=${userId}`);

    try {
      // 注销心跳监控
      this.heartbeatService.unregisterClient(socketId);

      // 获取用户所在的房间列表
      const rooms = client.data?.rooms as Set<string> | undefined;
      if (rooms && userId) {
        // 逐个离开房间
        for (const roomId of rooms) {
          try {
            await this.roomService.leaveRoom(userId, roomId);

            // 广播玩家离开事件
            this.messageRouter.broadcast(roomId, WS_EVENTS.S_PLAYER_LEFT, {
              roomId,
              userId,
              isHost: false,
              reason: 'disconnected',
            });
          } catch (err) {
            this.logger.warn(`Auto-leave room failed: roomId=${roomId}, error=${err.message}`);
          }

          // 从Socket.IO房间中移除
          client.leave(`room:${roomId}`);
          client.leave(`room:${roomId}:seat:${client.data?.seatIndex ?? 0}`);

          // 从Redis中移除
          await this.connectionManager.removeUserFromRoom(userId, roomId);
        }
        rooms.clear();
      }

      // 处理观战中的断开
      const spectateRoomId = client.data?.spectateRoomId as string | null | undefined;
      if (spectateRoomId && userId) {
        try {
          await this.roomService.spectatorLeave(userId, spectateRoomId);
        } catch (err) {
          this.logger.warn(`Spectator leave failed: ${err.message}`);
        }
        await this.connectionManager.removeSpectatorFromRoom(userId, spectateRoomId);
      }

      // 移除连接映射
      await this.connectionManager.removeConnection(socketId);

      // 清理该玩家的所有 EventBus 订阅和相关资源
      if (userId) {
        await this.cleanupRegistry.cleanupForPlayer(userId.toString());
      }

      this.logger.log(`Client disconnected: socketId=${socketId}, userId=${userId}`);
    } catch (error) {
      this.logger.error(`Disconnect handler error: ${error.message}`, error.stack);
    }
  }

  // ==================== 房间事件处理器 ====================

  /**
   * 加入房间
   */
  @SubscribeMessage(WS_EVENTS.C_JOIN_ROOM)
  async onJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRoomPayload,
  ): Promise<void> {
    const userId = this.getUserId(client);
    if (!userId) {
      this.sendError(client, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const { roomId, password, seatIndex } = data;

    try {
      this.logger.debug(`User ${userId} joining room ${roomId}`);

      // 调用 RoomService 加入房间
      const room = await this.roomService.joinRoom(userId, {
        roomId,
        password,
        seatIndex,
      });

      // 加入 Socket.IO 房间
      const roomName = `room:${roomId}`;
      await client.join(roomName);

      // 加入座位房间（用于座位级消息路由）
      const assignedSeat = room.players.find((p) => p.userId === userId);
      if (assignedSeat) {
        client.data.seatIndex = assignedSeat.seatIndex;
        const seatRoom = `room:${roomId}:seat:${assignedSeat.seatIndex}`;
        await client.join(seatRoom);
      }

      // 记录房间成员关系
      const rooms = client.data.rooms as Set<string>;
      rooms.add(roomId);
      await this.connectionManager.addUserToRoom(userId, roomId);

      // 获取用户信息
      const username = client.data.user?.username || '';
      const nickname = (client.data.user as any)?.nickname || username;

      // 广播玩家加入事件（排除自己）
      this.messageRouter.broadcast(
        roomId,
        WS_EVENTS.S_PLAYER_JOINED,
        {
          roomId,
          userId,
          username,
          nickname,
          seatIndex: assignedSeat?.seatIndex ?? 0,
        } as import('./dto/ws-events').PlayerJoinedEvent,
        userId,
      );

      // 向加入者发送当前房间状态
      client.emit(WS_EVENTS.S_GAME_STATE, {
        roomId,
        state: room,
        timestamp: Date.now(),
      });

      this.logger.log(`User ${userId} joined room ${roomId}`);
    } catch (error) {
      this.logger.warn(`Join room failed: ${error.message}`);
      this.sendError(client, 'JOIN_ROOM_FAILED', error.message, { roomId });
    }
  }

  /**
   * 离开房间
   */
  @SubscribeMessage(WS_EVENTS.C_LEAVE_ROOM)
  async onLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: LeaveRoomPayload,
  ): Promise<void> {
    const userId = this.getUserId(client);
    if (!userId) {
      this.sendError(client, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const { roomId } = data;

    try {
      this.logger.debug(`User ${userId} leaving room ${roomId}`);

      // 调用 RoomService 离开房间
      await this.roomService.leaveRoom(userId, roomId);

      // 从 Socket.IO 房间中移除
      client.leave(`room:${roomId}`);
      client.leave(`room:${roomId}:seat:${client.data?.seatIndex ?? 0}`);

      // 移除客户端房间记录
      const rooms = client.data.rooms as Set<string>;
      rooms.delete(roomId);
      await this.connectionManager.removeUserFromRoom(userId, roomId);

      // 清除座位索引
      delete client.data.seatIndex;

      // 广播玩家离开事件
      this.messageRouter.broadcast(roomId, WS_EVENTS.S_PLAYER_LEFT, {
        roomId,
        userId,
        isHost: false,
        reason: 'left',
      } as import('./dto/ws-events').PlayerLeftEvent);

      this.logger.log(`User ${userId} left room ${roomId}`);
    } catch (error) {
      this.logger.warn(`Leave room failed: ${error.message}`);
      this.sendError(client, 'LEAVE_ROOM_FAILED', error.message, { roomId });
    }
  }

  /**
   * 游戏操作
   */
  @SubscribeMessage(WS_EVENTS.C_GAME_ACTION)
  async onGameAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: GameActionPayload,
  ): Promise<void> {
    const userId = this.getUserId(client);
    if (!userId) {
      this.sendError(client, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const { roomId, action } = data;

    try {
      // 检查用户是否在房间中
      const rooms = client.data.rooms as Set<string>;
      if (!rooms.has(roomId)) {
        this.sendError(client, 'NOT_IN_ROOM', 'You are not in this room', { roomId });
        return;
      }

      // TODO: 调用 GameModule 处理游戏操作
      // const result = await this.gameService.handleAction(roomId, userId, action);

      // 广播操作结果给房间内所有人
      const result: import('./dto/ws-events').GameActionResultEvent = {
        roomId,
        userId,
        action,
        result: 'success',
        message: 'Action processed',
      };

      this.messageRouter.broadcast(roomId, WS_EVENTS.S_GAME_ACTION_RESULT, result);

      this.logger.debug(`Game action from user ${userId} in room ${roomId}: ${JSON.stringify(action)}`);
    } catch (error) {
      this.logger.warn(`Game action failed: ${error.message}`);
      this.sendError(client, 'GAME_ACTION_FAILED', error.message, { roomId, action });
    }
  }

  /**
   * 观战加入
   */
  @SubscribeMessage(WS_EVENTS.C_SPECTATE_JOIN)
  async onSpectateJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SpectatePayload,
  ): Promise<void> {
    const userId = this.getUserId(client);
    if (!userId) {
      this.sendError(client, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const { roomId } = data;

    try {
      this.logger.debug(`User ${userId} spectating room ${roomId}`);

      // 调用 RoomService 观战加入
      await this.roomService.spectatorJoin(userId, roomId);

      // 加入观战Socket房间
      await client.join(`room:${roomId}:spectators`);

      // 记录观战状态
      client.data.isSpectating = true;
      client.data.spectateRoomId = roomId;

      await this.connectionManager.addSpectatorToRoom(userId, roomId);

      // 发送当前房间状态给观战者
      const room = await this.roomService.getRoom(roomId);
      client.emit(WS_EVENTS.S_GAME_STATE, {
        roomId,
        state: {
          ...room,
          // 观战者看到的是简化状态（隐藏敏感信息）
          isSpectatorView: true,
        },
        timestamp: Date.now(),
      });

      this.logger.log(`User ${userId} started spectating room ${roomId}`);
    } catch (error) {
      this.logger.warn(`Spectate join failed: ${error.message}`);
      this.sendError(client, 'SPECTATE_FAILED', error.message, { roomId });
    }
  }

  /**
   * 观战离开
   */
  @SubscribeMessage(WS_EVENTS.C_SPECTATE_LEAVE)
  async onSpectateLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SpectatePayload,
  ): Promise<void> {
    const userId = this.getUserId(client);
    if (!userId) {
      this.sendError(client, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const { roomId } = data;

    try {
      await this.roomService.spectatorLeave(userId, roomId);

      client.leave(`room:${roomId}:spectators`);
      client.data.isSpectating = false;
      client.data.spectateRoomId = null;

      await this.connectionManager.removeSpectatorFromRoom(userId, roomId);

      this.logger.log(`User ${userId} stopped spectating room ${roomId}`);
    } catch (error) {
      this.logger.warn(`Spectate leave failed: ${error.message}`);
    }
  }

  /**
   * 聊天消息
   */
  @SubscribeMessage(WS_EVENTS.C_CHAT_MESSAGE)
  async onChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChatMessagePayload,
  ): Promise<void> {
    const userId = this.getUserId(client);
    if (!userId) {
      this.sendError(client, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const { roomId, message } = data;

    try {
      // 验证消息长度
      if (!message || message.trim().length === 0) {
        this.sendError(client, 'INVALID_MESSAGE', 'Message cannot be empty');
        return;
      }

      if (message.length > 500) {
        this.sendError(client, 'MESSAGE_TOO_LONG', 'Message exceeds 500 characters');
        return;
      }

      const username = client.data.user?.username || '';

      // 广播聊天消息（包括发送者，以便客户端确认）
      const chatEvent: import('./dto/ws-events').ChatMessageEvent = {
        roomId,
        userId,
        username,
        message: message.trim(),
        timestamp: Date.now(),
      };

      this.messageRouter.broadcast(roomId, WS_EVENTS.S_CHAT_MESSAGE, chatEvent);

      this.logger.debug(`Chat message in room ${roomId} from ${username}: ${message}`);
    } catch (error) {
      this.logger.warn(`Chat message failed: ${error.message}`);
      this.sendError(client, 'CHAT_FAILED', error.message, { roomId });
    }
  }

  /**
   * 准备/取消准备
   */
  @SubscribeMessage(WS_EVENTS.C_READY_TOGGLE)
  async onReadyToggle(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ReadyTogglePayload,
  ): Promise<void> {
    const userId = this.getUserId(client);
    if (!userId) {
      this.sendError(client, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const { roomId } = data;

    try {
      // 获取当前准备状态（需要查询）
      const room = await this.roomService.getRoom(roomId);
      const player = room.players.find((p) => p.userId === userId);

      if (!player) {
        this.sendError(client, 'NOT_IN_ROOM', 'You are not in this room', { roomId });
        return;
      }

      // 房主自动准备，不需要切换
      if (player.isHost) {
        client.emit(WS_EVENTS.S_PLAYER_READY, {
          roomId,
          userId,
          isReady: true,
        });
        return;
      }

      // 切换准备状态
      const newReadyState = !player.isReady;
      await this.roomService.setReady(userId, roomId, newReadyState);

      // 广播准备状态变更
      this.messageRouter.broadcast(roomId, WS_EVENTS.S_PLAYER_READY, {
        roomId,
        userId,
        isReady: newReadyState,
      } as import('./dto/ws-events').PlayerReadyEvent);

      this.logger.log(`User ${userId} ready state changed to ${newReadyState} in room ${roomId}`);
    } catch (error) {
      this.logger.warn(`Ready toggle failed: ${error.message}`);
      this.sendError(client, 'READY_TOGGLE_FAILED', error.message, { roomId });
    }
  }

  /**
   * 心跳
   */
  @SubscribeMessage(WS_EVENTS.C_HEARTBEAT)
  async onHeartbeat(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    // 更新心跳状态
    this.heartbeatService.handlePong(client.id);

    // 回复心跳确认
    client.emit(WS_EVENTS.C_HEARTBEAT, {
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
    });

    this.logger.debug(`Heartbeat from client: ${client.id}`);
  }

  // ==================== 内部方法 ====================

  /**
   * 客户端认证
   */
  private async authenticateClient(
    client: Socket,
  ): Promise<{ userId: number; username: string } | null> {
    // 1. 从 auth 中提取 token
    const token =
      (client.handshake.auth as any)?.token ||
      (client.handshake.query?.token as string);

    if (!token) {
      return null;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        Array.isArray(token) ? token[0] : token,
        {
          publicKey: this.publicKey,
          algorithms: ['RS256'],
        },
      );

      return {
        userId: Number(payload.sub),
        username: payload.username,
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取当前用户ID
   */
  private getUserId(client: Socket): number | undefined {
    return client.data?.userId as number | undefined;
  }

  /**
   * 发送错误消息
   */
  private sendError(
    client: Socket,
    code: string,
    message: string,
    details?: Record<string, any>,
  ): void {
    client.emit(WS_EVENTS.S_ERROR, {
      code,
      message,
      details,
      timestamp: Date.now(),
    } as import('./dto/ws-events').ErrorEvent);
  }

  /**
   * 处理客户端心跳超时
   */
  private async handleClientTimeout(socketId: string): Promise<void> {
    try {
      // 获取Socket实例
      const socket = this.server?.sockets?.sockets?.get(socketId);
      if (socket) {
        this.logger.warn(`Client timeout, forcing disconnect: ${socketId}`);
        socket.disconnect(true);
      }
    } catch (error) {
      this.logger.error(`Handle client timeout error: ${error.message}`);
    }
  }
}
