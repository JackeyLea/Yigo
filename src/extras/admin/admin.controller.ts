import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard, AdminRoles, SuperAdminGuard } from './admin.guard';
import { UserQuery, LogLevel } from './admin.types';

/**
 * DTO for banning a user.
 */
class BanUserDto {
  reason: string;
  duration?: number; // Duration in seconds
}

/**
 * DTO for processing a report.
 */
class ProcessReportDto {
  action: string;
}

/**
 * DTO for broadcasting a message.
 */
class BroadcastMessageDto {
  message: string;
}

/**
 * DTO for updating game configuration.
 */
class UpdateGameConfigDto {
  pluginId: string;
  config: any;
}

/**
 * Admin Controller - Operations backend API endpoints.
 * All routes are prefixed with /api/admin and require admin authentication.
 */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Dashboard ──────────────────────────────────────────────────────

  /**
   * Get dashboard statistics.
   * GET /api/admin/dashboard
   */
  @Get('dashboard')
  @AdminRoles('super', 'admin', 'moderator')
  async getDashboard() {
    const stats = await this.adminService.getDashboardStats();
    return { success: true, data: stats };
  }

  /**
   * Get online user count.
   * GET /api/admin/online-users
   */
  @Get('online-users')
  @AdminRoles('super', 'admin', 'moderator')
  async getOnlineUsers() {
    const count = await this.adminService.getOnlineUsers();
    return { success: true, data: { count } };
  }

  /**
   * Get active rooms list.
   * GET /api/admin/active-rooms
   */
  @Get('active-rooms')
  @AdminRoles('super', 'admin', 'moderator')
  async getActiveRooms() {
    const rooms = await this.adminService.getActiveRooms();
    return { success: true, data: rooms };
  }

  // ─── User Management ────────────────────────────────────────────────

  /**
   * Get paginated user list with filters.
   * GET /api/admin/users?page=1&limit=20&search=&status=&sortBy=&sortOrder=
   */
  @Get('users')
  @AdminRoles('super', 'admin', 'moderator')
  async getUserList(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const query: UserQuery = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
      status: status as any,
      sortBy,
      sortOrder,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    };

    const result = await this.adminService.getUserList(query);
    return { success: true, data: result };
  }

  /**
   * Ban a user.
   * POST /api/admin/users/:userId/ban
   */
  @Post('users/:userId/ban')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super', 'admin')
  async banUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: BanUserDto,
  ) {
    await this.adminService.banUser(userId, dto.reason, dto.duration);
    return { success: true, message: `User ${userId} has been banned` };
  }

  /**
   * Unban a user.
   * POST /api/admin/users/:userId/unban
   */
  @Post('users/:userId/unban')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super', 'admin')
  async unbanUser(@Param('userId', ParseIntPipe) userId: number) {
    await this.adminService.unbanUser(userId);
    return { success: true, message: `User ${userId} has been unbanned` };
  }

  // ─── Report Management ──────────────────────────────────────────────

  /**
   * Get reports with optional status filter.
   * GET /api/admin/reports?status=pending
   */
  @Get('reports')
  @AdminRoles('super', 'admin', 'moderator')
  async getReports(@Query('status') status?: string) {
    const result = await this.adminService.getReports(status);
    return { success: true, data: result };
  }

  /**
   * Process a report.
   * POST /api/admin/reports/:reportId/process
   */
  @Post('reports/:reportId/process')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super', 'admin', 'moderator')
  async processReport(
    @Param('reportId', ParseIntPipe) reportId: number,
    @Body() dto: ProcessReportDto,
  ) {
    await this.adminService.processReport(reportId, dto.action);
    return { success: true, message: `Report ${reportId} processed` };
  }

  // ─── System Operations ──────────────────────────────────────────────

  /**
   * Broadcast a message to all online users.
   * POST /api/admin/broadcast
   */
  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super', 'admin')
  async broadcastMessage(@Body() dto: BroadcastMessageDto) {
    await this.adminService.broadcastMessage(dto.message);
    return { success: true, message: 'Broadcast sent' };
  }

  /**
   * Get system logs.
   * GET /api/admin/logs?level=error&page=1
   */
  @Get('logs')
  @AdminRoles('super', 'admin')
  async getSystemLogs(
    @Query('level') level?: LogLevel,
    @Query('page') page?: string,
  ) {
    const result = await this.adminService.getSystemLogs(
      level,
      page ? parseInt(page, 10) : undefined,
    );
    return { success: true, data: result };
  }

  /**
   * Update game configuration.
   * POST /api/admin/game-config
   */
  @Post('game-config')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  async updateGameConfig(@Body() dto: UpdateGameConfigDto) {
    await this.adminService.updateGameConfig(dto.pluginId, dto.config);
    return { success: true, message: `Game config for ${dto.pluginId} updated` };
  }
}
