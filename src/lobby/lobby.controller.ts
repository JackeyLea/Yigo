import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';

import { LobbyService, PaginatedResult } from './lobby.service';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { GameResponseDto } from './dto/game-response.dto';
import { AnnouncementDto } from './dto/announcement.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

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
 * LobbyController - 游戏大厅控制器
 *
 * 提供游戏列表、游戏详情、公告、收藏、最近游玩等API端点。
 * 所有响应通过全局TransformInterceptor统一包装为ApiResponse格式。
 *
 * @baseUrl /api/v1/lobby
 */
@Controller('api/v1/lobby')
export class LobbyController {
  constructor(private readonly lobbyService: LobbyService) {}

  /**
   * 获取游戏列表
   *
   * 支持关键词搜索、分类筛选、分页查询。
   * 未登录用户也可访问，登录用户会额外返回收藏状态。
   *
   * @query keyword - 搜索关键词
   * @query category - 分类过滤(board/card/mahjong)
   * @query view - 视图模式(grid/list)
   * @query page - 页码
   * @query pageSize - 每页数量
   *
   * @returns 分页的游戏列表
   */
  @Get('games')
  async listGames(
    @Query() query: ListGamesQueryDto,
    @Req() req: RequestWithUser,
  ): Promise<PaginatedResult<GameResponseDto>> {
    const userId = req.user?.userId;
    return this.lobbyService.listGames(query, userId);
  }

  /**
   * 获取游戏详情
   *
   * @param pluginId - 游戏插件ID
   * @returns 游戏详细信息
   */
  @Get('games/:pluginId')
  async getGameDetail(
    @Param('pluginId') pluginId: string,
    @Req() req: RequestWithUser,
  ): Promise<GameResponseDto> {
    const userId = req.user?.userId;
    return this.lobbyService.getGameDetail(pluginId, userId);
  }

  /**
   * 获取游戏在线人数
   *
   * @param pluginId - 游戏插件ID
   * @returns 当前在线人数
   */
  @Get('games/:pluginId/online')
  async getOnlineCount(
    @Param('pluginId') pluginId: string,
  ): Promise<{ onlineCount: number }> {
    const onlineCount = await this.lobbyService.getOnlineCount(pluginId);
    return { onlineCount };
  }

  /**
   * 获取公告列表
   *
   * 返回当前有效的公告列表，按优先级和时间排序。
   * 无需登录即可访问。
   *
   * @returns 公告列表
   */
  @Get('announcements')
  async getAnnouncements(): Promise<AnnouncementDto[]> {
    return this.lobbyService.getAnnouncements();
  }

  /**
   * 获取用户收藏的游戏ID列表
   *
   * 需要登录。
   *
   * @returns 收藏的游戏ID数组
   */
  @Get('favorites')
  @UseGuards(JwtAuthGuard)
  async getFavorites(
    @Req() req: RequestWithUser,
  ): Promise<string[]> {
    const userId = req.user!.userId;
    return this.lobbyService.getFavorites(userId);
  }

  /**
   * 切换游戏收藏状态
   *
   * 如果游戏已在收藏中则取消收藏，否则添加收藏。
   * 需要登录。
   *
   * @param pluginId - 游戏插件ID
   * @returns 操作后的收藏状态
   */
  @Post('favorites/:pluginId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async toggleFavorite(
    @Param('pluginId') pluginId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ isFavorite: boolean }> {
    const userId = req.user!.userId;
    const isFavorite = await this.lobbyService.toggleFavorite(userId, pluginId);
    return { isFavorite };
  }

  /**
   * 获取最近游玩的游戏列表
   *
   * 返回用户最近玩过的游戏，按时间倒序排列。
   * 需要登录。
   *
   * @query limit - 返回数量限制，默认10
   * @returns 最近游玩的游戏列表
   */
  @Get('recent')
  @UseGuards(JwtAuthGuard)
  async getRecentGames(
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
    @Req() req: RequestWithUser,
  ): Promise<GameResponseDto[]> {
    const userId = req.user!.userId;
    return this.lobbyService.getRecentGames(userId, limit);
  }
}
