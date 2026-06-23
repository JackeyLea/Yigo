import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  DashboardStats,
  ActiveRoom,
  User,
  UserQuery,
  UserStatus,
  PaginatedResult,
  Report,
  ReportStatus,
  SystemLog,
  LogLevel,
  BanRecord,
} from './admin.types';

@Injectable()
export class AdminService {
  private readonly users = new Map<number, User>();
  private readonly rooms = new Map<string, ActiveRoom>();
  private readonly reports = new Map<number, Report>();
  private readonly logs: SystemLog[] = [];
  private readonly banRecords: BanRecord[] = [];
  private nextReportId = 1;
  private nextLogId = 1;
  private nextBanId = 1;

  // Simulated stats
  private stats: DashboardStats = {
    totalUsers: 0,
    onlineUsers: 0,
    activeRooms: 0,
    gamesToday: 0,
    revenueToday: 0,
    newUsersToday: 0,
    topGame: 'texas_holdem',
    avgSessionDuration: 0,
  };

  // ─── Dashboard ──────────────────────────────────────────────────────

  /**
   * Get dashboard statistics.
   */
  async getDashboardStats(): Promise<DashboardStats> {
    this.refreshStats();
    return { ...this.stats };
  }

  /**
   * Get current online user count.
   */
  async getOnlineUsers(): Promise<number> {
    const onlineCount = Array.from(this.users.values()).filter(
      (u) => u.status === 'active',
    ).length;
    this.stats.onlineUsers = onlineCount;
    return onlineCount;
  }

  /**
   * Get list of active game rooms.
   */
  async getActiveRooms(): Promise<ActiveRoom[]> {
    return Array.from(this.rooms.values()).filter(
      (r) => r.status === 'active' || r.status === 'waiting',
    );
  }

  private refreshStats(): void {
    const allUsers = Array.from(this.users.values());
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    this.stats.totalUsers = allUsers.length;
    this.stats.onlineUsers = allUsers.filter((u) => u.status === 'active').length;
    this.stats.activeRooms = Array.from(this.rooms.values()).filter(
      (r) => r.status === 'active',
    ).length;
    this.stats.newUsersToday = allUsers.filter((u) => u.createdAt >= todayStart).length;

    // Calculate average session duration (mock logic)
    const activeUsers = allUsers.filter((u) => u.lastLoginAt);
    if (activeUsers.length > 0) {
      const totalDuration = activeUsers.reduce((sum, u) => {
        if (u.lastLoginAt) {
          return sum + (now.getTime() - u.lastLoginAt.getTime()) / 1000;
        }
        return sum;
      }, 0);
      this.stats.avgSessionDuration = Math.floor(totalDuration / activeUsers.length);
    }
  }

  // ─── User Management ────────────────────────────────────────────────

  /**
   * Get paginated user list with filtering.
   */
  async getUserList(query: UserQuery): Promise<PaginatedResult<User>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    let items = Array.from(this.users.values());

    // Filter by search term (username or email)
    if (query.search) {
      const term = query.search.toLowerCase();
      items = items.filter(
        (u) =>
          u.username.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term),
      );
    }

    // Filter by status
    if (query.status) {
      items = items.filter((u) => u.status === query.status);
    }

    // Filter by date range
    if (query.startDate) {
      items = items.filter((u) => u.createdAt >= query.startDate);
    }
    if (query.endDate) {
      items = items.filter((u) => u.createdAt <= query.endDate);
    }

    // Sort
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    items.sort((a, b) => {
      const aVal = (a as any)[sortBy] ?? 0;
      const bVal = (b as any)[sortBy] ?? 0;
      if (sortOrder === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const startIdx = (page - 1) * limit;
    const paginatedItems = items.slice(startIdx, startIdx + limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Ban a user.
   */
  async banUser(userId: number, reason: string, duration?: number): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.status === 'banned') throw new BadRequestException('User already banned');

    const now = new Date();
    const expiresAt = duration ? new Date(now.getTime() + duration * 1000) : undefined;

    user.status = 'banned';
    user.banReason = reason;
    user.bannedUntil = expiresAt;

    const record: BanRecord = {
      id: this.nextBanId++,
      userId,
      reason,
      bannedBy: 0, // Should be set from admin context
      bannedAt: now,
      expiresAt,
      isActive: true,
    };
    this.banRecords.push(record);

    this.addLog('info', `User ${userId} banned: ${reason}`, 'admin', { duration, expiresAt });
  }

  /**
   * Unban a user.
   */
  async unbanUser(userId: number): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.status !== 'banned') throw new BadRequestException('User is not banned');

    user.status = 'active';
    user.banReason = undefined;
    user.bannedUntil = undefined;

    // Deactivate ban records
    for (const record of this.banRecords) {
      if (record.userId === userId && record.isActive) {
        record.isActive = false;
      }
    }

    this.addLog('info', `User ${userId} unbanned`, 'admin');
  }

  /**
   * Get ban history for a user.
   */
  async getBanHistory(userId: number): Promise<BanRecord[]> {
    return this.banRecords.filter((r) => r.userId === userId);
  }

  // ─── Report Management ──────────────────────────────────────────────

  /**
   * Get reports with optional status filter.
   */
  async getReports(status?: string): Promise<PaginatedResult<Report>> {
    let items = Array.from(this.reports.values());

    if (status) {
      items = items.filter((r) => r.status === status);
    }

    // Sort by newest first
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      items: items.slice(0, 50),
      total: items.length,
      page: 1,
      limit: 50,
      totalPages: Math.ceil(items.length / 50),
    };
  }

  /**
   * Process a report with an action.
   */
  async processReport(reportId: number, action: string): Promise<void> {
    const report = this.reports.get(reportId);
    if (!report) throw new NotFoundException(`Report ${reportId} not found`);

    report.status = 'resolved';
    report.resolvedAt = new Date();
    report.resolvedBy = 0; // Should be set from admin context
    report.action = action;

    // Execute action
    switch (action) {
      case 'ban':
        await this.banUser(report.targetId, `Report #${reportId}: ${report.reason}`);
        break;
      case 'warn':
        this.addLog('warn', `User ${report.targetId} warned for: ${report.reason}`, 'admin');
        break;
      case 'dismiss':
        report.status = 'dismissed';
        break;
      default:
        // Custom action
        break;
    }

    this.addLog('info', `Report ${reportId} processed with action: ${action}`, 'admin');
  }

  /**
   * Create a new report (called by users).
   */
  async createReport(
    reporterId: number,
    reporterName: string,
    targetId: number,
    targetName: string,
    type: Report['type'],
    reason: string,
  ): Promise<Report> {
    const report: Report = {
      id: this.nextReportId++,
      reporterId,
      reporterName,
      targetId,
      targetName,
      type,
      reason,
      status: 'pending',
      createdAt: new Date(),
    };
    this.reports.set(report.id, report);
    return report;
  }

  // ─── System Operations ──────────────────────────────────────────────

  /**
   * Broadcast a message to all online users.
   */
  async broadcastMessage(message: string): Promise<void> {
    // In real implementation, this would use WebSocketGateway to emit
    this.addLog('info', `Broadcast message sent: ${message}`, 'system');
  }

  /**
   * Get system logs with optional level filter.
   */
  async getSystemLogs(
    level?: string,
    page?: number,
  ): Promise<PaginatedResult<SystemLog>> {
    const limit = 50;
    const currentPage = page ?? 1;
    let items = [...this.logs];

    if (level) {
      items = items.filter((l) => l.level === level);
    }

    // Sort newest first
    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const startIdx = (currentPage - 1) * limit;
    const paginatedItems = items.slice(startIdx, startIdx + limit);

    return {
      items: paginatedItems,
      total,
      page: currentPage,
      limit,
      totalPages,
    };
  }

  /**
   * Update game configuration for a plugin.
   */
  async updateGameConfig(pluginId: string, config: any): Promise<void> {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new BadRequestException('Invalid plugin ID');
    }

    // In real implementation, this would persist to database
    this.addLog('info', `Game config updated for plugin ${pluginId}`, 'admin', { config });
  }

  // ─── Helper: System Logs ────────────────────────────────────────────

  private addLog(
    level: LogLevel,
    message: string,
    source: string,
    metadata?: Record<string, any>,
  ): void {
    const log: SystemLog = {
      id: this.nextLogId++,
      level,
      message,
      source,
      timestamp: new Date(),
      metadata,
    };
    this.logs.push(log);

    // Keep only last 10000 logs
    if (this.logs.length > 10000) {
      this.logs.splice(0, this.logs.length - 10000);
    }
  }

  // ─── Data Seeding / Management ─────────────────────────────────────

  /**
   * Seed a user (for testing/admin purposes).
   */
  async seedUser(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  /**
   * Add or update a room.
   */
  async upsertRoom(room: ActiveRoom): Promise<void> {
    this.rooms.set(room.roomId, room);
  }

  /**
   * Remove a room.
   */
  async removeRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }

  /**
   * Get a single user by ID.
   */
  async getUser(userId: number): Promise<User | undefined> {
    return this.users.get(userId);
  }

  /**
   * Increment daily games counter.
   */
  async incrementGamesToday(): Promise<void> {
    this.stats.gamesToday += 1;
  }

  /**
   * Add revenue.
   */
  async addRevenue(amount: number): Promise<void> {
    this.stats.revenueToday += amount;
  }

  /**
   * Reset daily counters (should be called by cron).
   */
  async resetDailyCounters(): Promise<void> {
    this.stats.gamesToday = 0;
    this.stats.revenueToday = 0;
    this.stats.newUsersToday = 0;
  }
}
