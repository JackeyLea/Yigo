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
import { VoiceService } from './voice.service';
import {
  VoiceJoinPayload,
  VoiceLeavePayload,
  VoiceMutePayload,
  VoiceParticipantInfo,
} from './voice.types';

/**
 * Voice Gateway - WebSocket control interface for voice operations.
 *
 * Events emitted:
 * - `voice:state`        - Current voice state after join/leave
 * - `voice:user-joined`  - Another user joined the channel
 * - `voice:user-left`    - Another user left the channel
 * - `voice:user-muted`   - A user was muted
 * - `voice:user-unmuted` - A user was unmuted
 * - `voice:speaking`     - Speaking state changed
 * - `voice:error`        - Error occurred
 */
@WebSocketGateway({
  namespace: '/voice',
  cors: { origin: '*' },
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly voiceService: VoiceService) {}

  // ─── Connection Lifecycle ───────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    const userId = this.extractUserId(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    this.logger.log(`Voice client connected: userId=${userId}, socketId=${client.id}`);
    (client as any).userId = userId;
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = (client as any).userId;
    if (!userId) return;

    this.logger.log(`Voice client disconnected: userId=${userId}, socketId=${client.id}`);

    // Leave all voice channels this user was in
    const channels = await this.voiceService.getUserChannels(userId);
    for (const roomId of channels) {
      try {
        await this.voiceService.leaveVoiceChannel(roomId, userId);
        client.to(`voice_${roomId}`).emit('voice:user-left', {
          userId,
          roomId,
        });
      } catch {
        // Ignore errors on disconnect
      }
    }
  }

  // ─── Voice Events ───────────────────────────────────────────────────

  /**
   * Join a voice channel.
   * Client emits: `voice:join` with { roomId }
   * Server responds: `voice:state` with token and participant list
   */
  @SubscribeMessage('voice:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: VoiceJoinPayload,
  ): Promise<any> {
    const userId = (client as any).userId;
    const { roomId } = payload;

    try {
      const token = await this.voiceService.joinVoiceChannel(roomId, userId);
      const state = await this.voiceService.getVoiceState(roomId, userId);

      // Join the socket room for this voice channel
      client.join(`voice_${roomId}`);

      // Notify other participants
      client.to(`voice_${roomId}`).emit('voice:user-joined', {
        userId,
        username: `User_${userId}`,
        roomId,
      });

      return {
        event: 'voice:state',
        data: {
          ...state,
          token,
        },
      };
    } catch (error: any) {
      this.logger.warn(`voice:join failed for user ${userId}: ${error.message}`);
      return {
        event: 'voice:error',
        data: { message: error.message, roomId },
      };
    }
  }

  /**
   * Leave a voice channel.
   * Client emits: `voice:leave` with { roomId }
   */
  @SubscribeMessage('voice:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: VoiceLeavePayload,
  ): Promise<any> {
    const userId = (client as any).userId;
    const { roomId } = payload;

    try {
      await this.voiceService.leaveVoiceChannel(roomId, userId);
      client.leave(`voice_${roomId}`);

      // Notify other participants
      client.to(`voice_${roomId}`).emit('voice:user-left', {
        userId,
        roomId,
      });

      return {
        event: 'voice:state',
        data: {
          roomId,
          channelName: `chess_${roomId}`,
          isJoined: false,
          isMuted: false,
          participants: [],
        },
      };
    } catch (error: any) {
      this.logger.warn(`voice:leave failed for user ${userId}: ${error.message}`);
      return {
        event: 'voice:error',
        data: { message: error.message, roomId },
      };
    }
  }

  /**
   * Self-mute toggle.
   * Client emits: `voice:mute` with { roomId, muted }
   */
  @SubscribeMessage('voice:mute')
  async handleMute(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: VoiceMutePayload,
  ): Promise<any> {
    const userId = (client as any).userId;
    const { roomId, muted } = payload;

    try {
      if (muted) {
        await this.voiceService.selfMute(roomId, userId);
      } else {
        await this.voiceService.selfUnmute(roomId, userId);
      }

      // Notify other participants about mute state change
      client.to(`voice_${roomId}`).emit(muted ? 'voice:user-muted' : 'voice:user-unmuted', {
        userId,
        roomId,
      });

      const state = await this.voiceService.getVoiceState(roomId, userId);

      return {
        event: 'voice:state',
        data: state,
      };
    } catch (error: any) {
      this.logger.warn(`voice:mute failed for user ${userId}: ${error.message}`);
      return {
        event: 'voice:error',
        data: { message: error.message, roomId },
      };
    }
  }

  /**
   * Deafen toggle (stop hearing others).
   * Client emits: `voice:deafen` with { roomId, deafened }
   */
  @SubscribeMessage('voice:deafen')
  async handleDeafen(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; deafened: boolean },
  ): Promise<any> {
    const userId = (client as any).userId;
    const { roomId, deafened } = payload;

    try {
      if (deafened) {
        await this.voiceService.deafen(roomId, userId);
      } else {
        await this.voiceService.undeafen(roomId, userId);
      }

      return {
        event: 'voice:state',
        data: await this.voiceService.getVoiceState(roomId, userId),
      };
    } catch (error: any) {
      return {
        event: 'voice:error',
        data: { message: error.message, roomId },
      };
    }
  }

  /**
   * Set speaking state (called by client when voice activity detected).
   * Client emits: `voice:speaking` with { roomId, isSpeaking }
   */
  @SubscribeMessage('voice:speaking')
  async handleSpeaking(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; isSpeaking: boolean },
  ): Promise<void> {
    const userId = (client as any).userId;
    const { roomId, isSpeaking } = payload;

    try {
      await this.voiceService.setSpeaking(roomId, userId, isSpeaking);

      // Notify others about speaking state
      client.to(`voice_${roomId}`).emit('voice:speaking', {
        userId,
        roomId,
        isSpeaking,
      });
    } catch {
      // Silently ignore speaking state errors
    }
  }

  /**
   * Set volume for a user.
   * Client emits: `voice:volume` with { roomId, volume }
   */
  @SubscribeMessage('voice:volume')
  async handleVolume(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; volume: number },
  ): Promise<any> {
    const userId = (client as any).userId;
    const { roomId, volume } = payload;

    try {
      await this.voiceService.setVolume(roomId, userId, volume);
      return {
        event: 'voice:state',
        data: await this.voiceService.getVoiceState(roomId, userId),
      };
    } catch (error: any) {
      return {
        event: 'voice:error',
        data: { message: error.message, roomId },
      };
    }
  }

  /**
   * Moderator action: mute another user.
   * Client emits: `voice:mod-mute` with { roomId, targetUserId }
   */
  @SubscribeMessage('voice:mod-mute')
  async handleModMute(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; targetUserId: number },
  ): Promise<any> {
    const userId = (client as any).userId;
    const { roomId, targetUserId } = payload;

    try {
      await this.voiceService.muteUser(roomId, userId, targetUserId);

      client.to(`voice_${roomId}`).emit('voice:user-muted', {
        userId: targetUserId,
        roomId,
        mutedBy: userId,
      });

      return {
        event: 'voice:mod-result',
        data: { success: true, action: 'mute', targetUserId },
      };
    } catch (error: any) {
      return {
        event: 'voice:error',
        data: { message: error.message, roomId },
      };
    }
  }

  /**
   * Moderator action: unmute another user.
   * Client emits: `voice:mod-unmute` with { roomId, targetUserId }
   */
  @SubscribeMessage('voice:mod-unmute')
  async handleModUnmute(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; targetUserId: number },
  ): Promise<any> {
    const userId = (client as any).userId;
    const { roomId, targetUserId } = payload;

    try {
      await this.voiceService.unmuteUser(roomId, userId, targetUserId);

      client.to(`voice_${roomId}`).emit('voice:user-unmuted', {
        userId: targetUserId,
        roomId,
        unmutedBy: userId,
      });

      return {
        event: 'voice:mod-result',
        data: { success: true, action: 'unmute', targetUserId },
      };
    } catch (error: any) {
      return {
        event: 'voice:error',
        data: { message: error.message, roomId },
      };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private extractUserId(client: Socket): number | null {
    // Extract userId from auth token or handshake query
    // In production, verify JWT token here
    const token = client.handshake.auth?.token || client.handshake.query?.token;
    if (token) {
      // Decode mock token - replace with proper JWT verification
      try {
        const decoded = Buffer.from(String(token), 'base64').toString('utf8');
        const userId = parseInt(decoded, 10);
        return isNaN(userId) ? null : userId;
      } catch {
        return null;
      }
    }

    // Fallback: use userId from query params (development only)
    const userIdFromQuery = client.handshake.query?.userId;
    if (userIdFromQuery) {
      const userId = parseInt(String(userIdFromQuery), 10);
      return isNaN(userId) ? null : userId;
    }

    return null;
  }

  /**
   * Broadcast participant list update to all users in a voice channel.
   */
  private async broadcastParticipants(roomId: string): Promise<void> {
    const participants = await this.voiceService.getParticipants(roomId);
    this.server.to(`voice_${roomId}`).emit('voice:participants', {
      roomId,
      participants,
    });
  }
}
