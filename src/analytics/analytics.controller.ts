import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { TrackEventDto, RetentionQueryDto, FunnelQueryDto, HeatmapQueryDto } from './dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('events')
  @ApiOperation({ summary: 'Track a user behavior event' })
  async trackEvent(
    @Req() req: any,
    @Body() dto: TrackEventDto,
  ) {
    const userId = req.user?.userId || dto.eventData?.userId;
    await this.analyticsService.trackEvent(userId, dto.eventType, dto.eventData, {
      gameType: dto.gameType,
      sessionId: dto.sessionId,
      ipAddress: req.ip,
      country: req.headers['cf-ipcountry'] as string,
    });
    return { success: true };
  }

  @Post('events/batch')
  @ApiOperation({ summary: 'Track multiple events in batch' })
  async trackEventsBatch(
    @Req() req: any,
    @Body() dtos: TrackEventDto[],
  ) {
    const userId = req.user?.userId;
    for (const dto of dtos) {
      await this.analyticsService.trackEvent(userId, dto.eventType, dto.eventData, {
        gameType: dto.gameType,
        sessionId: dto.sessionId,
      });
    }
    return { success: true, tracked: dtos.length };
  }

  @Post('flush')
  @ApiOperation({ summary: 'Flush events from Redis to database (admin only)' })
  async flushEvents() {
    const count = await this.analyticsService.flushEventsToDatabase();
    return { flushed: count };
  }

  @Get('retention')
  @ApiOperation({ summary: 'Get retention rate statistics' })
  async getRetentionStats(
    @Query() query: RetentionQueryDto,
  ) {
    return this.analyticsService.getRetentionStats(
      new Date(query.startDate),
      new Date(query.endDate),
      query.cohortType,
    );
  }

  @Get('active-users')
  @ApiOperation({ summary: 'Get DAU or MAU' })
  async getActiveUsers(
    @Query('date') date: string,
    @Query('period') period: 'daily' | 'monthly' = 'daily',
  ) {
    const count = await this.analyticsService.getActiveUsers(
      new Date(date || new Date().toISOString()),
      period,
    );
    return { count, period, date: date || new Date().toISOString().split('T')[0] };
  }

  @Get('ltv/:userId')
  @ApiOperation({ summary: 'Get user lifetime value' })
  async getUserLTV(
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    const ltv = await this.analyticsService.getUserLTV(userId);
    return { userId, ltv };
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'Get game activity heatmap by hour' })
  async getGameHeatmap(
    @Query() query: HeatmapQueryDto,
  ) {
    return this.analyticsService.getGameHeatmap(
      query.gameType || '',
      new Date(query.date),
    );
  }

  @Get('conversion')
  @ApiOperation({ summary: 'Get conversion rate statistics' })
  async getConversionRate(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.analyticsService.getConversionRate(
      new Date(startDate || Date.now() - 30 * 86400000),
      new Date(endDate || Date.now()),
    );
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Get user behavior funnel analysis' })
  async getFunnelAnalysis(
    @Query() query: FunnelQueryDto,
  ) {
    return this.analyticsService.getFunnelAnalysis(
      query.steps,
      { start: new Date(query.startDate), end: new Date(query.endDate) },
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics (admin)' })
  async getDashboardStats() {
    return this.analyticsService.getDashboardStats();
  }

  @Get('daily-stats/:date')
  @ApiOperation({ summary: 'Get daily statistics for a specific date' })
  async getDailyStats(@Query('date') date: string) {
    const stats = await this.analyticsService.getDashboardStats();
    return {
      date: date || new Date().toISOString().split('T')[0],
      ...stats,
    };
  }
}
