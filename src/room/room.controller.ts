/**
 * RoomController - 房间管理控制器
 *
 * 提供房间CRUD、玩家操作、房主权限、观战等RESTful API端点
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
  Delete,
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoomService } from './room.service';
import {
  CreateRoomDto,
  JoinRoomDto,
  RoomResponseDto,
  PaginatedResult,
} from './dto';

/**
 * 准备状态DTO
 */
class ReadyDto {
  isReady: boolean;
}

/**
 * 踢人DTO
 */
class KickDto {
  targetUserId: number;
}

/**
 * 转移房主DTO
 */
class TransferHostDto {
  newHostId: number;
}

@Controller('api/v1/rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  // ==================== 房间CRUD ====================

  /**
   * 创建房间
   * POST /api/v1/rooms
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async createRoom(
    @Request() req,
    @Body() dto: CreateRoomDto,
  ): Promise<RoomResponseDto> {
    const userId = req.user.user_id || req.user.id;
    return this.roomService.createRoom(Number(userId), dto);
  }

  /**
   * 房间列表
   * GET /api/v1/rooms
   */
  @Get()
  async listRooms(
    @Query('pluginId') pluginId?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize?: number,
  ): Promise<PaginatedResult<RoomResponseDto>> {
    return this.roomService.listRooms(pluginId, status, page, pageSize);
  }

  /**
   * 房间详情
   * GET /api/v1/rooms/:roomId
   */
  @Get(':roomId')
  async getRoom(
    @Param('roomId') roomId: string,
  ): Promise<RoomResponseDto> {
    return this.roomService.getRoom(roomId);
  }

  // ==================== 加入/离开 ====================

  /**
   * 加入房间
   * POST /api/v1/rooms/:roomId/join
   */
  @Post(':roomId/join')
  @UseGuards(JwtAuthGuard)
  async joinRoom(
    @Request() req,
    @Param('roomId') roomId: string,
    @Body() dto: JoinRoomDto,
  ): Promise<RoomResponseDto> {
    const userId = req.user.user_id || req.user.id;
    // 确保使用URL中的roomId
    const joinDto = { ...dto, roomId };
    return this.roomService.joinRoom(Number(userId), joinDto);
  }

  /**
   * 离开房间
   * POST /api/v1/rooms/:roomId/leave
   */
  @Post(':roomId/leave')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async leaveRoom(
    @Request() req,
    @Param('roomId') roomId: string,
  ): Promise<{ message: string }> {
    const userId = req.user.user_id || req.user.id;
    await this.roomService.leaveRoom(Number(userId), roomId);
    return { message: '已离开房间' };
  }

  // ==================== 房主权限 ====================

  /**
   * 踢人
   * POST /api/v1/rooms/:roomId/kick
   */
  @Post(':roomId/kick')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async kickPlayer(
    @Request() req,
    @Param('roomId') roomId: string,
    @Body() dto: KickDto,
  ): Promise<{ message: string }> {
    const hostId = req.user.user_id || req.user.id;
    await this.roomService.kickPlayer(Number(hostId), roomId, dto.targetUserId);
    return { message: '已踢出玩家' };
  }

  /**
   * 转移房主
   * POST /api/v1/rooms/:roomId/transfer-host
   */
  @Post(':roomId/transfer-host')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async transferHost(
    @Request() req,
    @Param('roomId') roomId: string,
    @Body() dto: TransferHostDto,
  ): Promise<{ message: string }> {
    const hostId = req.user.user_id || req.user.id;
    await this.roomService.transferHost(Number(hostId), roomId, dto.newHostId);
    return { message: '房主权限已转移' };
  }

  // ==================== 准备/开始游戏 ====================

  /**
   * 准备/取消准备
   * POST /api/v1/rooms/:roomId/ready
   */
  @Post(':roomId/ready')
  @UseGuards(JwtAuthGuard)
  async setReady(
    @Request() req,
    @Param('roomId') roomId: string,
    @Body() dto: ReadyDto,
  ): Promise<RoomResponseDto> {
    const userId = req.user.user_id || req.user.id;
    return this.roomService.setReady(Number(userId), roomId, dto.isReady);
  }

  /**
   * 开始游戏
   * POST /api/v1/rooms/:roomId/start
   */
  @Post(':roomId/start')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async startGame(
    @Request() req,
    @Param('roomId') roomId: string,
  ): Promise<{ message: string }> {
    const hostId = req.user.user_id || req.user.id;
    await this.roomService.startGame(Number(hostId), roomId);
    return { message: '游戏已开始' };
  }

  /**
   * 解散房间
   * POST /api/v1/rooms/:roomId/dissolve
   */
  @Post(':roomId/dissolve')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async dissolveRoom(
    @Request() req,
    @Param('roomId') roomId: string,
  ): Promise<{ message: string }> {
    const hostId = req.user.user_id || req.user.id;
    await this.roomService.dissolveRoom(Number(hostId), roomId);
    return { message: '房间已解散' };
  }

  // ==================== 观战 ====================

  /**
   * 观战
   * POST /api/v1/rooms/:roomId/spectate
   */
  @Post(':roomId/spectate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async spectatorJoin(
    @Request() req,
    @Param('roomId') roomId: string,
  ): Promise<{ message: string }> {
    const spectatorId = req.user.user_id || req.user.id;
    await this.roomService.spectatorJoin(Number(spectatorId), roomId);
    return { message: '已进入观战模式' };
  }

  /**
   * 取消观战
   * DELETE /api/v1/rooms/:roomId/spectate
   */
  @Delete(':roomId/spectate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async spectatorLeave(
    @Request() req,
    @Param('roomId') roomId: string,
  ): Promise<{ message: string }> {
    const spectatorId = req.user.user_id || req.user.id;
    await this.roomService.spectatorLeave(Number(spectatorId), roomId);
    return { message: '已退出观战' };
  }
}
