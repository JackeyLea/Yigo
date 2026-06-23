/**
 * SocialGateway - 社交WebSocket网关
 * 处理实时聊天、好友在线状态、好友请求通知
 */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { FriendService } from './friend/friend.service';
import { ChatService } from './chat/chat.service';

interface ChatMessagePayload {
  toUserId: number;
  content: string;
  type?: 'text' | 'image';
}

interface RoomMessagePayload {
  roomId: string;
  content: string;
}

interface MarkReadPayload {
  fromUserId: number;
}

interface FriendActionPayload {
  targetUserId: number;
}

@WebSocketGateway({
  namespace: 'social',
  cors: {
    origin: '*',
  },
})
export class SocialGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SocialGateway.name);

  @WebSocketServer()
  server: Server;

  // 用户ID到Socket ID的映射
  private userSocketMap = new Map<number, string>();

  constructor(
    private readonly friendService: FriendService,
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const userId = this.extractUserId(client);
      if (!userId) {
        client.disconnect();
        return;
      }

      // 存储用户连接
      this.userSocketMap.set(userId, client.id);
      client.data.userId = userId;

      // 更新好友在线状态
      await this.friendService.updateOnlineStatus(userId, true);

      // 通知好友上线
      this.notifyFriendsOnlineStatus(userId, true);

      this.logger.log(`User connected: ${userId}, socket: ${client.id}`);
    } catch (error) {
      this.logger.error('Connection error:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    try {
      const userId = client.data.userId;
      if (!userId) return;

      // 移除用户连接
      this.userSocketMap.delete(userId);

      // 更新好友在线状态
      await this.friendService.updateOnlineStatus(userId, false);

      // 通知好友离线
      this.notifyFriendsOnlineStatus(userId, false);

      this.logger.log(`User disconnected: ${userId}`);
    } catch (error) {
      this.logger.error('Disconnect error:', error);
    }
  }

  /**
   * 发送私聊消息
   */
  @SubscribeMessage('chat:private')
  async handlePrivateMessage(
    @MessageBody() payload: ChatMessagePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = client.data.userId as number;

    try {
      const message = await this.chatService.sendMessage(
        userId,
        payload.toUserId,
        payload.content,
        payload.type || 'text',
      );

      // 发送给接收者
      this.sendToUser(payload.toUserId, 'chat:private:message', {
        messageId: message.message_id,
        fromUserId: userId,
        content: message.content,
        type: message.message_type,
        createdAt: message.created_at,
      });

      // 确认发送成功
      client.emit('chat:private:sent', {
        messageId: message.message_id,
        toUserId: payload.toUserId,
        status: 'sent',
      });
    } catch (error) {
      client.emit('chat:error', {
        type: 'private',
        error: error.message,
      });
    }
  }

  /**
   * 发送房间消息
   */
  @SubscribeMessage('chat:room')
  async handleRoomMessage(
    @MessageBody() payload: RoomMessagePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = client.data.userId as number;

    try {
      const message = await this.chatService.sendRoomMessage(
        userId,
        payload.roomId,
        payload.content,
      );

      // 广播到房间
      this.server.to(`room:${payload.roomId}`).emit('chat:room:message', {
        messageId: message.message_id,
        senderId: userId,
        roomId: payload.roomId,
        content: message.content,
        type: message.message_type,
        createdAt: message.created_at,
      });
    } catch (error) {
      client.emit('chat:error', {
        type: 'room',
        error: error.message,
      });
    }
  }

  /**
   * 标记消息已读
   */
  @SubscribeMessage('chat:markRead')
  async handleMarkRead(
    @MessageBody() payload: MarkReadPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = client.data.userId as number;

    try {
      await this.chatService.markAsRead(userId, payload.fromUserId);
      client.emit('chat:markRead:success', { fromUserId: payload.fromUserId });
    } catch (error) {
      client.emit('chat:error', {
        type: 'markRead',
        error: error.message,
      });
    }
  }

  /**
   * 加入房间
   */
  @SubscribeMessage('room:join')
  handleJoinRoom(
    @MessageBody() roomId: string,
    @ConnectedSocket() client: Socket,
  ): void {
    client.join(`room:${roomId}`);
    client.emit('room:joined', { roomId });
  }

  /**
   * 离开房间
   */
  @SubscribeMessage('room:leave')
  handleLeaveRoom(
    @MessageBody() roomId: string,
    @ConnectedSocket() client: Socket,
  ): void {
    client.leave(`room:${roomId}`);
    client.emit('room:left', { roomId });
  }

  /**
   * 发送好友请求
   */
  @SubscribeMessage('friend:request')
  async handleFriendRequest(
    @MessageBody() payload: FriendActionPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = client.data.userId as number;

    try {
      await this.friendService.sendFriendRequest(userId, payload.targetUserId);

      // 通知目标用户
      this.sendToUser(payload.targetUserId, 'friend:request:received', {
        fromUserId: userId,
      });

      client.emit('friend:request:sent', {
        toUserId: payload.targetUserId,
        status: 'pending',
      });
    } catch (error) {
      client.emit('friend:error', {
        action: 'request',
        error: error.message,
      });
    }
  }

  /**
   * 接受好友请求
   */
  @SubscribeMessage('friend:accept')
  async handleAcceptFriend(
    @MessageBody() payload: { requestId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = client.data.userId as number;

    try {
      await this.friendService.acceptFriendRequest(userId, payload.requestId);
      client.emit('friend:accept:success', { requestId: payload.requestId });
    } catch (error) {
      client.emit('friend:error', {
        action: 'accept',
        error: error.message,
      });
    }
  }

  /**
   * 拒绝好友请求
   */
  @SubscribeMessage('friend:reject')
  async handleRejectFriend(
    @MessageBody() payload: { requestId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = client.data.userId as number;

    try {
      await this.friendService.rejectFriendRequest(userId, payload.requestId);
      client.emit('friend:reject:success', { requestId: payload.requestId });
    } catch (error) {
      client.emit('friend:error', {
        action: 'reject',
        error: error.message,
      });
    }
  }

  /**
   * 获取未读消息数
   */
  @SubscribeMessage('chat:getUnread')
  async handleGetUnread(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = client.data.userId as number;

    try {
      const count = await this.chatService.getUnreadCount(userId);
      client.emit('chat:unreadCount', { count });
    } catch (error) {
      client.emit('chat:error', {
        type: 'getUnread',
        error: error.message,
      });
    }
  }

  /**
   * 发送给指定用户
   */
  private sendToUser(userId: number, event: string, data: any): void {
    const socketId = this.userSocketMap.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  /**
   * 通知好友在线状态变化
   */
  private notifyFriendsOnlineStatus(userId: number, isOnline: boolean): void {
    // 通过广播方式通知，实际应用中可通过Redis获取好友列表定向推送
    this.server.emit('friend:statusChange', {
      userId,
      isOnline,
    });
  }

  /**
   * 从Socket连接中提取用户ID
   */
  private extractUserId(client: Socket): number | null {
    // 从auth token中解析用户ID
    const token = client.handshake.auth?.token as string;
    if (!token) {
      // 尝试从query获取
      const userId = client.handshake.query?.userId;
      if (userId) {
        return Number(userId);
      }
      return null;
    }

    // 实际应从token解析，这里简化处理
    try {
      // JWT解析逻辑由AuthGuard处理
      const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return decoded.sub ? Number(decoded.sub) : null;
    } catch {
      return null;
    }
  }
}
