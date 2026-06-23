/**
 * Achievement Interfaces - 成就系统相关接口
 */

import { Achievement, AchievementCategory } from '../../common/entities/achievement.entity';
import { UserAchievement } from '../../common/entities/user-achievement.entity';

/** 奖励信息 */
export interface Reward {
  achievementId: string;
  achievementName: string;
  rewardType: 'currency' | 'item' | 'title' | 'xp' | 'badge';
  rewardValue: number | string;
  currency?: string;
  claimedAt: Date;
}

/** 成就进度信息 */
export interface AchievementProgress {
  achievementId: string;
  achievementCode: string;
  name: string;
  description: string;
  currentProgress: number;
  targetProgress: number;
  percentage: number;
  isUnlocked: boolean;
  unlockedAt?: Date;
  isClaimed: boolean;
  isHidden: boolean;
}

/** 解锁条件评估结果 */
export interface UnlockCheckResult {
  shouldUnlock: boolean;
  updatedProgress: Record<string, any>;
}

/** 成就DTO（返回给前端） */
export interface AchievementDto {
  achievementId: string;
  achievementCode: string;
  name: string;
  description: string;
  iconUrl: string | null;
  gameType: string | null;
  category: AchievementCategory;
  isHidden: boolean;
  unlockCondition: Record<string, any>;
  reward: Record<string, any>;
  createdAt: Date;
}

/** 用户成就DTO */
export interface UserAchievementDto {
  id: string;
  userId: string;
  achievement: AchievementDto;
  unlockedAt: Date | null;
  progressJson: Record<string, any>;
  isClaimed: boolean;
}

/** 解锁成就结果 */
export interface UnlockedAchievement {
  achievementId: string;
  achievementCode: string;
  name: string;
  description: string;
  unlockedAt: Date;
  isNew: boolean;
}

export { Achievement, AchievementCategory, UserAchievement };
