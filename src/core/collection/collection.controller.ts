/**
 * CollectionController - 牌谱/棋谱收藏HTTP接口
 *
 * 提供收藏管理、备注、标签、分享等功能接口
 */
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { CollectionService, PaginatedResult, CollectedGameDetail } from './collection.service';
import {
  CollectGameDto,
  AddNoteDto,
  AddTagsDto,
  ShareResponseDto,
} from './dto';

@ApiTags('collection')
@Controller('collection')
export class CollectionController {
  private readonly logger = new Logger(CollectionController.name);

  constructor(private readonly collectionService: CollectionService) {}

  // ==================== 收藏CRUD ====================

  /**
   * 收藏对局
   */
  @Post(':userId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '收藏对局', description: '收藏一局对局到个人收藏夹' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiBody({ type: CollectGameDto })
  @ApiResponse({ status: 201, description: '收藏成功' })
  @ApiResponse({ status: 409, description: '该对局已被收藏' })
  async collectGame(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: CollectGameDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.collectionService.collectGame(userId, dto.recordId, dto.tags);
    return {
      success: true,
      message: `对局 ${dto.recordId} 已收藏`,
    };
  }

  /**
   * 取消收藏
   */
  @Delete(':userId/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消收藏', description: '取消收藏指定对局' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiParam({ name: 'recordId', description: '对局记录ID', example: 10001 })
  @ApiResponse({ status: 200, description: '取消收藏成功' })
  @ApiResponse({ status: 404, description: '收藏记录不存在' })
  async uncollectGame(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<{ success: boolean; message: string }> {
    await this.collectionService.uncollectGame(userId, recordId);
    return {
      success: true,
      message: `对局 ${recordId} 已取消收藏`,
    };
  }

  /**
   * 获取收藏列表
   */
  @Get(':userId')
  @ApiOperation({ summary: '获取收藏列表', description: '分页获取用户收藏的对局列表' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiQuery({ name: 'page', required: false, description: '页码', example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量', example: 20 })
  @ApiQuery({ name: 'gameType', required: false, description: '游戏类型筛选', example: 'chess' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getCollections(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('gameType') gameType?: string,
  ): Promise<PaginatedResult<CollectedGameDetail>> {
    return this.collectionService.getCollections(userId, page, pageSize, gameType);
  }

  /**
   * 获取收藏详情
   */
  @Get(':userId/:recordId')
  @ApiOperation({ summary: '获取收藏详情', description: '获取单个收藏的详细信息' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiParam({ name: 'recordId', description: '对局记录ID', example: 10001 })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '收藏记录不存在' })
  async getCollectionDetail(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<CollectedGameDetail> {
    return this.collectionService.getCollectionDetail(userId, recordId);
  }

  // ==================== 备注管理 ====================

  /**
   * 添加/修改备注
   */
  @Post(':userId/:recordId/note')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '添加备注', description: '为收藏的指定对局添加备注' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiParam({ name: 'recordId', description: '对局记录ID', example: 10001 })
  @ApiBody({ type: AddNoteDto })
  @ApiResponse({ status: 200, description: '备注添加成功' })
  @ApiResponse({ status: 404, description: '收藏记录不存在' })
  async addNote(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: AddNoteDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.collectionService.addNote(userId, recordId, dto.note);
    return {
      success: true,
      message: `备注已添加: ${dto.note.substring(0, 50)}${dto.note.length > 50 ? '...' : ''}`,
    };
  }

  // ==================== 标签管理 ====================

  /**
   * 添加标签
   */
  @Post(':userId/:recordId/tags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '添加标签', description: '为收藏的指定对局添加标签' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiParam({ name: 'recordId', description: '对局记录ID', example: 10001 })
  @ApiBody({ type: AddTagsDto })
  @ApiResponse({ status: 200, description: '标签添加成功' })
  async addTags(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: AddTagsDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.collectionService.addTags(userId, recordId, dto.tags);
    return {
      success: true,
      message: `标签已添加: ${dto.tags.join(', ')}`,
    };
  }

  /**
   * 移除标签
   */
  @Delete(':userId/:recordId/tags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '移除标签', description: '移除收藏的指定标签' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiParam({ name: 'recordId', description: '对局记录ID', example: 10001 })
  @ApiBody({ type: AddTagsDto })
  @ApiResponse({ status: 200, description: '标签移除成功' })
  async removeTags(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: AddTagsDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.collectionService.removeTags(userId, recordId, dto.tags);
    return {
      success: true,
      message: `标签已移除: ${dto.tags.join(', ')}`,
    };
  }

  /**
   * 获取用户所有标签
   */
  @Get(':userId/tags')
  @ApiOperation({ summary: '获取用户所有标签', description: '获取用户收藏中使用的所有标签' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getUserTags(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ userId: number; tags: string[] }> {
    const tags = await this.collectionService.getUserTags(userId);
    return { userId, tags };
  }

  // ==================== 分享功能 ====================

  /**
   * 分享收藏
   */
  @Post(':userId/:recordId/share')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '分享收藏', description: '生成收藏的分享链接' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiParam({ name: 'recordId', description: '对局记录ID', example: 10001 })
  @ApiResponse({ status: 200, description: '分享链接生成成功' })
  @ApiResponse({ status: 404, description: '收藏记录不存在' })
  async shareCollection(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<{ success: boolean; shareUrl: string; message: string }> {
    const shareUrl = await this.collectionService.shareCollection(userId, recordId);
    return {
      success: true,
      shareUrl,
      message: '分享链接已生成',
    };
  }

  /**
   * 通过分享链接获取收藏
   */
  @Get('share/:token')
  @ApiOperation({ summary: '通过分享链接获取收藏', description: '使用分享token查看收藏的对局' })
  @ApiParam({ name: 'token', description: '分享token', example: 'abc123...' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '分享链接已过期或不存在' })
  async getCollectionByShare(
    @Param('token') token: string,
  ): Promise<CollectedGameDetail | null> {
    return this.collectionService.getCollectionByShareToken(token);
  }

  /**
   * 取消分享
   */
  @Delete(':userId/:recordId/share')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消分享', description: '取消收藏的分享链接' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiParam({ name: 'recordId', description: '对局记录ID', example: 10001 })
  @ApiResponse({ status: 200, description: '分享已取消' })
  async revokeShare(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('recordId', ParseIntPipe) recordId: number,
  ): Promise<{ success: boolean; message: string }> {
    await this.collectionService.revokeShare(userId, recordId);
    return {
      success: true,
      message: '分享已取消',
    };
  }

  // ==================== 统计 ====================

  /**
   * 获取收藏总数
   */
  @Get(':userId/count')
  @ApiOperation({ summary: '获取收藏总数', description: '获取用户的收藏总数' })
  @ApiParam({ name: 'userId', description: '用户ID', example: 12345 })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getCollectionCount(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ userId: number; count: number }> {
    const count = await this.collectionService.getCollectionCount(userId);
    return { userId, count };
  }
}
