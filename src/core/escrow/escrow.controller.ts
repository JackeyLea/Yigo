/**
 * EscrowController - 断线托管HTTP接口
 *
 * 提供托管状态查询、手动触发托管/取消托管等管理接口
 */
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { EscrowService, EscrowStatus } from './escrow.service';
import { EscrowActionDto, EscrowResponseDto } from './dto';

@ApiTags('escrow')
@Controller('escrow')
export class EscrowController {
  private readonly logger = new Logger(EscrowController.name);

  constructor(private readonly escrowService: EscrowService) {}

  /**
   * 查询指定房间和玩家的托管状态
   */
  @Get(':roomId/:playerId')
  @ApiOperation({ summary: '查询托管状态', description: '查询指定房间和玩家的托管状态' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'ABC123' })
  @ApiParam({ name: 'playerId', description: '玩家ID', example: 'user_123' })
  @ApiResponse({ status: 200, description: '查询成功', type: EscrowResponseDto })
  @ApiResponse({ status: 404, description: '托管状态不存在' })
  async getEscrowStatus(
    @Param('roomId') roomId: string,
    @Param('playerId') playerId: string,
  ): Promise<EscrowResponseDto> {
    const isEscrowed = await this.escrowService.isEscrowed(roomId, playerId);
    return {
      roomId,
      playerId,
      isEscrowed,
      message: isEscrowed ? '玩家处于托管状态' : '玩家未处于托管状态',
    };
  }

  /**
   * 手动启动托管（管理员接口）
   */
  @Post(':roomId/:playerId/start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '手动启动托管', description: '为指定玩家手动启动AI托管' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'ABC123' })
  @ApiParam({ name: 'playerId', description: '玩家ID', example: 'user_123' })
  @ApiResponse({ status: 201, description: '托管启动成功' })
  @ApiResponse({ status: 409, description: '托管已处于激活状态' })
  async startEscrow(
    @Param('roomId') roomId: string,
    @Param('playerId') playerId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.escrowService.startEscrow(roomId, playerId);
    return {
      success: true,
      message: `托管已启动: 房间 ${roomId} 的玩家 ${playerId}`,
    };
  }

  /**
   * 取消托管（玩家重连或管理员接口）
   */
  @Delete(':roomId/:playerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消托管', description: '取消指定玩家的AI托管' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'ABC123' })
  @ApiParam({ name: 'playerId', description: '玩家ID', example: 'user_123' })
  @ApiResponse({ status: 200, description: '托管取消成功' })
  @ApiResponse({ status: 404, description: '托管状态不存在' })
  async cancelEscrow(
    @Param('roomId') roomId: string,
    @Param('playerId') playerId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.escrowService.cancelEscrow(roomId, playerId);
    return {
      success: true,
      message: `托管已取消: 房间 ${roomId} 的玩家 ${playerId}`,
    };
  }

  /**
   * 获取房间内所有托管状态
   */
  @Get(':roomId')
  @ApiOperation({ summary: '获取房间所有托管状态', description: '获取指定房间内所有玩家的托管状态' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'ABC123' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getRoomEscrowStatuses(
    @Param('roomId') roomId: string,
  ): Promise<{ roomId: string; escrowList: EscrowStatus[]; count: number }> {
    const escrowList = await this.escrowService.getRoomEscrowStatuses(roomId);
    return {
      roomId,
      escrowList,
      count: escrowList.length,
    };
  }

  /**
   * 触发托管AI操作（测试接口）
   */
  @Post(':roomId/:playerId/action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '触发托管AI操作', description: '手动触发托管AI执行一次操作（测试用途）' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'ABC123' })
  @ApiParam({ name: 'playerId', description: '玩家ID', example: 'user_123' })
  @ApiBody({ type: EscrowActionDto })
  @ApiResponse({ status: 200, description: 'AI操作成功' })
  @ApiResponse({ status: 404, description: '托管状态不存在' })
  async triggerEscrowAction(
    @Param('roomId') roomId: string,
    @Param('playerId') playerId: string,
    @Body() dto: EscrowActionDto,
  ): Promise<{ success: boolean; action: any; message: string }> {
    const result = await this.escrowService.getEscrowAction(
      roomId,
      playerId,
      dto.gameState,
    );
    return {
      success: true,
      action: result.action,
      message: result.isEscrowed ? 'AI托管操作已执行' : '玩家未处于托管状态',
    };
  }

  /**
   * 处理玩家重连
   */
  @Post(':roomId/:playerId/reconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '处理玩家重连', description: '玩家重连后处理托管状态' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'ABC123' })
  @ApiParam({ name: 'playerId', description: '玩家ID', example: 'user_123' })
  @ApiResponse({ status: 200, description: '重连处理成功' })
  async handleReconnect(
    @Param('roomId') roomId: string,
    @Param('playerId') playerId: string,
  ): Promise<{ canContinue: boolean; escrowDuration: number; message: string }> {
    const result = await this.escrowService.handlePlayerReconnect(roomId, playerId);
    return {
      ...result,
      message: result.canContinue
        ? `玩家已重连，托管持续了 ${result.escrowDuration} 秒`
        : '该玩家未处于托管状态',
    };
  }

  /**
   * 托管认输
   */
  @Post(':roomId/:playerId/resign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '托管认输', description: '托管状态主动认输' })
  @ApiParam({ name: 'roomId', description: '房间ID', example: 'ABC123' })
  @ApiParam({ name: 'playerId', description: '玩家ID', example: 'user_123' })
  @ApiResponse({ status: 200, description: '认输成功' })
  async escrowResign(
    @Param('roomId') roomId: string,
    @Param('playerId') playerId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.escrowService.escrowResign(roomId, playerId);
    return {
      success: true,
      message: `托管认输已处理: 房间 ${roomId} 的玩家 ${playerId}`,
    };
  }
}
