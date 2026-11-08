import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TutorialService, TutorialStep } from './tutorial.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../../common/decorators/current-user.decorator';

class CompleteStepDto {
  stepId!: string;
}

// 注：@nestjs/swagger 未在 package.json 中声明，相关装饰器已移除
@Controller('tutorial')
@UseGuards(JwtAuthGuard)
export class TutorialController {
  constructor(private readonly tutorialService: TutorialService) {}

  /**
   * 获取当前用户的引导进度
   */
  @Get('progress')
  async getProgress(@CurrentUser() user: CurrentUserData) {
    const progress = await this.tutorialService.getTutorialProgress(user.userId);
    return {
      success: true,
      data: progress,
    };
  }

  /**
   * 获取引导步骤定义列表
   */
  @Get('steps')
  async getSteps(): Promise<{ success: boolean; data: TutorialStep[] }> {
    return {
      success: true,
      data: this.tutorialService.getTutorialSteps(),
    };
  }

  /**
   * 完成指定引导步骤
   */
  @Post('steps/:stepId/complete')
  @HttpCode(HttpStatus.OK)
  async completeStep(
    @CurrentUser() user: CurrentUserData,
    @Param('stepId') stepId: string,
  ) {
    await this.tutorialService.completeStep(user.userId, stepId);
    const progress = await this.tutorialService.getTutorialProgress(user.userId);
    return {
      success: true,
      message: '步骤已完成',
      data: progress,
    };
  }

  /**
   * 重置新手引导
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async resetTutorial(@CurrentUser() user: CurrentUserData) {
    await this.tutorialService.resetTutorial(user.userId);
    const progress = await this.tutorialService.getTutorialProgress(user.userId);
    return {
      success: true,
      message: '引导进度已重置',
      data: progress,
    };
  }

  /**
   * 检查引导是否完成
   */
  @Get('completed')
  async isCompleted(@CurrentUser() user: CurrentUserData) {
    const isCompleted = await this.tutorialService.isTutorialCompleted(user.userId);
    return {
      success: true,
      data: { isCompleted },
    };
  }
}
