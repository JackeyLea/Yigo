/**
 * PenaltyController - 逃跑惩罚HTTP接口
 *
 * 提供逃跑记录查询、惩罚状态检查、管理操作等接口
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Logger,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { PenaltyService, PenaltyStatus } from './penalty.service';
import {
  RecordEscapeDto,
  PenaltyStatusDto,
  EscapeHistoryResponseDto,
  ForgiveEscapeDto,
} from './dto';
import { EscapeRecord } from './entities/escape-record.entity';

@ApiTags('penalty')
@Controller('penalty')
export class PenaltyController {
  private readonly logger = new Logger(PenaltyController.name);

  constructor(private readonly penaltyService: PenaltyService) {}

  /**
   * 查询惩罚状态
   */
  @Get(':userId/status')
  @ApiOperation({ summary: '查询惩罚状态', description: '查询指定用户的当前惩罚状态' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiResponse({ status: 200, description: '查询成功', type: PenaltyStatusDto })
  async getPenaltyStatus(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PenaltyStatus> {
    return this.penaltyService.checkPenalty(userId);
  }

  /**
   * 获取逃跑历史
   */
  @Get(':userId/history')
  @ApiOperation({ summary: '获取逃跑历史', description: '获取指定用户的逃跑记录' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getEscapeHistory(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ userId: number; records: EscapeRecord[]; count: number }> {
    const records = await this.penaltyService.getEscapeHistory(userId);
    return { userId, records, count: records.length };
  }

  /**
   * 记录逃跑
   */
  @Post('escape')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '记录逃跑行为', description: '记录一次逃跑行为并应用惩罚' })
  @ApiBody({ type: RecordEscapeDto })
  @ApiResponse({ status: 201, description: '记录成功' })
  @ApiResponse({ status: 409, description: '该逃跑已记录' })
  async recordEscape(
    @Body() dto: RecordEscapeDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.penaltyService.recordEscape(dto.userId, dto.roomId, dto.gameType);
    const status = await this.penaltyService.checkPenalty(dto.userId);
    return {
      success: true,
      message: `逃跑已记录，当前信誉分: ${status.reputationScore}，惩罚等级: ${status.penaltyLevel}`,
    };
  }

  /**
   * 记录完成对局
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '记录完成对局', description: '记录正常完成对局，恢复信誉分' })
  @ApiBody({ type: RecordEscapeDto })
  @ApiResponse({ status: 200, description: '记录成功' })
  async recordGameComplete(
    @Body() dto: RecordEscapeDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.penaltyService.recordGameComplete(dto.userId, dto.gameType);
    const status = await this.penaltyService.checkPenalty(dto.userId);
    return {
      success: true,
      message: `对局完成已记录，当前信誉分: ${status.reputationScore}`,
    };
  }

  /**
   * 获取匹配等待加成
   */
  @Get(':userId/match-wait')
  @ApiOperation({ summary: '获取匹配等待加成', description: '获取用户的匹配等待额外时间' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getMatchWaitBonus(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ userId: number; bonusSeconds: number }> {
    const bonus = await this.penaltyService.getMatchWaitBonus(userId);
    return { userId, bonusSeconds: bonus };
  }

  // ==================== 管理员接口 ====================

  /**
   * 宽恕逃跑记录
   */
  @Post('forgive/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '宽恕逃跑记录', description: '宽恕指定的逃跑记录并恢复信誉分（管理员）' })
  @ApiParam({ name: 'recordId', description: '逃跑记录ID', example: 1 })
  @ApiResponse({ status: 200, description: '宽恕成功' })
  async forgiveEscape(
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<{ success: boolean; message: string }> {
    await this.penaltyService.forgiveEscape(recordId);
    return {
      success: true,
      message: `逃跑记录 ${recordId} 已宽恕`,
    };
  }

  /**
   * 获取所有逃跑记录
   */
  @Get('records/all')
  @ApiOperation({ summary: '获取所有逃跑记录', description: '分页获取所有逃跑记录（管理员）' })
  @ApiQuery({ name: 'page', required: false, description: '页码', example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量', example: 50 })
  @ApiQuery({ name: 'gameType', required: false, description: '游戏类型筛选' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getAllEscapes(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('gameType') gameType?: string,
  ): Promise<{ items: EscapeRecord[]; total: number; page: number; pageSize: number }> {
    return this.penaltyService.getAllEscapes(page, pageSize, gameType);
  }
}
