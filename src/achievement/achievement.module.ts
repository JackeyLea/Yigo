/**
 * AchievementModule - 成就与任务系统模块
 *
 * 集成成就系统和任务系统，提供成就解锁、进度追踪、
 * 每日/每周任务、奖励领取等功能。
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AchievementController } from './achievement.controller';
import { TaskController } from './task.controller';
import { AchievementService } from './achievement.service';
import { TaskService } from './task.service';

import { Achievement } from '../common/entities/achievement.entity';
import { UserAchievement } from '../common/entities/user-achievement.entity';
import { Wallet } from '../common/entities/wallet.entity';
import { Transaction } from '../common/entities/transaction.entity';
import { User } from '../common/entities/user.entity';
import { TaskDefinition } from './entities/task-definition.entity';
import { UserTaskProgress } from './entities/user-task-progress.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Achievement,
      UserAchievement,
      Wallet,
      Transaction,
      User,
      TaskDefinition,
      UserTaskProgress,
    ]),
  ],
  controllers: [AchievementController, TaskController],
  providers: [AchievementService, TaskService],
  exports: [AchievementService, TaskService],
})
export class AchievementModule {}
