import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TutorialProgress as TutorialProgressEntity } from './tutorial-progress.entity';

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface TutorialProgress {
  userId: number;
  completedSteps: string[];
  currentStep: string | null;
  isCompleted: boolean;
  totalSteps: number;
  completedCount: number;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'welcome', title: '欢迎界面', description: '欢迎来到棋盘游戏平台，开始您的游戏之旅', order: 1 },
  { id: 'lobby_guide', title: '大厅导航', description: '了解游戏大厅的各个功能区域', order: 2 },
  { id: 'first_game', title: '第一场游戏', description: '体验五子棋入门对局', order: 3 },
  { id: 'settings_guide', title: '游戏设置', description: '个性化您的游戏设置', order: 4 },
  { id: 'social_guide', title: '添加好友', description: '学习如何添加和管理好友', order: 5 },
  { id: 'wallet_guide', title: '查看钱包', description: '查看您的游戏资产和钱包', order: 6 },
  { id: 'complete', title: '引导完成奖励', description: '恭喜完成新手引导，领取您的奖励', order: 7 },
];

@Injectable()
export class TutorialService {
  private readonly logger = new Logger(TutorialService.name);
  private readonly STEP_ORDER_MAP: Map<string, number>;

  constructor(
    @InjectRepository(TutorialProgressEntity)
    private readonly progressRepo: Repository<TutorialProgressEntity>,
  ) {
    this.STEP_ORDER_MAP = new Map(TUTORIAL_STEPS.map((s) => [s.id, s.order]));
  }

  /**
   * 获取用户的新手引导进度
   */
  async getTutorialProgress(userId: number): Promise<TutorialProgress> {
    const progress = await this.progressRepo.findOne({
      where: { user_id: userId },
    });

    if (!progress) {
      return {
        userId,
        completedSteps: [],
        currentStep: TUTORIAL_STEPS[0]?.id ?? null,
        isCompleted: false,
        totalSteps: TUTORIAL_STEPS.length,
        completedCount: 0,
      };
    }

    const completedSteps = (progress.completed_steps as string[]) || [];
    return {
      userId,
      completedSteps,
      currentStep: this.getCurrentStep(completedSteps),
      isCompleted: this.checkIsCompleted(completedSteps),
      totalSteps: TUTORIAL_STEPS.length,
      completedCount: completedSteps.length,
    };
  }

  /**
   * 完成指定步骤
   */
  async completeStep(userId: number, stepId: string): Promise<void> {
    const step = TUTORIAL_STEPS.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`无效的引导步骤: ${stepId}`);
    }

    const progress = await this.progressRepo.findOne({
      where: { user_id: userId },
    });

    if (progress) {
      const completedSteps = new Set(progress.completed_steps as string[]);
      completedSteps.add(stepId);
      const isCompleted = this.checkIsCompleted([...completedSteps]);

      await this.progressRepo.update(
        { user_id: userId },
        {
          completed_steps: [...completedSteps],
          is_completed: isCompleted,
          updated_at: new Date(),
        },
      );
    } else {
      await this.progressRepo.insert({
        user_id: userId,
        completed_steps: [stepId],
        is_completed: this.checkIsCompleted([stepId]),
      });
    }

    this.logger.log(`用户 ${userId} 完成了引导步骤: ${stepId}`);
  }

  /**
   * 检查用户是否已完成全部引导
   */
  async isTutorialCompleted(userId: number): Promise<boolean> {
    const progress = await this.progressRepo.findOne({
      where: { user_id: userId },
    });
    return progress?.is_completed ?? false;
  }

  /**
   * 重置用户引导进度
   */
  async resetTutorial(userId: number): Promise<void> {
    const progress = await this.progressRepo.findOne({
      where: { user_id: userId },
    });

    if (progress) {
      await this.progressRepo.update(
        { user_id: userId },
        {
          completed_steps: [],
          is_completed: false,
          updated_at: new Date(),
        },
      );
    } else {
      await this.progressRepo.insert({
        user_id: userId,
        completed_steps: [],
        is_completed: false,
      });
    }

    this.logger.log(`用户 ${userId} 的新手引导已重置`);
  }

  /**
   * 获取所有引导步骤定义
   */
  getTutorialSteps(): TutorialStep[] {
    return [...TUTORIAL_STEPS];
  }

  private getCurrentStep(completedSteps: string[]): string | null {
    if (this.checkIsCompleted(completedSteps)) {
      return null;
    }
    const completedSet = new Set(completedSteps);
    const nextStep = TUTORIAL_STEPS.find((s) => !completedSet.has(s.id));
    return nextStep?.id ?? null;
  }

  private checkIsCompleted(completedSteps: string[]): boolean {
    return completedSteps.length >= TUTORIAL_STEPS.length;
  }
}
