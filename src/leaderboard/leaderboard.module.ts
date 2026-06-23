/**
 * LeaderboardModule - 排行榜模块
 *
 * 提供排行榜服务、ELO计算、赛季管理等功能
 * 依赖: Redis (ioredis), TypeORM, UserModule
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';
import { EloCalculator } from './elo-calculator';

import { LeaderboardEntry } from '../common/entities/leaderboard-entry.entity';
import { User } from '../common/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LeaderboardEntry, User])],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, EloCalculator],
  exports: [LeaderboardService, EloCalculator],
})
export class LeaderboardModule {}
