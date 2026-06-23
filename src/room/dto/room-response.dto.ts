export class RoomPlayerDto {
  userId: number;
  username: string;
  nickname: string;
  avatarUrl: string;
  seatIndex: number;
  isReady: boolean;
  isHost: boolean;
}

export class RoomResponseDto {
  roomId: string;
  gameType: string;
  pluginId: string;
  status: 'waiting' | 'ready' | 'playing' | 'finished';
  hostId: number;
  maxPlayers: number;
  currentPlayers: number;
  players: RoomPlayerDto[];
  config: Record<string, any>;
  mode: string;
  isPasswordProtected: boolean;
  allowSpectator: boolean;
  spectatorCount: number;
  createdAt: Date;
  expiresAt: Date;
}

export class PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
