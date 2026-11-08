import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsProcessor } from './analytics.processor';
import { AnalyticsEvent, RetentionCohort, UserLtv, DailyStats } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnalyticsEvent, RetentionCohort, UserLtv, DailyStats]),
    ScheduleModule.forRoot(),
  ],
  providers: [AnalyticsService, AnalyticsProcessor],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
