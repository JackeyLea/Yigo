/**
 * TaskController - 任务系统控制器
 *
 * 提供每日任务、每周任务的查询、完成和奖励领取等API端点。
 * 所有响应通过全局TransformInterceptor统一包装为ApiResponse格式。
 *
 * @baseUrl /api/v1/tasks
 */
import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Req,
  Body,
  Query,
} from '@nestjs/common';

import { TaskService, UserTaskItem } from './task.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Reward, TaskProgress, GameEvent } from './interfaces';
import { TaskType } from './entities/task-definition.entity';

/**
 * 用户请求对象接口
 */
interface RequestWithUser {
  user?: {
    userId: number;
    username: string;
    [key: string]: any;
  };
}

/**
 * 任务统计响应DTO
 */
interface TaskStatsDto {
  dailyTotal: number;
  dailyCompleted: number;
  dailyClaimed: number;
  weeklyTotal: number;
  weeklyCompleted: number;
  weeklyClaimed: number;
}

/**
 * 处理事件请求DTO
 */
interface HandleEventDto {
  event: GameEvent;
}

/**
 * 刷新任务请求DTO
 */
interface RefreshTasksDto {
  type?: TaskType;
}

@Controller('api/v1/tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /**
   * 获取每日任务列表
   *
   * 返回当前用户的每日任务及其进度状态。
   *
   * @returns 每日任务列表
   */
  @Get('daily')
  @UseGuards(JwtAuthGuard)
  async getDailyTasks(@Req() req: RequestWithUser): Promise<UserTaskItem[]> {
    const userId = req.user!.userId;
    return this.taskService.getDailyTasks(userId);
  }

  /**
   * 获取每周任务列表
   *
   * 返回当前用户的每周任务及其进度状态。
   *
   * @returns 每周任务列表
   */
  @Get('weekly')
  @UseGuards(JwtAuthGuard)
  async getWeeklyTasks(@Req() req: RequestWithUser): Promise<UserTaskItem[]> {
    const userId = req.user!.userId;
    return this.taskService.getWeeklyTasks(userId);
  }

  /**
   * 获取所有任务（每日+每周）
   *
   * 返回当前用户的所有任务。
   *
   * @returns 所有任务列表
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getAllTasks(
    @Req() req: RequestWithUser,
  ): Promise<{ daily: UserTaskItem[]; weekly: UserTaskItem[] }> {
    const userId = req.user!.userId;
    const [daily, weekly] = await Promise.all([
      this.taskService.getDailyTasks(userId),
      this.taskService.getWeeklyTasks(userId),
    ]);
    return { daily, weekly };
  }

  /**
   * 获取任务进度
   *
   * @param taskId - 任务ID
   * @returns 任务进度详情
   */
  @Get(':taskId/progress')
  @UseGuards(JwtAuthGuard)
  async getTaskProgress(
    @Param('taskId', ParseIntPipe) taskId: number,
    @Req() req: RequestWithUser,
  ): Promise<TaskProgress> {
    const userId = req.user!.userId;
    return this.taskService.getTaskProgress(userId, taskId);
  }

  /**
   * 完成任务并领取奖励
   *
   * 检查任务是否已完成，如果完成则发放奖励。
   *
   * @param taskId - 任务ID
   * @returns 领取的奖励
   */
  @Post(':taskId/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async completeTask(
    @Param('taskId', ParseIntPipe) taskId: number,
    @Req() req: RequestWithUser,
  ): Promise<Reward> {
    const userId = req.user!.userId;
    return this.taskService.completeTask(userId, taskId);
  }

  /**
   * 处理游戏事件，更新任务进度
   *
   * 当用户触发游戏事件时，自动检查并更新相关任务进度。
   *
   * @param body - 包含事件类型
   * @returns 更新后的任务列表
   */
  @Post('events')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async handleGameEvent(
    @Body() body: HandleEventDto,
    @Req() req: RequestWithUser,
  ): Promise<UserTaskItem[]> {
    const userId = req.user!.userId;
    return this.taskService.handleGameEvent(userId, body.event);
  }

  /**
   * 刷新任务
   *
   * 手动刷新用户的任务列表，通常在周期切换时调用。
   *
   * @param body - 可选的任务类型筛选
   * @returns 空响应表示成功
   */
  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async refreshTasks(
    @Body() body: RefreshTasksDto,
    @Req() req: RequestWithUser,
  ): Promise<{ message: string }> {
    const userId = req.user!.userId;
    await this.taskService.refreshTasks(userId, body.type);
    return { message: '任务已刷新' };
  }

  /**
   * 获取任务统计
   *
   * @returns 任务统计信息
   */
  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getTaskStats(@Req() req: RequestWithUser): Promise<TaskStatsDto> {
    const userId = req.user!.userId;
    return this.taskService.getTaskStats(userId);
  }
}
