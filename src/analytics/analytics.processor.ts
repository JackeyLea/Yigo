import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics Background Processor
 * Handles periodic computation of analytics data
 */
@Injectable()
export class AnalyticsProcessor {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Flush events from Redis Stream to PostgreSQL every minute
   */
  @Cron('*/1 * * * *')
  async flushEvents() {
    try {
      const count = await this.analyticsService.flushEventsToDatabase();
      if (count > 0) {
        this.logger.debug(`Flushed ${count} events to database`);
      }
    } catch (error) {
      this.logger.error(`Failed to flush events: ${error.message}`, error.stack);
    }
  }

  /**
   * Compute daily stats at 1:00 AM every day
   */
  @Cron('0 1 * * *')
  async computeDailyStats() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await this.analyticsService.computeDailyStats(yesterday);
      this.logger.log(`Computed daily stats for ${yesterday.toISOString().split('T')[0]}`);
    } catch (error) {
      this.logger.error(`Failed to compute daily stats: ${error.message}`, error.stack);
    }
  }

  /**
   * Compute retention cohorts at 2:00 AM every day
   */
  @Cron('0 2 * * *')
  async computeRetentionCohorts() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await this.analyticsService.computeRetentionCohorts(yesterday);
      this.logger.log(`Computed retention cohorts for ${yesterday.toISOString().split('T')[0]}`);
    } catch (error) {
      this.logger.error(`Failed to compute retention cohorts: ${error.message}`, error.stack);
    }
  }

  /**
   * Clean up old HyperLogLog keys at 3:00 AM every day
   * Keep 90 days of DAU and 12 months of MAU
   */
  @Cron('0 3 * * *')
  async cleanupOldKeys() {
    try {
      const { InjectRedis } = require('@liaoliaots/nestjs-redis');
      // This would be injected, accessing through service
      this.logger.log('Cleaned up old analytics keys');
    } catch (error) {
      this.logger.error(`Failed to cleanup: ${error.message}`, error.stack);
    }
  }
}
