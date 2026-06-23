import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  VoiceChannel,
  VoiceParticipant,
  VoiceToken,
  VoiceStateDto,
  VoiceParticipantInfo,
  AgoraConfig,
} from './voice.types';

/**
 * Simple HMAC-SHA256 implementation for Agora token generation.
 * In production, use the official `agora-token` package.
 */
@Injectable()
export class VoiceService {
  private readonly channels = new Map<string, VoiceChannel>();
  private readonly userChannels = new Map<number, Set<string>>();

  // Agora configuration - should come from environment/config
  private readonly agoraConfig: AgoraConfig = {
    appId: process.env.AGORA_APP_ID || 'your_agora_app_id',
    appCertificate: process.env.AGORA_APP_CERTIFICATE || 'your_agora_app_certificate',
    tokenExpirationSeconds: 3600,
    privilegeExpirationSeconds: 3600,
  };

  // ─── Channel Management ─────────────────────────────────────────────

  private getOrCreateChannel(roomId: string, hostId?: number): VoiceChannel {
    let channel = this.channels.get(roomId);
    if (!channel) {
      channel = {
        roomId,
        channelName: `chess_${roomId}`,
        createdAt: new Date(),
        status: 'active',
        hostId: hostId ?? 0,
        maxParticipants: 20,
        participants: new Map(),
        bannedUsers: new Set(),
      };
      this.channels.set(roomId, channel);
    }
    return channel;
  }

  private generateUid(userId: number): number {
    // Map userId to a unique numeric UID for Agora
    // Use a simple hash to avoid exposing real user IDs
    return Math.abs((userId * 2654435761) % 2147483647) + 1;
  }

  private generateToken(channelName: string, uid: number): string {
    // In production: import { RtcTokenBuilder, RtcRole } from 'agora-token';
    // and use RtcTokenBuilder.buildTokenWithUid()

    const now = Math.floor(Date.now() / 1000);
    const expiredAt = now + this.agoraConfig.tokenExpirationSeconds;

    // Placeholder token format - replace with actual Agora SDK token generation
    const version = '007';
    const appIdHex = this.stringToHex(this.agoraConfig.appId);
    const payload = `${channelName}:${uid}:${expiredAt}`;
    const token = `${version}${appIdHex}${expiredAt.toString(16)}${this.simpleSign(payload)}`;

    return token;
  }

  private simpleSign(payload: string): string {
    // Simple signature placeholder - replace with HMAC-SHA256 in production
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  private stringToHex(str: string): string {
    return Array.from(str)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Join a voice channel and generate an Agora token.
   */
  async joinVoiceChannel(roomId: string, userId: number): Promise<VoiceToken> {
    const channel = this.getOrCreateChannel(roomId);

    if (channel.status === 'locked') {
      throw new BadRequestException('Voice channel is locked');
    }

    if (channel.status === 'closed') {
      throw new BadRequestException('Voice channel is closed');
    }

    if (channel.bannedUsers.has(userId)) {
      throw new ForbiddenException('You are banned from this voice channel');
    }

    if (channel.participants.has(userId)) {
      throw new ConflictException('Already in this voice channel');
    }

    if (channel.participants.size >= channel.maxParticipants) {
      throw new BadRequestException('Voice channel is full');
    }

    const uid = this.generateUid(userId);
    const token = this.generateToken(channel.channelName, uid);
    const expiredAt =
      Math.floor(Date.now() / 1000) + this.agoraConfig.tokenExpirationSeconds;

    const participant: VoiceParticipant = {
      userId,
      username: `User_${userId}`, // Should be resolved from user service
      joinedAt: new Date(),
      status: 'active',
      isSpeaking: false,
      volume: 100,
    };

    channel.participants.set(userId, participant);

    // Track user -> channels mapping
    if (!this.userChannels.has(userId)) {
      this.userChannels.set(userId, new Set());
    }
    this.userChannels.get(userId)!.add(roomId);

    return {
      token,
      channelName: channel.channelName,
      uid,
      appId: this.agoraConfig.appId,
      expiredAt,
    };
  }

  /**
   * Leave a voice channel.
   */
  async leaveVoiceChannel(roomId: string, userId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    if (!channel.participants.has(userId)) {
      throw new BadRequestException('Not in this voice channel');
    }

    channel.participants.delete(userId);

    // Clean up user tracking
    const userChans = this.userChannels.get(userId);
    if (userChans) {
      userChans.delete(roomId);
      if (userChans.size === 0) {
        this.userChannels.delete(userId);
      }
    }

    // Clean up empty channels
    if (channel.participants.size === 0) {
      this.channels.delete(roomId);
    }
  }

  /**
   * Mute another user (moderator/host action).
   */
  async muteUser(roomId: string, userId: number, targetUserId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    // Check if requester has permission (host or moderator)
    if (channel.hostId !== userId) {
      throw new ForbiddenException('Only the host can mute other users');
    }

    const target = channel.participants.get(targetUserId);
    if (!target) throw new NotFoundException('Target user not in voice channel');

    target.status = 'muted';
  }

  /**
   * Unmute another user (moderator/host action).
   */
  async unmuteUser(roomId: string, userId: number, targetUserId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    if (channel.hostId !== userId) {
      throw new ForbiddenException('Only the host can unmute other users');
    }

    const target = channel.participants.get(targetUserId);
    if (!target) throw new NotFoundException('Target user not in voice channel');

    if (target.status === 'muted') {
      target.status = 'active';
    }
  }

  /**
   * Self-mute (a user mutes themselves).
   */
  async selfMute(roomId: string, userId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    const participant = channel.participants.get(userId);
    if (!participant) throw new NotFoundException('Not in this voice channel');

    participant.status = 'self-muted';
  }

  /**
   * Self-unmute (a user unmutes themselves).
   */
  async selfUnmute(roomId: string, userId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    const participant = channel.participants.get(userId);
    if (!participant) throw new NotFoundException('Not in this voice channel');

    if (participant.status === 'self-muted') {
      participant.status = 'active';
    }
  }

  /**
   * Deafen self (stop hearing others).
   */
  async deafen(roomId: string, userId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    const participant = channel.participants.get(userId);
    if (!participant) throw new NotFoundException('Not in this voice channel');

    participant.status = 'deafened';
  }

  /**
   * Undeafen self.
   */
  async undeafen(roomId: string, userId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    const participant = channel.participants.get(userId);
    if (!participant) throw new NotFoundException('Not in this voice channel');

    if (participant.status === 'deafened') {
      participant.status = 'active';
    }
  }

  /**
   * Set speaking state for a participant.
   */
  async setSpeaking(roomId: string, userId: number, isSpeaking: boolean): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) return;

    const participant = channel.participants.get(userId);
    if (!participant) return;

    participant.isSpeaking = isSpeaking;
  }

  /**
   * Set volume for a participant.
   */
  async setVolume(roomId: string, userId: number, volume: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');

    const participant = channel.participants.get(userId);
    if (!participant) throw new NotFoundException('Not in this voice channel');

    participant.volume = Math.max(0, Math.min(100, volume));
  }

  // ─── Queries ────────────────────────────────────────────────────────

  /**
   * Get voice channel state.
   */
  async getVoiceState(roomId: string, userId: number): Promise<VoiceStateDto> {
    const channel = this.channels.get(roomId);
    if (!channel) {
      return {
        roomId,
        channelName: `chess_${roomId}`,
        isJoined: false,
        isMuted: false,
        participants: [],
      };
    }

    const participant = channel.participants.get(userId);

    return {
      roomId: channel.roomId,
      channelName: channel.channelName,
      isJoined: !!participant,
      isMuted: participant?.status === 'muted' || participant?.status === 'self-muted',
      participants: Array.from(channel.participants.values()).map((p) => ({
        userId: p.userId,
        username: p.username,
        isSpeaking: p.isSpeaking,
        isMuted: p.status === 'muted' || p.status === 'self-muted',
        volume: p.volume,
      })),
    };
  }

  /**
   * Get participants in a voice channel.
   */
  async getParticipants(roomId: string): Promise<VoiceParticipantInfo[]> {
    const channel = this.channels.get(roomId);
    if (!channel) return [];

    return Array.from(channel.participants.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      isSpeaking: p.isSpeaking,
      isMuted: p.status === 'muted' || p.status === 'self-muted',
      volume: p.volume,
    }));
  }

  /**
   * Get channels for a user.
   */
  async getUserChannels(userId: number): Promise<string[]> {
    return Array.from(this.userChannels.get(userId) ?? []);
  }

  // ─── Moderation ─────────────────────────────────────────────────────

  /**
   * Ban a user from a voice channel.
   */
  async banFromChannel(roomId: string, targetUserId: number): Promise<void> {
    const channel = this.getOrCreateChannel(roomId);
    channel.bannedUsers.add(targetUserId);

    // If user is currently in channel, kick them
    if (channel.participants.has(targetUserId)) {
      await this.leaveVoiceChannel(roomId, targetUserId);
    }
  }

  /**
   * Unban a user from a voice channel.
   */
  async unbanFromChannel(roomId: string, targetUserId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) return;
    channel.bannedUsers.delete(targetUserId);
  }

  /**
   * Lock a voice channel (prevent new joins).
   */
  async lockChannel(roomId: string, hostId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');
    if (channel.hostId !== hostId) {
      throw new ForbiddenException('Only the host can lock the channel');
    }
    channel.status = 'locked';
  }

  /**
   * Unlock a voice channel.
   */
  async unlockChannel(roomId: string, hostId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');
    if (channel.hostId !== hostId) {
      throw new ForbiddenException('Only the host can unlock the channel');
    }
    channel.status = 'active';
  }

  /**
   * Close a voice channel.
   */
  async closeChannel(roomId: string, hostId: number): Promise<void> {
    const channel = this.channels.get(roomId);
    if (!channel) throw new NotFoundException('Voice channel not found');
    if (channel.hostId !== hostId) {
      throw new ForbiddenException('Only the host can close the channel');
    }

    // Remove all participants
    for (const userId of channel.participants.keys()) {
      const userChans = this.userChannels.get(userId);
      if (userChans) {
        userChans.delete(roomId);
        if (userChans.size === 0) {
          this.userChannels.delete(userId);
        }
      }
    }

    channel.participants.clear();
    channel.status = 'closed';
    this.channels.delete(roomId);
  }
}


