export type VoiceChannelStatus = 'active' | 'locked' | 'closed';
export type VoiceParticipantStatus = 'active' | 'muted' | 'self-muted' | 'deafened';

export interface VoiceToken {
  token: string;
  channelName: string;
  uid: number;
  appId: string;
  expiredAt: number;
}

export interface VoiceParticipant {
  userId: number;
  username: string;
  joinedAt: Date;
  status: VoiceParticipantStatus;
  isSpeaking: boolean;
  volume: number; // 0-100
}

export interface VoiceChannel {
  roomId: string;
  channelName: string;
  createdAt: Date;
  status: VoiceChannelStatus;
  hostId: number;
  maxParticipants: number;
  participants: Map<number, VoiceParticipant>;
  bannedUsers: Set<number>;
}

export interface VoiceStateDto {
  roomId: string;
  channelName: string;
  isJoined: boolean;
  isMuted: boolean;
  participants: VoiceParticipantInfo[];
}

export interface VoiceParticipantInfo {
  userId: number;
  username: string;
  isSpeaking: boolean;
  isMuted: boolean;
  volume: number;
}

// WebSocket event payloads
export interface VoiceJoinPayload {
  roomId: string;
}

export interface VoiceLeavePayload {
  roomId: string;
}

export interface VoiceMutePayload {
  roomId: string;
  muted: boolean;
}

export interface VoiceModeratePayload {
  roomId: string;
  targetUserId: number;
}

// Agora token configuration
export interface AgoraConfig {
  appId: string;
  appCertificate: string;
  tokenExpirationSeconds: number;
  privilegeExpirationSeconds: number;
}
