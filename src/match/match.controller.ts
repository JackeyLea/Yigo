import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MatchQueueService, MatchStatus } from './match-queue.service';
import { MatchCriteriaDto } from './dto/match-criteria.dto';

/**
 * 匹配请求中的用户信息
 */
interface RequestWithUser extends Request {
  user: {
    userId: number;
    username: string;
  };
}

/**
 * MatchController - 匹配控制器
 *
 * API端点：
 * - POST /api/v1/match — 加入匹配队列（需JWT）
 * - DELETE /api/v1/match/:ticketId — 取消匹配
 * - GET /api/v1/match/:ticketId/status — 匹配状态
 * - POST /api/v1/match/:ticketId/accept — 接受匹配
 * - POST /api/v1/match/:ticketId/reject — 拒绝匹配
 */
@Controller('api/v1/match')
export class MatchController {
  private readonly logger = new Logger(MatchController.name);

  constructor(private readonly matchQueue: MatchQueueService) {}

  /**
   * 加入匹配队列
   * POST /api/v1/match
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async enqueue(
    @Request() req: RequestWithUser,
    @Body() dto: MatchCriteriaDto,
  ): Promise<{
    ticketId: string;
    status: string;
    message: string;
  }> {
    const userId = req.user.userId;

    const criteria = {
      ratingRange: dto.ratingRange,
      maxWaitTime: dto.maxWaitTime,
      allowAI: dto.allowAI,
      aiDifficulty: dto.aiDifficulty,
      mode: dto.mode,
    };

    const ticketId = await this.matchQueue.enqueue(userId, dto.pluginId, criteria);

    this.logger.debug(`User ${userId} joined match queue for ${dto.pluginId}`);

    return {
      ticketId,
      status: 'queued',
      message: '已成功加入匹配队列',
    };
  }

  /**
   * 取消匹配
   * DELETE /api/v1/match/:ticketId
   */
  @Delete(':ticketId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async dequeue(
    @Request() req: RequestWithUser,
    @Param('ticketId') ticketId: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const userId = req.user.userId;

    await this.matchQueue.dequeue(userId, ticketId);

    return {
      success: true,
      message: '匹配已取消',
    };
  }

  /**
   * 获取匹配状态
   * GET /api/v1/match/:ticketId/status
   */
  @Get(':ticketId/status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMatchStatus(
    @Param('ticketId') ticketId: string,
  ): Promise<MatchStatus | { message: string }> {
    const status = await this.matchQueue.getMatchStatus(ticketId);

    if (!status) {
      return { message: '匹配票不存在或已过期' };
    }

    return status;
  }

  /**
   * 接受匹配
   * POST /api/v1/match/:ticketId/accept
   */
  @Post(':ticketId/accept')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async acceptMatch(
    @Param('ticketId') ticketId: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.matchQueue.acceptMatch(ticketId);

    return {
      success: true,
      message: '匹配已接受',
    };
  }

  /**
   * 拒绝匹配
   * POST /api/v1/match/:ticketId/reject
   */
  @Post(':ticketId/reject')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async rejectMatch(
    @Param('ticketId') ticketId: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.matchQueue.rejectMatch(ticketId);

    return {
      success: true,
      message: '匹配已拒绝',
    };
  }
}
