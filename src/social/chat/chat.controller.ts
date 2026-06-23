/**
 * ChatController - 聊天控制器
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import {
  SendMessageDto,
  SendRoomMessageDto,
  MarkReadDto,
} from '../dto';

@Controller('social/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * 发送私聊消息
   */
  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Body('fromUserId', ParseIntPipe) fromUserId: number,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(
      fromUserId,
      Number(dto.toUserId),
      dto.content,
      dto.type,
    );
  }

  /**
   * 发送房间消息
   */
  @Post('rooms/:roomId/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendRoomMessage(
    @Body('fromUserId', ParseIntPipe) fromUserId: number,
    @Param('roomId') roomId: string,
    @Body('content') content: string,
  ) {
    return this.chatService.sendRoomMessage(fromUserId, roomId, content);
  }

  /**
   * 获取私聊历史
   */
  @Get('history/:withUserId')
  async getHistory(
    @Query('userId', ParseIntPipe) userId: number,
    @Param('withUserId', ParseIntPipe) withUserId: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.chatService.getHistory(
      userId,
      withUserId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  /**
   * 获取房间聊天历史
   */
  @Get('rooms/:roomId/history')
  async getRoomHistory(
    @Param('roomId') roomId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.chatService.getRoomHistory(
      roomId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  /**
   * 获取未读消息总数
   */
  @Get('unread')
  async getUnreadCount(
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    const count = await this.chatService.getUnreadCount(userId);
    return { unreadCount: count };
  }

  /**
   * 标记消息已读
   */
  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAsRead(
    @Body('userId', ParseIntPipe) userId: number,
    @Body() dto: MarkReadDto,
  ): Promise<void> {
    return this.chatService.markAsRead(userId, Number(dto.fromUserId));
  }

  /**
   * 获取最近聊天列表
   */
  @Get('recent')
  async getRecentChats(
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.chatService.getRecentChats(userId);
  }
}
