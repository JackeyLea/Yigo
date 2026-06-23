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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { TutorialService, TutorialStep } from './tutorial.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

class CompleteStepDto {
  stepId!: string;
}

@ApiTags('Tutorial - 新手引导')
@Controller('api/v1/tutorial')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TutorialController {
  constructor(private readonly tutorialService: TutorialService) {}

  /**
   * 获取当前用户的引导进度
   */
  @Get('progress')
  @ApiOperation({ summary: '获取引导进度', description: '获取当前用户的新手引导完成进度' })
  async getProgress(@CurrentUser('id') userId: number) {
    const progress = await this.tutorialService.getTutorialProgress(userId);
    return {
      success: true,
      data: progress,
    };
  }

  /**
   * 获取引导步骤定义列表
   */
  @Get('steps')
  @ApiOperation({ summary: '获取引导步骤列表', description: '获取所有新手引导步骤的定义' })
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
  @ApiOperation({ summary: '完成引导步骤', description: '标记指定的新手引导步骤为已完成' })
  @ApiParam({ name: 'stepId', description: '步骤ID', example: 'welcome' })
  async completeStep(
    @CurrentUser('id') userId: number,
    @Param('stepId') stepId: string,
  ) {
    await this.tutorialService.completeStep(userId, stepId);
    const progress = await this.tutorialService.getTutorialProgress(userId);
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
  @ApiOperation({ summary: '重置引导进度', description: '重置当前用户的新手引导进度' })
  async resetTutorial(@CurrentUser('id') userId: number) {
    await this.tutorialService.resetTutorial(userId);
    const progress = await this.tutorialService.getTutorialProgress(userId);
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
  @ApiOperation({ summary: '检查引导是否完成', description: '检查当前用户是否已完成全部新手引导' })
  async isCompleted(@CurrentUser('id') userId: number) {
    const isCompleted = await this.tutorialService.isTutorialCompleted(userId);
    return {
      success: true,
      data: { isCompleted },
    };
  }
}
