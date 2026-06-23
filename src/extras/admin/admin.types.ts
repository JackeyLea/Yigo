export type UserStatus = 'active' | 'banned' | 'suspended';
export type ReportStatus = 'pending' | 'processing' | 'resolved' | 'dismissed';
export type ReportType = 'cheating' | 'harassment' | 'spam' | 'abuse' | 'other';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface DashboardStats {
  totalUsers: number;
  onlineUsers: number;
  activeRooms: number;
  gamesToday: number;
  revenueToday: number;
  newUsersToday: number;
  topGame: string;
  avgSessionDuration: number;
}

export interface ActiveRoom {
  roomId: string;
  gameType: string;
  playerCount: number;
  maxPlayers: number;
  status: string;
  createdAt: Date;
  hostName: string;
}

export interface UserQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: UserStatus;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  startDate?: Date;
  endDate?: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  status: UserStatus;
  role: 'user' | 'admin' | 'moderator';
  createdAt: Date;
  lastLoginAt?: Date;
  totalGames: number;
  totalRevenue: number;
  banReason?: string;
  bannedUntil?: Date;
}

export interface Report {
  id: number;
  reporterId: number;
  reporterName: string;
  targetId: number;
  targetName: string;
  type: ReportType;
  reason: string;
  status: ReportStatus;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: number;
  action?: string;
}

export interface SystemLog {
  id: number;
  level: LogLevel;
  message: string;
  context?: string;
  source: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface BanRecord {
  id: number;
  userId: number;
  reason: string;
  bannedBy: number;
  bannedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}
