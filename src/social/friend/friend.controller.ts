/**
 * FriendController - 好友控制器
 */
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FriendService } from './friend.service';
import {
  SendFriendRequestDto,
  RespondFriendRequestDto,
  SearchPlayersDto,
  BlockUserDto,
} from '../dto';

@Controller('social/friends')
export class FriendController {
  constructor(private readonly friendService: FriendService) {}

  /**
   * 发送好友请求
   */
  @Post('requests')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sendFriendRequest(
    @Body('fromUserId', ParseIntPipe) fromUserId: number,
    @Body() dto: SendFriendRequestDto,
  ): Promise<void> {
    return this.friendService.sendFriendRequest(
      fromUserId,
      Number(dto.toUserId),
    );
  }

  /**
   * 接受好友请求
   */
  @Post('requests/:requestId/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptFriendRequest(
    @Body('userId', ParseIntPipe) userId: number,
    @Param('requestId') requestId: string,
  ): Promise<void> {
    return this.friendService.acceptFriendRequest(userId, requestId);
  }

  /**
   * 拒绝好友请求
   */
  @Post('requests/:requestId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rejectFriendRequest(
    @Body('userId', ParseIntPipe) userId: number,
    @Param('requestId') requestId: string,
  ): Promise<void> {
    return this.friendService.rejectFriendRequest(userId, requestId);
  }

  /**
   * 获取待处理的好友请求
   */
  @Get('requests/pending')
  async getFriendRequests(
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.friendService.getFriendRequests(userId);
  }

  /**
   * 获取好友列表
   */
  @Get('list')
  async getFriendList(
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.friendService.getFriendList(userId);
  }

  /**
   * 删除好友
   */
  @Delete(':friendId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFriend(
    @Body('userId', ParseIntPipe) userId: number,
    @Param('friendId', ParseIntPipe) friendId: number,
  ): Promise<void> {
    return this.friendService.removeFriend(userId, friendId);
  }

  /**
   * 搜索玩家
   */
  @Get('search')
  async searchPlayers(
    @Query('userId', ParseIntPipe) userId: number,
    @Query() dto: SearchPlayersDto,
  ) {
    return this.friendService.searchPlayers(userId, dto.keyword);
  }

  /**
   * 拉黑用户
   */
  @Post('block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async blockUser(
    @Body('userId', ParseIntPipe) userId: number,
    @Body() dto: BlockUserDto,
  ): Promise<void> {
    return this.friendService.blockUser(userId, Number(dto.blockUserId));
  }

  /**
   * 取消拉黑
   */
  @Delete('block/:blockUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblockUser(
    @Body('userId', ParseIntPipe) userId: number,
    @Param('blockUserId', ParseIntPipe) blockUserId: number,
  ): Promise<void> {
    return this.friendService.unblockUser(userId, blockUserId);
  }

  /**
   * 获取黑名单
   */
  @Get('blocked')
  async getBlockedList(
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.friendService.getBlockedList(userId);
  }
}
